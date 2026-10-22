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
// Wind: the model's wind effects (m_Effects), started by its animations' events (the tracker puts
// them in the file as `events`), blow as the game's do (see Wind).
//
// Not done: triangles and quads (cloth stiffness on surfaces, 39 models), twists and hinges,
// boxes, stiffening effects, each node's collision masks, per-node local force.

const SOURCE_TO_METRES = 0.0254;
// The game moves its cloth in fixed steps (the client's physics substeps; settling a new model's
// cloth uses steps of 1/60 s), and its pulls depend on the step's length
const STEP = 1 / 60;
// At most this many steps a frame: a long stall is skipped, not caught up with
const MAX_STEPS = 8;
// New cloth is settled before it is shown, as the game settles a new model's: this many steps in
// the pose it comes in with, its speed cut by a share each step so it comes to rest where it
// hangs (Tidehunter's fish otherwise fell from the animation's pose for seconds in front of you)
const SETTLE_STEPS = 300;
const SETTLE_KEEP = 0.9;
// Rods and collisions solved this many times a step
const ITERATIONS = 4;
// A node this far from its place in the animation (inches) means the solver lost it: start over
const LOST = 400;
// m_nDynamicNodeFlags: damped by flPointDamping; pulled to the animation as a goal (see advance)
const POINT_DAMPING = 0x100;
const GOAL = 0x80;

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
const m3 = new THREE.Matrix4();
const v4 = new THREE.Vector3();
const v5 = new THREE.Vector3();

// m_Effects' type of wind (ClothEffectWind; 3 is stiffening)
const WIND = 1;
// Source's axes to the glTF's, as a turn
const SOURCE_AXES = new THREE.Matrix3().set(0, 1, 0, 0, 0, 1, 1, 0, 0);
const random = (low, high) => low + Math.random() * (high - low);

// A wind effect as the game blows it (vphysics2.dll, CSoftbodyEffectWind): a steady wind
// (Strength, inches per second, in the model's space or its Node's, faded in and out over the
// event's peak, tail and end) and up to eight vortices: random planes cut into cells of 32 of
// their units, each cell turning the air one way or the other, carried along by the wind, each
// vortex fading in and out over a random time and made anew. Each moving node is pushed towards
// the air's speed across it (across its cloth's surface, or across its rod), by at most all of the
// difference: min(1, |difference per step in inches| × AirToCloth) of it, AirToCloth weighted by
// the effect's vertex map where it names one.
class Wind {
  // kind: the effect as Cloth keeps it ({ effect, take, node, rest })
  constructor(kind, [peak, tail, end]) {
    this.kind = kind;
    this.name = kind.effect.sName;
    this.params = kind.effect.m_Params;
    // The effect's space to the cloth's, set each frame
    this.turn = new THREE.Matrix3();
    this.time = 0;
    this.peak = peak;
    this.tail = tail;
    this.end = end;
    // Without an end it lasts until stopped (or the animation changes)
    this.weight = end > 0 && peak > 0 ? 0 : 1;
    this.vortices = (this.params.Vortices ?? [])
      .filter(({ MaxSpeed, MaxCell }) => MaxSpeed > 0 && MaxCell > 0)
      .slice(0, 8)
      .map((vortex) => this.renew({ maxSpeed: vortex.MaxSpeed, maxCell: vortex.MaxCell, choppiness: vortex.Choppiness ?? 1 }));
    // This step's steady wind, inches per second in the cloth's space
    this.air = new THREE.Vector3();
  }

  // A vortex made anew: a random plane and place, size, speed and lifetime
  renew(vortex) {
    // A random rotation (Shoemake): its x and y axes span the plane
    const u1 = Math.random();
    const u2 = Math.random() * Math.PI * 2;
    const u3 = Math.random() * Math.PI * 2;
    const q = new THREE.Quaternion(Math.sqrt(1 - u1) * Math.sin(u2), Math.sqrt(1 - u1) * Math.cos(u2), Math.sqrt(u1) * Math.sin(u3), Math.sqrt(u1) * Math.cos(u3));
    const size = random(1 / 3, 1) * vortex.maxCell;
    const scale = size / 32;
    vortex.a = new THREE.Vector3(1, 0, 0).applyQuaternion(q).divideScalar(scale);
    vortex.b = new THREE.Vector3(0, 1, 0).applyQuaternion(q).divideScalar(scale);
    const offset = new THREE.Vector3(random(-size, size), random(-size, size), random(-size, size));
    vortex.sa = vortex.a.dot(offset);
    vortex.sb = vortex.b.dot(offset);
    vortex.amplitude = 0;
    vortex.rate = random(vortex.choppiness / 3, vortex.choppiness);
    vortex.fade = vortex.rate < 1e-7 ? 0 : Math.min(vortex.rate * 0.25, 0.08);
    vortex.phase = vortex.rate < 1e-7 ? 0 : -1 - vortex.fade;
    vortex.peak = random(1 / 3, 1) * vortex.maxSpeed * scale * 2;
    return vortex;
  }

  // On by h seconds; false once it has ended
  advance(h) {
    if (this.end > 0) {
      this.time += h;
      if (this.time <= this.peak) {
        this.weight = this.time / this.peak;
      } else if (this.time <= this.tail) {
        this.weight = 1;
      } else if (this.time < this.end) {
        this.weight = (this.end - this.time) / (this.end - this.tail);
      } else {
        return false;
      }
    }
    const [x, y, z] = this.params.Strength ?? [0, 0, 0];
    this.air.set(x, y, z).multiplyScalar(this.weight).applyMatrix3(this.turn);
    for (const vortex of this.vortices) {
      vortex.phase += h * vortex.rate;
      const phase = Math.abs(vortex.phase);
      if (phase <= 1) {
        vortex.amplitude = vortex.peak;
      } else if (phase < 1 + vortex.fade) {
        vortex.amplitude = ((1 + vortex.fade - phase) / vortex.fade) ** 2 * vortex.peak;
      } else {
        this.renew(vortex);
      }
      // The vortices go with the wind
      vortex.sa += vortex.a.dot(this.air) * h;
      vortex.sb += vortex.b.dot(this.air) * h;
    }
    return true;
  }

  // The air's speed at a point (inches, inches per second)
  at(px, py, pz, out) {
    out.copy(this.air);
    for (const { a, b, sa, sb, amplitude } of this.vortices) {
      let u = a.x * px + a.y * py + a.z * pz - sa;
      let w = b.x * px + b.y * py + b.z * pz - sb;
      const cu = Math.trunc(u) & ~31;
      const cw = Math.trunc(w) & ~31;
      u -= cu + 16;
      w -= cw + 16;
      const s = amplitude / Math.max(2, u * u + w * w);
      u *= s;
      w *= s;
      if ((cu ^ cw) & 32) {
        u = -u;
      } else {
        w = -w;
      }
      out.x += a.x * u + b.x * w;
      out.y += a.y * u + b.y * w;
      out.z += a.z * u + b.z * w;
    }
    return out;
  }
}

export class Cloth {
  // fe: the model's FeModel; group: the shown model, its bones by name (any letter case) and
  // each bone's bind pose in userData.rest; animated: the names (lower case) of the bones the
  // model's animations move, when known
  constructor(fe, group, animated = null) {
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
    // A side node hangs off the node it is kept beside, when nothing else says (76 models give no
    // m_SkelParents: Tidehunter's fish had its side nodes in the model's space by his feet, and
    // its rods pulled the fish down and stretched it)
    for (const offset of fe.m_CtrlOsOffsets ?? []) {
      if (offset.nCtrlChild < n && offset.nCtrlParent < n && parent[offset.nCtrlChild] < 0) {
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
            this.frames.push({ bone, node: j, inverseRest: restMatrix(bone, group).invert(), world: new THREE.Matrix4() });
          }
          return frameIndex.get(bone);
        }
      }
      return -1;
    };
    const pose = fe.m_InitPose ?? [];
    const IDENTITY = [0, 0, 0, 1, 0, 0, 0, 1];
    // A point given in a node's own space (inches) where the bone carrying it has it. Mostly the
    // InitPose is the glb's rest pose and the point is measured from the bone's rest. Where a bone
    // the animations hold rests elsewhere than its InitPose (Tidehunter's hook bones rest by his
    // feet, the cloth was made with the anchor in his hand: from the rest its nodes were put 130
    // inches off their own bones, and the anchor stretched to the floor), the node is the bone and
    // the point is taken from it within the InitPose, the bones keeping the game's axes
    const restOff = (j) => {
      const at = new THREE.Vector3().setFromMatrixPosition(restMatrix(boneOf[j], group));
      const p = pose[j];
      return Math.hypot(at.z / SOURCE_TO_METRES - p[0], at.x / SOURCE_TO_METRES - p[1], at.y / SOURCE_TO_METRES - p[2]) > 1;
    };
    const byAnimation = (j) => j < firstDriven && !carried[j] && pose[j] && (!animated || animated.has(boneOf[j].name.toLowerCase())) && restOff(j);
    const local = (node, offset = [0, 0, 0]) => {
      const frame = frameOf(node);
      const at = inNodeSpace(pose[node] ?? IDENTITY, offset);
      const base = frame >= 0 && node < firstDriven && byAnimation(this.frames[frame].node) && pose[this.frames[frame].node];
      if (base) {
        at.sub(new THREE.Vector3(base[0], base[1], base[2])).applyQuaternion(new THREE.Quaternion(base[4], base[5], base[6], base[7]).invert());
        return { frame, point: at.multiplyScalar(SOURCE_TO_METRES) };
      }
      const model = fromSource(at.x, at.y, at.z);
      return { frame, point: frame >= 0 ? model.applyMatrix4(this.frames[frame].inverseRest) : model };
    };
    this.anchors = Array.from({ length: n }, (_, i) => local(i));

    const integrator = fe.m_NodeIntegrator ?? [];
    const gravityScale = fe.m_flDefaultGravityScale ?? 1;
    const flags = fe.m_nDynamicNodeFlags ?? 0;
    this.pointDamping = Boolean(flags & POINT_DAMPING);
    this.goal = Boolean(flags & GOAL);
    this.damping = Float64Array.from({ length: n }, (_, i) => integrator[i]?.flPointDamping ?? 0);
    this.force = Float64Array.from({ length: n }, (_, i) => integrator[i]?.flAnimationForceAttraction ?? 0);
    this.pull = Float64Array.from({ length: n }, (_, i) => integrator[i]?.flAnimationVertexAttraction ?? 0);
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

    // Nodes that touch the world (m_WorldCollisionNodes, each list's friction from
    // m_WorldCollisionParams): kept above the ground the model stands on, which takes their speed
    // along it by the ground's friction (Tidehunter's fish, hanging from his hand, went through
    // the floor)
    const worldNodes = fe.m_WorldCollisionNodes ?? [];
    // The floor here is the world's: its friction is the larger of the two the list gives (Tidehunter's
    // fish slid on a floor without friction after his spawn and ended between his legs).
    // m_flAddWorldCollisionRadius is no contact radius (24 inches on Necrophos' robe)
    this.grounded = (fe.m_WorldCollisionParams ?? []).flatMap(({ nListBegin = 0, nListEnd = 0, flGroundFriction = 0, flWorldFriction = 0 }) =>
      worldNodes.slice(nListBegin, nListEnd).filter((i) => i < n && this.moving[i]).map((i) => [i, THREE.MathUtils.clamp(Math.max(flGroundFriction, flWorldFriction), 0, 1)])
    );

    this.ground = 0;

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
      const a = local(node, s0);
      const b = local(node, s1);
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
    // A node's side partner (m_CtrlOsOffsets: a node kept beside it, the second column of a strip
    // of bones), which gives the bone's turn about its length
    const side = new Map((fe.m_CtrlOsOffsets ?? []).filter(({ nCtrlParent: p, nCtrlChild: c }) => p < n && c < n).map(({ nCtrlParent, nCtrlChild }) => [nCtrlParent, nCtrlChild]));
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
        if (driven.aim && side.has(i)) driven.side = side.get(i);
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

    // Wind effects by name, with how strongly the air takes each node: AirToCloth, weighted by the
    // effect's vertex map where it names one (the map's values, out of 255, for its nodes from
    // the first moving one on, read from the map's start as the game does)
    this.events = fe.events ?? {};
    this.staticCount = staticCount;
    this.windBases = (fe.m_DynNodeWindBases ?? []).map(({ nNodeX0, nNodeX1, nNodeY0, nNodeY1 }) =>
      [nNodeX0, nNodeX1, nNodeY0, nNodeY1].every((c) => c < n) ? [nNodeX0, nNodeX1, nNodeY0, nNodeY1] : null
    );
    this.windKinds = new Map();
    const maps = fe.m_VertexMaps ?? [];
    const mapValues = fe.m_VertexMapValues ?? [];
    for (const effect of fe.m_Effects ?? []) {
      const params = effect.m_Params ?? {};
      const still = (params.Strength ?? [0, 0, 0]).every((c) => !c) && !params.Vortices?.length;
      if (effect.nType !== WIND || !(params.AirToCloth > 0) || still) {
        continue;
      }
      const take = new Float64Array(n);
      const map = params.VertexMap ? maps.find(({ nNameHash }) => nNameHash === params.VertexMap >>> 0) : null;
      if (map) {
        let first = map.nVertexBase ?? 0;
        let count = map.nVertexCount ?? 0;
        if (first < staticCount) {
          count = Math.max(0, count - (staticCount - first));
          first = staticCount;
        }
        for (let j = 0; j < count && first + j < n; j++) {
          take[first + j] = ((mapValues[(map.nMapOffset ?? 0) + j] ?? 0) / 255) * params.AirToCloth;
        }
      } else {
        take.fill(params.AirToCloth, staticCount);
      }
      // Strength in a node's space: that node's turn in the pose the cloth was made in
      const node = params.Node >= 0 && params.Node < n && pose[params.Node] ? params.Node : -1;
      const rest = node >= 0 ? new THREE.Matrix3().setFromMatrix4(m3.makeRotationFromQuaternion(new THREE.Quaternion(...pose[node].slice(4, 8)))) : null;
      this.windKinds.set(effect.sName, { effect, take, node, rest });
    }
    this.winds = [];

    this.x = new Float64Array(n * 3);
    this.previous = new Float64Array(n * 3);
    this.last = new Float64Array(n * 3);
    this.target = new Float64Array(n * 3);
    this.targetBefore = new Float64Array(n * 3);
    this.step = new Float64Array(n * 3);
    this.shown = new Float64Array(n * 3);
    this.started = false;
    // Time not yet stepped (seconds)
    this.pending = 0;
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

  // An effect an animation's event starts (operation 0, or 1 with no end) or stops (2); one of the
  // same name already blowing is replaced
  startEffect(name, envelope, operation) {
    const kind = this.windKinds.get(name);
    if (!kind) {
      return;
    }
    this.winds = this.winds.filter((wind) => wind.name !== name);
    if (operation !== 2) {
      this.winds.push(new Wind(kind, envelope));
    }
  }

  // Effects with no end belong to the animation that started them: stopped when it changes
  endHeldEffects() {
    this.winds = this.winds.filter((wind) => wind.end > 0);
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
    // The ground: level with the model's origin, where it stands
    this.ground = groupWorld.elements[13];
    for (const frame of this.frames) {
      frame.world.copy(frame.bone.matrixWorld);
      if (view) {
        frame.world.premultiply(view);
      }
    }
    for (const driven of this.driven) {
      driven.world.copy(driven.bone.matrixWorld);
    }
    // Each wind's space (the model's, or its node's as the animation turns it) to the cloth's,
    // inches to inches
    for (const wind of this.winds) {
      const { node, rest } = wind.kind;
      const frame = node >= 0 ? this.anchors[node].frame : -1;
      if (frame >= 0) {
        m3.multiplyMatrices(this.frames[frame].world, this.frames[frame].inverseRest);
      } else {
        m3.copy(groupWorld);
      }
      wind.turn.setFromMatrix4(m3).multiplyScalar(SOURCE_TO_METRES / unit).multiply(SOURCE_AXES);
      if (rest) {
        wind.turn.multiply(rest);
      }
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
      this.placeShapes();
      for (let s = 0; s < SETTLE_STEPS; s++) {
        this.advance(STEP, unit);
        for (let k = 0; k < n * 3; k++) {
          previous[k] = x[k] - (x[k] - previous[k]) * SETTLE_KEEP;
        }
      }
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

    // Whole steps of the time passed; the animation's places for each by when it falls in the frame
    const before = this.pending;
    this.pending += Math.max(dt, 0);
    const steps = Math.min(MAX_STEPS, Math.floor(this.pending / STEP));
    this.pending = steps === MAX_STEPS ? 0 : this.pending - steps * STEP;
    if (steps) {
      this.placeShapes();
      for (let s = 1; s <= steps; s++) {
        const share = dt > 0 ? THREE.MathUtils.clamp((s * STEP - before) / dt, 0, 1) : 1;
        for (let k = 0; k < n * 3; k++) {
          step[k] = targetBefore[k] + (target[k] - targetBefore[k]) * share;
        }
        this.advance(STEP, unit);
      }
    }
    targetBefore.set(target);

    // Lost (a jump the cloth cannot follow, or numbers gone wrong): back to the animation's pose
    const lost = LOST * unit;
    for (let i = 0; i < n * 3; i++) {
      if (!(Math.abs(x[i] - step[i]) < lost)) {
        x.set(step);
        previous.set(step);
        break;
      }
    }
    // Between steps the cloth keeps how far it was from the animation at the last one
    for (let k = 0; k < n * 3; k++) {
      this.shown[k] = x[k] - step[k] + target[k];
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

  // One step of the game's solver (vphysics2.dll, read from its code: the stages its profiler
  // names Predict, AddAnimationAttraction, Relax, AddGoalAttraction)
  advance(h, unit) {
    const { n, moving, x, previous, last, step, damping, force, pull, gravity } = this;
    if (this.winds.length) {
      this.blow(h, unit);
    }
    last.set(x);
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      if (!moving[i]) {
        x[k] = step[k];
        x[k + 1] = step[k + 1];
        x[k + 2] = step[k + 2];
        continue;
      }
      // Predict: on with its speed (damped only in models that ask for it), gravity down
      const keep = this.pointDamping ? Math.max(0, 1 - h * damping[i]) : 1;
      for (let c = 0; c < 3; c++) {
        const position = x[k + c];
        let next = position + (position - previous[k + c]) * keep;
        if (c === 1) {
          next -= gravity[i] * unit * h * h;
        }
        previous[k + c] = position;
        x[k + c] = next;
      }
      // AddAnimationAttraction (models without goals): drawn towards the animation by a share of
      // the way (flAnimationVertexAttraction per second) and pushed by a force (twice
      // flAnimationForceAttraction per second), the previous place moved so the draw adds little speed
      if (!this.goal) {
        const share = Math.min(1, pull[i] * h);
        const push = 2 * force[i] * h;
        for (let c = 0; c < 3; c++) {
          const towards = step[k + c] - x[k + c];
          x[k + c] += (share + push) * towards;
          previous[k + c] += share * (1 - share) * towards;
        }
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
    // AddGoalAttraction (models with goals, most): each step a share of the way to the animation
    // (flAnimationForceAttraction is the goal's strength), then its speed cut by a share
    // (flAnimationVertexAttraction is the goal's damping); a full goal holds the node there
    if (this.goal) {
      for (let i = 0; i < n; i++) {
        if (!moving[i]) {
          continue;
        }
        const strength = THREE.MathUtils.clamp(force[i], 0, 1);
        const keep = 1 - THREE.MathUtils.clamp(pull[i], 0, 1);
        for (let c = 0; c < 3; c++) {
          const k = i * 3 + c;
          if (strength >= 0.9999) {
            x[k] = previous[k] = step[k];
            continue;
          }
          x[k] = step[k] + (1 - strength) * (x[k] - step[k]);
          previous[k] = x[k] - (x[k] - previous[k]) * keep;
        }
      }
    }
  }

  // The winds on by a step, each pushing the nodes it takes: their speed (the previous place moved)
  // towards the air's, across the node's cloth (the normal of the two edges m_DynNodeWindBases
  // names) or across its rod (when both edges are one)
  blow(h, unit) {
    const { n, moving, x, previous, staticCount, windBases } = this;
    this.winds = this.winds.filter((wind) => wind.advance(h));
    const air = v1;
    const push = v2;
    for (const wind of this.winds) {
      const { take } = wind.kind;
      for (let i = staticCount; i < n; i++) {
        if (!moving[i] || !(take[i] > 0)) {
          continue;
        }
        const k = i * 3;
        wind.at(x[k] / unit, x[k + 1] / unit, x[k + 2] / unit, air);
        // The air's movement over the step less the node's own, in inches
        push.set(air.x * h - (x[k] - previous[k]) / unit, air.y * h - (x[k + 1] - previous[k + 1]) / unit, air.z * h - (x[k + 2] - previous[k + 2]) / unit);
        const base = windBases[i - staticCount];
        if (base) {
          const [x0, x1, y0, y1] = base;
          const edge = v4.set(x[x1 * 3] - x[x0 * 3], x[x1 * 3 + 1] - x[x0 * 3 + 1], x[x1 * 3 + 2] - x[x0 * 3 + 2]);
          if (y0 === y1) {
            if (edge.lengthSq() > 1e-12) {
              edge.normalize();
              push.addScaledVector(edge, -edge.dot(push));
            }
            push.multiplyScalar(Math.min(1, push.length() * take[i]));
          } else {
            const normal = v5.set(x[y1 * 3] - x[y0 * 3], x[y1 * 3 + 1] - x[y0 * 3 + 1], x[y1 * 3 + 2] - x[y0 * 3 + 2]).cross(edge);
            if (normal.lengthSq() > 1e-12) {
              normal.normalize();
            }
            const across = normal.dot(push);
            push.copy(normal).multiplyScalar(Math.min(1, Math.abs(across) * take[i]) * across);
          }
        } else {
          push.multiplyScalar(Math.min(1, push.length() * take[i]));
        }
        previous[k] -= push.x * unit;
        previous[k + 1] -= push.y * unit;
        previous[k + 2] -= push.z * unit;
      }
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
    const { n, moving, x, previous, radius } = this;
    for (const [i, friction] of this.grounded) {
      const floor = this.ground + radius[i] * unit;
      if (x[i * 3 + 1] < floor) {
        x[i * 3 + 1] = floor;
        previous[i * 3 + 1] = Math.min(previous[i * 3 + 1], floor);
        previous[i * 3] += (x[i * 3] - previous[i * 3]) * friction;
        previous[i * 3 + 2] += (x[i * 3 + 2] - previous[i * 3 + 2]) * friction;
      }
    }
    for (const shape of this.shapes) {
      for (let i = 0; i < n; i++) {
        if (!moving[i] || shape.holds[i]) {
          continue;
        }
        v1.fromArray(x, i * 3);
        const { distance, radius: r, point } = closest(v1, shape.c0, shape.r0 * unit, shape.c1, shape.r1 * unit);
        const reach = r + radius[i] * unit;
        if (distance >= reach) {
          continue;
        }
        // closest() hands back a shared vector; kept before it is called again
        const at = onAxis.copy(point);
        // A node that came in from outside this step (the hero turned fast) is put back out on
        // the side it came from: pushed to the nearest side, one that crossed the capsule's axis
        // would come out behind the leg and stay caught there
        v2.fromArray(previous, i * 3);
        const before = closest(v2, shape.c0, shape.r0 * unit, shape.c1, shape.r1 * unit);
        if (before.distance >= before.radius + radius[i] * unit) {
          v3.copy(shape.c1).sub(shape.c0);
          const length = v3.length();
          v2.sub(at);
          if (length > 1e-9) {
            v3.divideScalar(length);
            v2.addScaledVector(v3, -v2.dot(v3));
          }
          if (v2.lengthSq() > 1e-18) {
            v2.normalize().multiplyScalar(reach).add(at).toArray(x, i * 3);
            continue;
          }
        }
        if (distance > 1e-9) {
          v1.sub(at).multiplyScalar(reach / distance).add(at).toArray(x, i * 3);
        }
      }
    }
  }

  // Turns and moves the cloth's bones by what the cloth did on top of the animation
  pose(view) {
    const { shown: x, target } = this;
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
          if (driven.side === undefined) {
            rotation.setFromUnitVectors(v2.normalize(), v3.normalize());
          } else {
            // Turned along its length and about it: from the frame the animation gives the node,
            // its next node and its side partner to the frame they make now (Tidehunter's fish
            // twisted flat with its length alone)
            // While the pair folds together (on the ground) its side says little: the last turn it
            // gave, swung on with the length
            const c = driven.side;
            const own = driven.anchor[0][0];
            const width = (positions) => Math.hypot(positions[c * 3] - positions[own * 3], positions[c * 3 + 1] - positions[own * 3 + 1], positions[c * 3 + 2] - positions[own * 3 + 2]);
            const before = frameOf3(v2, target, own, c, m2);
            const now = width(x) >= 0.5 * width(target) && frameOf3(v3, x, own, c, m3);
            const length = v3.clone().normalize();
            // A pair that crossed over (its side on the other side of the length) would flip the
            // bone over at once: taken only while it agrees with the turn so far
            const predicted = driven.good && new THREE.Quaternion().setFromUnitVectors(driven.good.length, length).multiply(driven.good.rotation);
            if (before && now) rotation.setFromRotationMatrix(now.multiply(before.transpose()));
            if (before && now && (!predicted || rotation.angleTo(predicted) < Math.PI / 3)) {
              driven.good = { rotation: rotation.clone(), length };
            } else if (predicted) {
              rotation.copy(predicted);
              driven.good = { rotation: rotation.clone(), length };
            } else {
              rotation.setFromUnitVectors(v2.normalize(), length);
            }
          }
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

// An orthonormal frame (as a rotation matrix in `out`) from a length (`along`) and the way from
// node a to its side node c in `positions`; null when the two are parallel
const sideVector = new THREE.Vector3();
const thirdAxis = new THREE.Vector3();
function frameOf3(along, positions, a, c, out) {
  const u = along.clone().normalize();
  sideVector.set(positions[c * 3] - positions[a * 3], positions[c * 3 + 1] - positions[a * 3 + 1], positions[c * 3 + 2] - positions[a * 3 + 2]);
  sideVector.addScaledVector(u, -sideVector.dot(u));
  if (sideVector.lengthSq() < 1e-12) return null;
  sideVector.normalize();
  thirdAxis.crossVectors(u, sideVector);
  return out.makeBasis(u, sideVector, thirdAxis);
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
const onAxis = new THREE.Vector3();
function closest(point, c0, r0, c1, r1) {
  segment.subVectors(c1, c0);
  const lengthSq = segment.lengthSq();
  const t = lengthSq > 1e-12 ? THREE.MathUtils.clamp(nearest.subVectors(point, c0).dot(segment) / lengthSq, 0, 1) : 0;
  nearest.copy(c0).addScaledVector(segment, t);
  return { point: nearest, distance: point.distanceTo(nearest), radius: r0 + (r1 - r0) * t };
}
