import * as THREE from "three";

// The particles run in the game's units and axes (x ahead, y left, z up, inches), as their
// parameters are given; the scene is in metres with y up and the hero facing +z
export const UNIT = 0.0254;

export function toScene(source, target = new THREE.Vector3()) {
  return target.set(source.y * UNIT, source.z * UNIT, source.x * UNIT);
}

export function toSource(scene, target = new THREE.Vector3()) {
  return target.set(scene.z / UNIT, scene.x / UNIT, scene.y / UNIT);
}

// The scene's rotations in the game's axes: the permutation conjugated, R_source = Pᵀ R_scene P
const P = new THREE.Matrix4().set(0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1);
const PT = P.clone().transpose();
const rotation = new THREE.Matrix4();
export function quaternionToSource(scene, target = new THREE.Quaternion()) {
  rotation.makeRotationFromQuaternion(scene);
  rotation.premultiply(PT).multiply(P);
  return target.setFromRotationMatrix(rotation);
}

// Pᵀ, the scene's axes back to the game's, as a turn
const TO_SOURCE_AXES = new THREE.Quaternion().setFromRotationMatrix(PT);
const offset = new THREE.Vector3();
const boneTurn = new THREE.Quaternion();

// An attachment's place and turn in the scene, from the bones it hangs on (a Map of the model's
// bones by name); false when none of them is there. Its offsets and turns are in the bones' own
// space: the bones keep the game's axes, so they apply as they are (only inches to metres).
export function attachmentTransform(attachment, bones, position, quaternion) {
  position.set(0, 0, 0);
  let weightSum = 0;
  let first = true;
  for (const [name, weight, offsetIn = [0, 0, 0], rotation = [0, 0, 0, 1]] of attachment.bones) {
    const bone = bones.get(name);
    if (!bone || !weight) continue;
    bone.updateWorldMatrix(true, false);
    offset.set((offsetIn[0] ?? 0) * UNIT, (offsetIn[1] ?? 0) * UNIT, (offsetIn[2] ?? 0) * UNIT).applyMatrix4(bone.matrixWorld);
    position.addScaledVector(offset, weight);
    weightSum += weight;
    if (first) {
      bone.getWorldQuaternion(quaternion);
      // The bone's axes are the game's, so its turn is put in the scene's terms the other way
      // round from the model's (whose axes are the scene's): turned back by the axes'
      // permutation here, as the control point takes it through quaternionToSource
      boneTurn.set(rotation[0] ?? 0, rotation[1] ?? 0, rotation[2] ?? 0, rotation[3] ?? 1);
      quaternion.multiply(boneTurn).multiply(TO_SOURCE_AXES);
      first = false;
    }
  }
  if (weightSum <= 0) return false;
  position.divideScalar(weightSum);
  return true;
}

// The bones of a model's scene by name, the first of each name
export function bonesOf(root) {
  const bones = new Map();
  root.traverse((node) => {
    if (node.isBone && !bones.has(node.name)) bones.set(node.name, node);
  });
  return bones;
}

export const random = (min, max) => min + Math.random() * (max - min);
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
export const smooth = (t) => t * t * (3 - 2 * t);

// Source's bias: t pushed towards 0 or 1 around 0.5
export function bias(t, amount) {
  if (amount === 0.5) {
    return t;
  }
  return t / ((1 / amount - 2) * (1 - t) + 1);
}

export function remap(value, in0, in1, out0, out1, clamped = true) {
  if (in1 === in0) {
    return value >= in1 ? out1 : out0;
  }
  let t = (value - in0) / (in1 - in0);
  if (clamped) {
    t = clamp(t, 0, 1);
  }
  return out0 + (out1 - out0) * t;
}

// A curve of the particle editor: points with their slopes, Hermite between them
export function evaluateCurve(curve, x) {
  const points = curve?.m_spline;
  if (!points?.length) {
    return 0;
  }
  if (x <= points[0].x) {
    return points[0].y;
  }
  const last = points[points.length - 1];
  if (x >= last.x) {
    return last.y;
  }
  let index = 1;
  while (points[index].x < x) {
    index++;
  }
  const a = points[index - 1];
  const b = points[index];
  const span = b.x - a.x;
  const t = (x - a.x) / span;
  const t2 = t * t;
  const t3 = t2 * t;
  const slopeA = (a.m_flSlopeOutgoing ?? 0) * span;
  const slopeB = (b.m_flSlopeIncoming ?? 0) * span;
  return (2 * t3 - 3 * t2 + 1) * a.y + (t3 - 2 * t2 + t) * slopeA + (-2 * t3 + 3 * t2) * b.y + (t3 - t2) * slopeB;
}

// Smooth value noise in 1 to 3 dimensions, -1..1
const perm = new Uint8Array(512);
for (let i = 0; i < 256; i++) {
  perm[i] = i;
}
for (let i = 255; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [perm[i], perm[j]] = [perm[j], perm[i]];
}
for (let i = 0; i < 256; i++) {
  perm[i + 256] = perm[i];
}
const grad = (hash, x, y, z) => {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
};
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export function noise(x, y = 0, z = 0) {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);
  const u = fade(x);
  const v = fade(y);
  const w = fade(z);
  const A = perm[X] + Y;
  const AA = perm[A] + Z;
  const AB = perm[A + 1] + Z;
  const B = perm[X + 1] + Y;
  const BA = perm[B] + Z;
  const BB = perm[B + 1] + Z;
  return lerp(
    lerp(lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u), lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u), v),
    lerp(
      lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u),
      lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u),
      v
    ),
    w
  );
}

// A random point within the unit sphere
export function randomInSphere(target) {
  for (;;) {
    const x = Math.random() * 2 - 1;
    const y = Math.random() * 2 - 1;
    const z = Math.random() * 2 - 1;
    if (x * x + y * y + z * z <= 1) {
      return target.set(x, y, z);
    }
  }
}

export const vec = (value, fallback = [0, 0, 0]) => {
  const array = Array.isArray(value) ? value : fallback;
  return new THREE.Vector3(array[0] ?? 0, array[1] ?? 0, array[2] ?? 0);
};

// Colors in the files are 0..255
export const color = (value, fallback = [255, 255, 255]) => {
  const array = Array.isArray(value) ? value : fallback;
  return [(array[0] ?? 255) / 255, (array[1] ?? 255) / 255, (array[2] ?? 255) / 255, (array[3] ?? 255) / 255];
};
