import * as THREE from "three";

// The cloth, hair and beards the game moves on its own: a model's FeModel (Source 2's cloth, from
// the model's PHYS block), exported by the tracker as <model>.cloth.json beside the glb, with
// models/cloth.json listing the glbs that have one.
//
// Its nodes are points: the model's own bones (named after them) or points of a cloth proxy
// ($cloth_mXpY) that hang off a bone. The first m_nStaticNodes and those of no inverse mass follow
// the animation; the rest move (gravity, damping, a pull back towards where the animation puts
// them), kept together by rods (a least and a most distance between two nodes) and pushed out of
// the body's capsules and spheres. Nodes from m_nFirstPositionDrivenNode on are bones the moving
// nodes turn and carry: by the best fit of a group of nodes (m_FitMatrices, or the four of
// m_NodeBases). Moving nodes that are bones themselves are put where they are and
// turned towards the next node.
//
// Everything is worked out as a change from where the animation has the nodes and bones, so the
// bones' own axes (the game's and the glTF's differ) never matter: a bone is turned and moved by
// what the cloth did on top of the animation.
//
// Not done: triangles and quads (cloth stiffness on surfaces, 39 models), twists and hinges,
// boxes, wind (m_Effects), each node's collision masks, per-node local force.

const SOURCE_TO_METRES = 0.0254;
// Steps of at most this long (seconds)
const STEP = 1 / 60;
const MAX_STEPS = 8;
// Rods and collisions solved this many times a step
const ITERATIONS = 4;
// A node this far from its place in the animation (inches) means the solver lost it: start over
const LOST = 400;
// Picked by measuring 81 models in Node (dota2-model-tracker/temp/m06/wobble.mjs: how much the
// bones move with the hero standing, how far they swing on a fast turn, how soon they settle),
// the cloth swinging too much on the site with the first guesses (damping of at least 1/s,
// frames of 1/30 s). leastDamping: per second, every node; relative: damped against the
// animation's own movement; frameRate: of the older models' per-frame shares
export const tuning = { leastDamping: 8, relative: true, frameRate: 60 };

// Source's model space (x ahead, y left, z up, inches) to the glTF's (y up, metres)
const fromSource = (x, y, z, out = new THREE.Vector3()) => out.set(y, z, x).multiplyScalar(SOURCE_TO_METRES);

const lists = new Map();
const files = new Map();

// The cloth of the model at `url` (a glb in the dataset), or null when it has none
export function loadCloth(url) {
  const at = url.indexOf("/models/");
  if (at < 0) {
    return Promise.resolve(null);
  }
  const base = url.slice(0, at + 1);
  if (!lists.has(base)) {
    const list = fetch(`${base}models/cloth.json`)
      .then((response) => (response.ok ? response.json() : []))
      .then((glbs) => new Set(glbs))
      .catch(() => {
        lists.delete(base);
        return new Set();
      });
    lists.set(base, list);
  }
  return lists.get(base).then((list) => {
    if (!list.has(url.slice(at + 1))) {
      return null;
    }
    const file = url.replace(/\.glb$/, ".cloth.json");
    if (!files.has(file)) {
      const cloth = fetch(file)
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
      cloth.then((fe) => fe || files.delete(file));
      files.set(file, cloth);
    }
    return files.get(file);
  });
}

// The bone's transform in the model's space as the files put it (its bind pose)
function restMatrix(bone, group) {
  const matrix = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  for (let node = bone; node && node !== group; node = node.parent) {
    const rest = node.userData.rest;
    local.compose(rest?.position ?? node.position, rest?.quaternion ?? node.quaternion, rest?.scale ?? node.scale);
    matrix.premultiply(local);
  }
  return matrix;
}

// The node's place in its InitPose turned and moved by it: a point given in the node's own space
function inNodeSpace(pose, [x, y, z]) {
  const point = new THREE.Vector3(x, y, z).applyQuaternion(new THREE.Quaternion(pose[4], pose[5], pose[6], pose[7]));
  return point.add(new THREE.Vector3(pose[0], pose[1], pose[2]));
}

// The rotation closest to the 3x3 matrix `m` (row-major, 9 numbers), found by turning `q` towards it
// (Müller et al., "A Robust Method to Extract the Rotational Part of Deformations")
const axis = new THREE.Vector3();
const turn = new THREE.Quaternion();
const r = new THREE.Matrix4();
function extractRotation(m, q) {
  for (let iteration = 0; iteration < 12; iteration++) {
    r.makeRotationFromQuaternion(q);
    const e = r.elements;
    // Column k of the rotation crossed with column k of m, summed
    let ox = 0;
    let oy = 0;
    let oz = 0;
    let dot = 0;
    for (let k = 0; k < 3; k++) {
      const rx = e[k * 4];
      const ry = e[k * 4 + 1];
      const rz = e[k * 4 + 2];
      const mx = m[k];
      const my = m[3 + k];
      const mz = m[6 + k];
      ox += ry * mz - rz * my;
      oy += rz * mx - rx * mz;
      oz += rx * my - ry * mx;
      dot += rx * mx + ry * my + rz * mz;
    }
    const scale = 1 / (Math.abs(dot) + 1e-9);
    axis.set(ox * scale, oy * scale, oz * scale);
    const angle = axis.length();
    if (angle < 1e-9) {
      break;
    }
    turn.setFromAxisAngle(axis.divideScalar(angle), angle);
    q.premultiply(turn).normalize();
  }
  return q;
}

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const m1 = new THREE.Matrix4();
const m2 = new THREE.Matrix4();

export class Cloth {
  // fe: the model's FeModel; group: the shown model, its bones by name (any letter case) and
  // each bone's bind pose in userData.rest
  constructor(fe, group) {
    this.group = group;
    const n = (this.n = fe.m_nNodeCount ?? 0);
    const names = fe.m_CtrlName ?? [];
    const bones = new Map();
    group.traverse((node) => {
      const key = node.isBone && node.name.toLowerCase();
      if (key && !bones.has(key)) {
        bones.set(key, node);
      }
    });
    const boneOf = Array.from({ length: n }, (_, i) => (names[i] && !names[i].startsWith("$") ? bones.get(names[i].toLowerCase()) ?? null : null));
    const nodeOfBone = new Map(boneOf.map((bone, i) => [bone, i]).filter(([bone]) => bone));

    const staticCount = fe.m_nStaticNodes ?? 0;
    // Older models give no first position-driven node (0): their bones are carried by the nodes
    // that hang off them instead (m_ReverseOffsets, m_CtrlOffsets), and are in no rod
    const firstDriven = Math.min(fe.m_nFirstPositionDrivenNode || n, n);
    const inverseMass = fe.m_NodeInvMasses ?? [];
    const reverse = new Map((fe.m_ReverseOffsets ?? []).filter(({ nTargetNode }) => nTargetNode < n).map(({ nBoneCtrl, nTargetNode }) => [nBoneCtrl, nTargetNode]));
    const inRod = new Set((fe.m_Rods ?? []).flatMap(({ nNode }) => nNode));
    const hangers = new Map();
    for (const { nCtrlParent, nCtrlChild } of fe.m_CtrlOffsets ?? []) {
      if (nCtrlChild < n && nCtrlParent < n) {
        hangers.set(nCtrlParent, [...(hangers.get(nCtrlParent) ?? []), nCtrlChild]);
      }
    }
    this.moving = new Uint8Array(n);
    const carried = new Uint8Array(n);
    for (let i = staticCount; i < firstDriven; i++) {
      if (inverseMass[i] > 0) {
        carried[i] = boneOf[i] && (reverse.has(i) || !inRod.has(i)) ? 1 : 0;
        // A point held by nothing would only fall: left where the animation puts it
        const { flAnimationVertexAttraction: pull, flAnimationForceAttraction: force } = fe.m_NodeIntegrator?.[i] ?? {};
        this.moving[i] = !carried[i] && (inRod.has(i) || pull > 0 || force > 0) ? 1 : 0;
      }
    }

    // The node each one hangs off: the bone its offset is given from, or its parent in the skeleton
    const parent = new Int32Array(n).fill(-1);
    (fe.m_SkelParents ?? []).forEach((p, i) => i < n && p >= 0 && p < n && (parent[i] = p));
    for (const offset of fe.m_CtrlOffsets ?? []) {
      if (offset.nCtrlChild < n && offset.nCtrlParent < n) {
        parent[offset.nCtrlChild] = offset.nCtrlParent;
      }
    }
    // The bone whose animation carries each node (its own, or the nearest one up its parents),
    // and where the node is in that bone's space
    this.frames = [];
    const frameIndex = new Map();
    const frameOf = (node) => {
      for (let j = node, depth = 0; j >= 0 && depth < 64; j = parent[j], depth++) {
        const bone = boneOf[j];
        if (bone) {
          if (!frameIndex.has(bone)) {
            frameIndex.set(bone, this.frames.length);
            this.frames.push({ bone, inverseRest: restMatrix(bone, group).invert(), world: new THREE.Matrix4() });
          }
          return frameIndex.get(bone);
        }
      }
      return -1;
    };
    const pose = fe.m_InitPose ?? [];
    const local = (node, point) => {
      const frame = frameOf(node);
      const model = fromSource(point.x, point.y, point.z);
      return { frame, point: frame >= 0 ? model.applyMatrix4(this.frames[frame].inverseRest) : model };
    };
    this.anchors = Array.from({ length: n }, (_, i) => local(i, inNodeSpace(pose[i] ?? [0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0])));

    const integrator = fe.m_NodeIntegrator ?? [];
    const gravityScale = fe.m_flDefaultGravityScale ?? 1;
    // Two kinds of models: newer ones give the pull towards the animation per second (Void Spirit 15,
    // Crystal Maiden 30, Juggernaut 6: 30 times a painted strength), older ones (most, every value
    // at most 1) a share per frame, the force being the painted strength cubed (0.125 = 0.5³).
    // Taken per second, an older model's pull would be far too weak and its cloth would only hang
    const moving = [...this.moving.keys()].filter((i) => this.moving[i]);
    const perFrame = moving.every((i) => (integrator[i]?.flAnimationVertexAttraction ?? 0) <= 1 && (integrator[i]?.flAnimationForceAttraction ?? 0) <= 1);
    const FRAME_RATE = tuning.frameRate;
    this.damping = Float64Array.from({ length: n }, (_, i) => Math.max(integrator[i]?.flPointDamping ?? 0, tuning.leastDamping));
    this.force = Float64Array.from({ length: n }, (_, i) => (integrator[i]?.flAnimationForceAttraction ?? 0) * (perFrame ? FRAME_RATE * FRAME_RATE : 1));
    this.pull = Float64Array.from({ length: n }, (_, i) => {
      const pull = integrator[i]?.flAnimationVertexAttraction ?? 0;
      return perFrame ? -FRAME_RATE * Math.log(1 - Math.min(pull, 0.99)) : pull;
    });
    this.gravity = Float64Array.from({ length: n }, (_, i) => (integrator[i]?.flGravity ?? 360) * gravityScale);
    this.localForce = THREE.MathUtils.clamp(fe.m_flLocalForce ?? 1, 0, 1);

    const rods = (fe.m_Rods ?? []).filter(({ nNode: [a, b] }) => a < n && b < n && (this.moving[a] || this.moving[b]));
    this.rods = rods.map(({ nNode: [a, b], flMinDist, flMaxDist, flWeight0, flRelaxationFactor }) => {
      // The share of a correction each end takes; a node that does not move takes none
      const w0 = !this.moving[a] ? 0 : !this.moving[b] ? 1 : flWeight0 ?? 0.5;
      return { a, b, min: flMinDist ?? 0, max: flMaxDist ?? Infinity, w0, relax: flRelaxationFactor ?? 1 };
    });
    this.strays = (fe.m_AnimStrayRadii ?? [])
      .filter(({ nNode: [a, b] }) => a < n && b < n && this.moving[b])
      .map(({ nNode: [a, b], flMaxDist, flRelaxationFactor }) => ({ a, b, max: flMaxDist, relax: flRelaxationFactor ?? 1 }));
    this.follows = (fe.m_FollowNodes ?? []).filter(({ nParentNode: p, nChildNode: c }) => p < n && c < n && this.moving[c]);
    this.locks = (fe.m_LockToGoal ?? []).filter((i) => i < n && this.moving[i]);
    this.lockToParent = (fe.m_LockToParent ?? []).filter(({ nCtrlParent: p, nCtrlChild: c }) => p < n && c < n && this.moving[c]);

    // The body's capsules and spheres, as two points (and radii) in their bone's space
    const radii = fe.m_NodeCollisionRadii ?? [];
    this.radius = Float64Array.from({ length: n }, (_, i) => (this.moving[i] ? radii[i - staticCount] ?? 0 : 0));
    const shapes = [
      ...(fe.m_TaperedCapsuleRigids ?? []).map(({ vSphere: [s0, s1], nNode }) => ({ node: nNode, spheres: [s0, s1] })),
      ...(fe.m_SphereRigids ?? []).map(({ vSphere, nNode }) => ({ node: nNode, spheres: [vSphere, vSphere] })),
    ].filter(({ node }) => node < n);
    this.shapes = shapes.map(({ node, spheres: [s0, s1] }) => {
      const p0 = inNodeSpace(pose[node], s0);
      const p1 = inNodeSpace(pose[node], s1);
      const a = local(node, p0);
      const b = local(node, p1);
      // Nodes the shape already holds in the pose the cloth was made in are left to it: pushing
      // them out would tear the cloth from where it hangs
      const holds = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        if (this.moving[i] && pose[i]) {
          const point = new THREE.Vector3(pose[i][0], pose[i][1], pose[i][2]);
          const { distance, radius } = closest(point, p0, s0[3], p1, s1[3]);
          holds[i] = distance < radius + this.radius[i] ? 1 : 0;
        }
      }
      return { frame: a.frame, p0: a.point, p1: b.point, r0: s0[3], r1: s1[3], holds, c0: new THREE.Vector3(), c1: new THREE.Vector3() };
    });

    // The bones the cloth turns and carries, parents first. Each is turned by one of: the best fit
    // of a group of nodes (m_FitMatrices, or the four of m_NodeBases), towards the
    // next node (a bone that moves itself), the best fit of the nodes hanging off it; and moved
    // with its anchor nodes
    this.driven = [];
    const fits = new Map();
    const weights = fe.m_FitWeights ?? [];
    let begin = 0;
    for (const fit of fe.m_FitMatrices ?? []) {
      const members = weights.slice(begin, fit.nEnd).filter(({ nNode }) => nNode < n);
      begin = fit.nEnd;
      if (members.length) {
        fits.set(fit.nNode, members.map(({ nNode, flWeight }) => [nNode, flWeight]));
      }
    }
    const bases = new Map();
    for (const base of fe.m_NodeBases ?? []) {
      const corners = [base.nNodeX0, base.nNodeX1, base.nNodeY0, base.nNodeY1];
      if (corners.every((c) => c < n)) {
        bases.set(base.nNode, corners);
      }
    }
    // Nodes the animation holds whose turn is still the cloth's
    const rotationLocked = fe.m_nRotLockStaticNodes ?? 0;
    const even = (nodes) => nodes.map((node) => [node, 1]);
    for (let i = 0; i < n; i++) {
      const bone = boneOf[i];
      if (!bone) {
        continue;
      }
      const held = i < firstDriven && !this.moving[i] && !carried[i];
      if (held && !(i >= rotationLocked && bases.has(i))) {
        continue;
      }
      const driven = { bone };
      if (fits.has(i)) {
        driven.fit = fits.get(i);
        driven.anchor = driven.fit;
      } else if (bases.has(i)) {
        // The axes the four nodes span would be the game's way, but on small parts the nodes lie
        // an inch or two apart and the axes flip about with the least movement: the best fit of
        // the same four turns the bone alike and holds still
        const corners = [...new Set(bases.get(i))];
        driven.fit = even(corners);
        driven.anchor = held || this.moving[i] ? [[i, 1]] : reverse.has(i) ? [[reverse.get(i), 1]] : hangers.has(i) ? even(hangers.get(i)) : driven.fit;
      } else if (this.moving[i]) {
        // Turned towards a child bone that is a node too, or on from its parent node
        const child = bone.children.find((node) => nodeOfBone.has(node));
        driven.aim = child ? [i, nodeOfBone.get(child)] : nodeOfBone.has(bone.parent) ? [nodeOfBone.get(bone.parent), i] : null;
        driven.anchor = [[i, 1]];
      } else if (hangers.has(i)) {
        driven.fit = even(hangers.get(i));
        driven.anchor = reverse.has(i) ? [[reverse.get(i), 1]] : driven.fit;
      } else if (reverse.has(i)) {
        driven.anchor = [[reverse.get(i), 1]];
      } else {
        continue;
      }
      if (driven.fit) {
        driven.rotation = new THREE.Quaternion();
      }
      this.driven.push(driven);
    }
    const depth = (node) => {
      let d = 0;
      for (let p = node.parent; p; p = p.parent) d++;
      return d;
    };
    this.driven.sort((a, b) => depth(a.bone) - depth(b.bone));
    for (const driven of this.driven) {
      driven.saved = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3() };
      driven.world = new THREE.Matrix4();
      driven.change = new THREE.Matrix4();
    }

    this.x = new Float64Array(n * 3);
    this.previous = new Float64Array(n * 3);
    this.last = new Float64Array(n * 3);
    this.target = new Float64Array(n * 3);
    this.targetBefore = new Float64Array(n * 3);
    this.step = new Float64Array(n * 3);
    this.stepBefore = new Float64Array(n * 3);
    this.started = false;
    this.lastStep = STEP;
    this.groupBefore = new THREE.Matrix4();
    this.capture();
  }

  // Whether there is anything to move
  get empty() {
    return this.driven.length === 0;
  }

  // The bones' animated transforms kept, to be put back before the next frame's animation:
  // bones the animation has no track for would otherwise keep what the cloth did and add to it
  capture() {
    for (const { bone, saved } of this.driven) {
      saved.position.copy(bone.position);
      saved.quaternion.copy(bone.quaternion);
      saved.scale.copy(bone.scale);
    }
  }

  restore() {
    for (const { bone, saved } of this.driven) {
      bone.position.copy(saved.position);
      bone.quaternion.copy(saved.quaternion);
      bone.scale.copy(saved.scale);
    }
  }

  // Starts over from the animation's pose, as when the model has just come in
  reset() {
    this.started = false;
  }

  // Moves the cloth on by dt seconds and turns and moves its bones. The bones' world matrices must
  // be those of the animation (restore() before the animation, then updateMatrixWorld). `view`, a
  // rotation of the world, is the frame the cloth moves in: the free camera going round the hero
  // passes the turn, so the cloth swings as when the hero is turned and the camera stays.
  update(dt, view = null) {
    if (!this.n || this.empty) {
      return;
    }
    const groupWorld = m1.copy(this.group.matrixWorld);
    if (view) {
      groupWorld.premultiply(view);
    }
    // Inches to the world's units
    const unit = SOURCE_TO_METRES * v1.setFromMatrixColumn(groupWorld, 0).length();
    for (const frame of this.frames) {
      frame.world.copy(frame.bone.matrixWorld);
      if (view) {
        frame.world.premultiply(view);
      }
    }
    for (const driven of this.driven) {
      driven.world.copy(driven.bone.matrixWorld);
    }
    this.targets(this.target, groupWorld);

    const { n, moving, x, previous, target, targetBefore, step } = this;
    if (!this.started || !(dt >= 0)) {
      x.set(target);
      previous.set(target);
      targetBefore.set(target);
      step.set(target);
      this.groupBefore.copy(groupWorld);
      this.started = true;
    }
    // Some cloth feels the model's own movement less (m_flLocalForce): carried along by that share
    if (this.localForce < 1) {
      const carry = m2.copy(this.groupBefore).invert().premultiply(groupWorld);
      const share = 1 - this.localForce;
      for (const array of [x, previous]) {
        for (let i = 0; i < n; i++) {
          if (moving[i]) {
            v1.fromArray(array, i * 3);
            v2.copy(v1).applyMatrix4(carry);
            v1.lerp(v2, share).toArray(array, i * 3);
          }
        }
      }
    }
    this.groupBefore.copy(groupWorld);

    const steps = Math.min(MAX_STEPS, Math.max(1, Math.ceil(dt / STEP - 1e-6)));
    const h = dt / steps;
    if (h > 0) {
      this.placeShapes();
      for (let s = 1; s <= steps; s++) {
        const share = s / steps;
        this.stepBefore.set(step);
        for (let k = 0; k < n * 3; k++) {
          step[k] = targetBefore[k] + (target[k] - targetBefore[k]) * share;
        }
        this.advance(h, unit);
      }
    }
    targetBefore.set(target);

    // Lost (a jump the cloth cannot follow, or numbers gone wrong): back to the animation's pose
    const lost = LOST * unit;
    for (let i = 0; i < n * 3; i++) {
      if (!(Math.abs(x[i] - target[i]) < lost)) {
        x.set(target);
        previous.set(target);
        break;
      }
    }
    this.pose(view);
  }

  // Where the animation puts every node
  targets(out, groupWorld) {
    for (let i = 0; i < this.n; i++) {
      const { frame, point } = this.anchors[i];
      v1.copy(point).applyMatrix4(frame >= 0 ? this.frames[frame].world : groupWorld).toArray(out, i * 3);
    }
  }

  placeShapes() {
    for (const shape of this.shapes) {
      const world = shape.frame >= 0 ? this.frames[shape.frame].world : this.groupBefore;
      shape.c0.copy(shape.p0).applyMatrix4(world);
      shape.c1.copy(shape.p1).applyMatrix4(world);
    }
  }

  advance(h, unit) {
    const { n, moving, x, previous, last, step, stepBefore, damping, force, pull, gravity } = this;
    last.set(x);
    const ratio = h / this.lastStep;
    this.lastStep = h;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      if (!moving[i]) {
        x[k] = step[k];
        x[k + 1] = step[k + 1];
        x[k + 2] = step[k + 2];
        continue;
      }
      const keep = Math.exp(-damping[i] * h);
      const toward = 1 - Math.exp(-pull[i] * h);
      for (let c = 0; c < 3; c++) {
        const position = x[k + c];
        // Damped towards the animation's own movement, not towards rest: following the body
        // is not slowed down, only swinging about it
        const carried = tuning.relative ? step[k + c] - stepBefore[k + c] : 0;
        const velocity = carried + ((position - previous[k + c]) * ratio - carried) * keep;
        let acceleration = force[i] * (step[k + c] - position);
        if (c === 1) {
          acceleration -= gravity[i] * unit;
        }
        let next = position + velocity + acceleration * h * h;
        next += (step[k + c] - next) * toward;
        previous[k + c] = position;
        x[k + c] = next;
      }
    }
    // Nodes carried by another's movement (both places, so it adds no speed)
    for (const { nParentNode: p, nChildNode: c, flWeight: w } of this.follows) {
      for (let a = 0; a < 3; a++) {
        const move = (x[p * 3 + a] - last[p * 3 + a]) * w;
        x[c * 3 + a] += move;
        previous[c * 3 + a] += move;
      }
    }
    for (const i of this.locks) {
      for (let a = 0; a < 3; a++) {
        x[i * 3 + a] = previous[i * 3 + a] = step[i * 3 + a];
      }
    }
    for (const { nCtrlParent: p, nCtrlChild: c } of this.lockToParent) {
      for (let a = 0; a < 3; a++) {
        x[c * 3 + a] = previous[c * 3 + a] = x[p * 3 + a] + step[c * 3 + a] - step[p * 3 + a];
      }
    }
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      this.solveRods(unit);
      this.solveStrays(unit);
      this.collide(unit);
    }
  }

  solveRods(unit) {
    const { x } = this;
    for (const { a, b, min, max, w0, relax } of this.rods) {
      const dx = x[b * 3] - x[a * 3];
      const dy = x[b * 3 + 1] - x[a * 3 + 1];
      const dz = x[b * 3 + 2] - x[a * 3 + 2];
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (length < 1e-9) {
        continue;
      }
      const bound = length > max * unit ? max * unit : length < min * unit ? min * unit : length;
      if (bound === length) {
        continue;
      }
      const amount = ((length - bound) / length) * relax;
      const toA = amount * w0;
      const toB = amount * (1 - w0);
      x[a * 3] += dx * toA;
      x[a * 3 + 1] += dy * toA;
      x[a * 3 + 2] += dz * toA;
      x[b * 3] -= dx * toB;
      x[b * 3 + 1] -= dy * toB;
      x[b * 3 + 2] -= dz * toB;
    }
  }

  // Nodes kept within a distance of where the animation puts a node (themselves, mostly)
  solveStrays(unit) {
    const { x, step } = this;
    for (const { a, b, max, relax } of this.strays) {
      const dx = x[b * 3] - step[a * 3];
      const dy = x[b * 3 + 1] - step[a * 3 + 1];
      const dz = x[b * 3 + 2] - step[a * 3 + 2];
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const limit = max * unit;
      if (length > limit) {
        const amount = (1 - limit / length) * relax;
        x[b * 3] -= dx * amount;
        x[b * 3 + 1] -= dy * amount;
        x[b * 3 + 2] -= dz * amount;
      }
    }
  }

  collide(unit) {
    const { n, moving, x, radius } = this;
    for (const shape of this.shapes) {
      for (let i = 0; i < n; i++) {
        if (!moving[i] || shape.holds[i]) {
          continue;
        }
        v1.fromArray(x, i * 3);
        const { distance, radius: r, point } = closest(v1, shape.c0, shape.r0 * unit, shape.c1, shape.r1 * unit);
        const reach = r + radius[i] * unit;
        if (distance < reach && distance > 1e-9) {
          v1.sub(point).multiplyScalar(reach / distance).add(point).toArray(x, i * 3);
        }
      }
    }
  }

  // Turns and moves the cloth's bones by what the cloth did on top of the animation
  pose(view) {
    const { x, target } = this;
    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const viewInverse = view ? view.clone().invert() : null;
    const covariance = new Float64Array(9);
    this.capture();
    for (const driven of this.driven) {
      rotation.identity();
      if (driven.fit) {
        // The rotation that best takes the group's animated places to where the nodes are
        mean(driven.fit, target, from);
        mean(driven.fit, x, to);
        covariance.fill(0);
        for (const [i, w] of driven.fit) {
          const px = x[i * 3] - to.x;
          const py = x[i * 3 + 1] - to.y;
          const pz = x[i * 3 + 2] - to.z;
          const qx = target[i * 3] - from.x;
          const qy = target[i * 3 + 1] - from.y;
          const qz = target[i * 3 + 2] - from.z;
          covariance[0] += w * px * qx;
          covariance[1] += w * px * qy;
          covariance[2] += w * px * qz;
          covariance[3] += w * py * qx;
          covariance[4] += w * py * qy;
          covariance[5] += w * py * qz;
          covariance[6] += w * pz * qx;
          covariance[7] += w * pz * qy;
          covariance[8] += w * pz * qz;
        }
        rotation.copy(extractRotation(covariance, driven.rotation));
      } else if (driven.aim) {
        const [a, b] = driven.aim;
        v2.set(target[b * 3] - target[a * 3], target[b * 3 + 1] - target[a * 3 + 1], target[b * 3 + 2] - target[a * 3 + 2]);
        v3.set(x[b * 3] - x[a * 3], x[b * 3 + 1] - x[a * 3 + 1], x[b * 3 + 2] - x[a * 3 + 2]);
        if (v2.lengthSq() > 1e-12 && v3.lengthSq() > 1e-12) {
          rotation.setFromUnitVectors(v2.normalize(), v3.normalize());
        }
      }
      mean(driven.anchor, target, from);
      mean(driven.anchor, x, to);
      // world = view⁻¹ · (turn about `from`, then move it to `to`) · view · animated world
      const change = driven.change.makeRotationFromQuaternion(rotation);
      v1.copy(from).applyQuaternion(rotation);
      change.setPosition(to.x - v1.x, to.y - v1.y, to.z - v1.z);
      if (view) {
        change.multiply(view).premultiply(viewInverse);
      }
      const world = m1.multiplyMatrices(change, driven.world);
      const bone = driven.bone;
      bone.parent.updateWorldMatrix(true, false);
      world.premultiply(m2.copy(bone.parent.matrixWorld).invert());
      world.decompose(bone.position, bone.quaternion, v1);
      bone.updateMatrixWorld();
    }
  }
}

// The weighted mean of the nodes' places ([node, weight] pairs)
function mean(nodes, positions, out) {
  out.set(0, 0, 0);
  let total = 0;
  for (const [i, w] of nodes) {
    out.x += positions[i * 3] * w;
    out.y += positions[i * 3 + 1] * w;
    out.z += positions[i * 3 + 2] * w;
    total += w;
  }
  return total > 0 ? out.divideScalar(total) : out;
}

// The nearest point to `point` on the segment between two sphere centres, its distance and the
// radius there (a tapered capsule; a sphere when both are one)
const segment = new THREE.Vector3();
const nearest = new THREE.Vector3();
function closest(point, c0, r0, c1, r1) {
  segment.subVectors(c1, c0);
  const lengthSq = segment.lengthSq();
  const t = lengthSq > 1e-12 ? THREE.MathUtils.clamp(nearest.subVectors(point, c0).dot(segment) / lengthSq, 0, 1) : 0;
  nearest.copy(c0).addScaledVector(segment, t);
  return { point: nearest, distance: point.distanceTo(nearest), radius: r0 + (r1 - r0) * t };
}
