// The game's particle operators by class: what each emitter, initializer, force, operator,
// constraint and control point setter does, with the defaults the game's schema gives the
// parameters a file leaves out. A class not here is skipped (and counted, see supportedClasses).
import * as THREE from "three";
import { compileFloat, compileVector } from "./inputs.js";
import { bias as biasOf, clamp, lerp, noise, random, randomInSphere, remap } from "./math.js";
import { RENDERERS } from "./render.js";
import { STEP, VECTOR_FIELDS } from "./system.js";

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const out3 = [0, 0, 0];
const deg = Math.PI / 180;

const arr = (value, fallback) => (Array.isArray(value) ? value : fallback);
const cpOf = (def, key = "m_nControlPointNumber") => def[key] ?? def.m_TransformInput?.m_nControlPoint ?? def.m_transformInput?.m_nControlPoint ?? 0;

// Writes a value to a field the way the operator asks: replace, scale or add to the initial value
function setter(def) {
  const method = def.m_nSetMethod ?? "PARTICLE_SET_REPLACE_VALUE";
  if (method === "PARTICLE_SET_SCALE_INITIAL_VALUE" || method === "PARTICLE_SET_SCALE_CURRENT_VALUE") {
    return (current, initial, value) => (method === "PARTICLE_SET_SCALE_CURRENT_VALUE" ? current : initial) * value;
  }
  if (method === "PARTICLE_SET_ADD_TO_INITIAL_VALUE" || method === "PARTICLE_SET_ADD_TO_CURRENT_VALUE") {
    return (current, initial, value) => (method === "PARTICLE_SET_ADD_TO_CURRENT_VALUE" ? current : initial) + value;
  }
  return (current, initial, value) => value;
}

function writeFloat(system, field, index, value) {
  if (VECTOR_FIELDS.has(field)) {
    const data = system.float(field);
    data[index * 3] = data[index * 3 + 1] = data[index * 3 + 2] = value;
  } else {
    system.float(field)[index] = value;
  }
}

// Sets a particle's velocity, kept as the distance it moved last step
function setVelocity(system, i, x, y, z, add = false) {
  const p = system.float(0);
  const q = system.float(2);
  if (add) {
    q[i * 3] -= x * STEP;
    q[i * 3 + 1] -= y * STEP;
    q[i * 3 + 2] -= z * STEP;
  } else {
    q[i * 3] = p[i * 3] - x * STEP;
    q[i * 3 + 1] = p[i * 3 + 1] - y * STEP;
    q[i * 3 + 2] = p[i * 3 + 2] - z * STEP;
  }
}

function move(system, i, x, y, z) {
  const p = system.float(0);
  const q = system.float(2);
  p[i * 3] += x;
  p[i * 3 + 1] += y;
  p[i * 3 + 2] += z;
  q[i * 3] += x;
  q[i * 3 + 1] += y;
  q[i * 3 + 2] += z;
}

// The share of the way between two ages of a particle, in seconds or of its life
function window(system, i, start, end, normalized = true) {
  const t = normalized ? system.normalizedAge(i) : system.age - system.float(8)[i];
  return end > start ? clamp((t - start) / (end - start), 0, 1) : t >= start ? 1 : 0;
}

const DEFS = {};

// ---------------------------------------------------------------- emitters

DEFS.C_OP_ContinuousEmitter = (def) => {
  const rate = compileFloat(def.m_flEmitRate, 100);
  const duration = compileFloat(def.m_flEmissionDuration, 0);
  const start = compileFloat(def.m_flStartTime, 0);
  const scale = def.m_flEmissionScale || 1;
  let carried = 0;
  return {
    emit(system, dt) {
      const from = start(system, -1);
      const length = duration(system, -1);
      if (system.age < from || (length > 0 && system.age > from + length)) {
        return;
      }
      carried += Math.max(rate(system, -1), 0) * scale * dt;
      const n = Math.floor(carried);
      if (n > 0) {
        carried -= n;
        system.spawn(n);
      }
    },
  };
};

DEFS.C_OP_InstantaneousEmitter = (def) => {
  const count = compileFloat(def.m_nParticlesToEmit, 100);
  const start = compileFloat(def.m_flStartTime, 0);
  const perFrame = def.m_nMaxEmittedPerFrame ?? -1;
  let left = null;
  return {
    emit(system) {
      if (left === null && system.age >= start(system, -1)) {
        left = Math.max(0, Math.round(count(system, -1)));
      }
      if (left > 0) {
        const n = perFrame > 0 ? Math.min(left, perFrame) : left;
        system.spawn(n);
        left -= n;
      }
    },
  };
};

DEFS.C_OP_NoiseEmitter = (def) => {
  const min = def.m_flOutputMin ?? 10;
  const max = def.m_flOutputMax ?? 100;
  const scale = def.m_flNoiseScale ?? 0.1;
  const start = def.m_flStartTime ?? 0;
  const duration = def.m_flEmissionDuration ?? 0;
  let carried = 0;
  return {
    emit(system, dt) {
      if (system.age < start || (duration > 0 && system.age > start + duration)) return;
      carried += lerp(min, max, noise(system.age * scale * 10) * 0.5 + 0.5) * dt;
      const n = Math.floor(carried);
      if (n > 0) {
        carried -= n;
        system.spawn(n);
      }
    },
  };
};

DEFS.C_OP_MaintainEmitter = (def) => {
  const count = compileFloat(def.m_nParticlesToMaintain, 100);
  const start = def.m_flStartTime ?? 0;
  return {
    emit(system) {
      if (system.age >= start) system.spawn(Math.round(count(system, -1)) - system.count);
    },
  };
};

// ------------------------------------------------------------- initializers

DEFS.C_INIT_InitFloat = (def) => {
  const value = compileFloat(def.m_InputValue, 0);
  const field = def.m_nOutputField ?? 3;
  const set = setter(def);
  return {
    init(system, start, end) {
      const data = system.float(field);
      for (let i = start; i < end; i++) {
        const current = VECTOR_FIELDS.has(field) ? data[i * 3] : data[i];
        writeFloat(system, field, i, set(current, current, value(system, i)));
      }
    },
  };
};

DEFS.C_INIT_InitVec = (def) => {
  const value = compileVector(def.m_InputValue, [0, 0, 0]);
  const field = def.m_nOutputField ?? 6;
  const set = setter(def);
  const normalize = Boolean(def.m_bNormalizedOutput);
  return {
    init(system, start, end) {
      const data = system.float(field);
      for (let i = start; i < end; i++) {
        value(system, i, out3);
        if (normalize) {
          const length = Math.hypot(out3[0], out3[1], out3[2]) || 1;
          out3[0] /= length;
          out3[1] /= length;
          out3[2] /= length;
        }
        for (let k = 0; k < 3; k++) data[i * 3 + k] = set(data[i * 3 + k], data[i * 3 + k], out3[k]);
        if (field === 0) {
          const q = system.float(2);
          for (let k = 0; k < 3; k++) q[i * 3 + k] = data[i * 3 + k];
        }
      }
    },
  };
};

DEFS.C_INIT_RandomColor = (def) => {
  const min = arr(def.m_ColorMin, [255, 255, 255]);
  const max = arr(def.m_ColorMax, [255, 255, 255]);
  const field = def.m_nFieldOutput ?? 6;
  return {
    init(system, start, end) {
      const data = system.float(field);
      for (let i = start; i < end; i++) {
        const t = Math.random();
        for (let k = 0; k < 3; k++) data[i * 3 + k] = lerp(min[k], max[k], t) / 255;
      }
    },
  };
};

// A random direction and distance from a control point, with a speed outwards and one in the
// control point's own axes
function withinSphere(def, inputs) {
  const radiusMin = inputs ? compileFloat(def.m_fRadiusMin, 0) : () => def.m_fRadiusMin ?? 0;
  const radiusMax = inputs ? compileFloat(def.m_fRadiusMax, 0) : () => def.m_fRadiusMax ?? 0;
  const speedMin = inputs ? compileFloat(def.m_fSpeedMin, 0) : () => def.m_fSpeedMin ?? 0;
  const speedMax = inputs ? compileFloat(def.m_fSpeedMax, 0) : () => def.m_fSpeedMax ?? 0;
  const localMin = compileVector(def.m_LocalCoordinateSystemSpeedMin, [0, 0, 0]);
  const localMax = compileVector(def.m_LocalCoordinateSystemSpeedMax, [0, 0, 0]);
  const distanceBias = arr(def.m_vecDistanceBias, [1, 1, 1]);
  const absBias = arr(def.m_vecDistanceBiasAbs, [0, 0, 0]);
  const exponent = def.m_fSpeedRandExp ?? 1;
  const point = cpOf(def);
  const lo = [0, 0, 0];
  const hi = [0, 0, 0];
  return {
    init(system, start, end) {
      const cp = system.controlPoint(point);
      const p = system.float(0);
      const q = system.float(2);
      for (let i = start; i < end; i++) {
        randomInSphere(v1);
        if (v1.lengthSq() < 1e-8) v1.set(0, 0, 1);
        v1.normalize();
        for (let k = 0; k < 3; k++) {
          let c = v1.getComponent(k) * distanceBias[k];
          if (absBias[k]) c = Math.abs(c);
          v1.setComponent(k, c);
        }
        const direction = v1.lengthSq() > 0 ? v1.clone().normalize() : v1.set(0, 0, 0).clone();
        const radius = lerp(radiusMin(system, i), radiusMax(system, i), Math.random());
        v2.copy(v1).multiplyScalar(radius).applyQuaternion(cp.quaternion).add(cp.position);
        p[i * 3] = q[i * 3] = v2.x;
        p[i * 3 + 1] = q[i * 3 + 1] = v2.y;
        p[i * 3 + 2] = q[i * 3 + 2] = v2.z;
        const speed = lerp(speedMin(system, i), speedMax(system, i), Math.pow(Math.random(), exponent));
        v3.copy(direction).applyQuaternion(cp.quaternion).multiplyScalar(speed);
        localMin(system, i, lo);
        localMax(system, i, hi);
        v2.set(lerp(lo[0], hi[0], Math.random()), lerp(lo[1], hi[1], Math.random()), lerp(lo[2], hi[2], Math.random())).applyQuaternion(cp.quaternion);
        v3.add(v2);
        setVelocity(system, i, v3.x, v3.y, v3.z);
      }
    },
  };
}
DEFS.C_INIT_CreateWithinSphere = (def) => withinSphere(def, false);
DEFS.C_INIT_CreateWithinSphereTransform = (def) => withinSphere(def, true);

DEFS.C_INIT_CreateWithinBox = (def) => {
  const min = compileVector(def.m_vecMin, [0, 0, 0]);
  const max = compileVector(def.m_vecMax, [0, 0, 0]);
  const point = cpOf(def);
  const lo = [0, 0, 0];
  const hi = [0, 0, 0];
  return {
    init(system, start, end) {
      const cp = system.controlPoint(point);
      const p = system.float(0);
      const q = system.float(2);
      for (let i = start; i < end; i++) {
        min(system, i, lo);
        max(system, i, hi);
        v1.set(lerp(lo[0], hi[0], Math.random()), lerp(lo[1], hi[1], Math.random()), lerp(lo[2], hi[2], Math.random()));
        if (def.m_bLocalSpace) v1.applyQuaternion(cp.quaternion);
        v1.add(cp.position);
        for (let k = 0; k < 3; k++) p[i * 3 + k] = q[i * 3 + k] = v1.getComponent(k);
      }
    },
  };
};

DEFS.C_INIT_PositionOffset = (def) => {
  const min = compileVector(def.m_OffsetMin, [0, 0, 0]);
  const max = compileVector(def.m_OffsetMax, [0, 0, 0]);
  const local = Boolean(def.m_bLocalCoords);
  const proportional = Boolean(def.m_bProportional);
  const point = cpOf(def);
  const lo = [0, 0, 0];
  const hi = [0, 0, 0];
  return {
    init(system, start, end) {
      const cp = system.controlPoint(point);
      const radius = system.float(3);
      for (let i = start; i < end; i++) {
        min(system, i, lo);
        max(system, i, hi);
        v1.set(lerp(lo[0], hi[0], Math.random()), lerp(lo[1], hi[1], Math.random()), lerp(lo[2], hi[2], Math.random()));
        if (proportional) v1.multiplyScalar(radius[i]);
        if (local) v1.applyQuaternion(cp.quaternion);
        move(system, i, v1.x, v1.y, v1.z);
      }
    },
  };
};

const sequence = (field) => (def) => {
  const min = def.m_nSequenceMin ?? 0;
  const max = def.m_nSequenceMax ?? 0;
  const linear = Boolean(def.m_bLinear);
  let next = min;
  return {
    init(system, start, end) {
      const data = system.float(field);
      for (let i = start; i < end; i++) {
        if (linear) {
          data[i] = next;
          next = next >= max ? min : next + 1;
        } else {
          data[i] = Math.floor(random(min, max + 1 - 1e-6));
        }
      }
    },
  };
};
DEFS.C_INIT_RandomSequence = sequence(9);
DEFS.C_INIT_RandomSecondSequence = sequence(13);

DEFS.C_INIT_InitialVelocityNoise = (def) => {
  const min = compileVector(def.m_vecOutputMin, [0, 0, 0]);
  const max = compileVector(def.m_vecOutputMax, [1, 1, 1]);
  const scale = compileFloat(def.m_flNoiseScale, 1);
  const point = def.m_TransformInput?.m_nControlPoint ?? 0;
  const local = Boolean(def.m_bLocalSpace);
  const lo = [0, 0, 0];
  const hi = [0, 0, 0];
  return {
    init(system, start, end) {
      const cp = system.controlPoint(point);
      const p = system.float(0);
      for (let i = start; i < end; i++) {
        min(system, i, lo);
        max(system, i, hi);
        const s = scale(system, i) * 0.01;
        v1.set(
          lerp(lo[0], hi[0], noise(p[i * 3] * s + system.age, 0.1, 0.2) * 0.5 + 0.5 + (Math.random() - 0.5) * 0.6),
          lerp(lo[1], hi[1], noise(0.3, p[i * 3 + 1] * s + system.age, 0.4) * 0.5 + 0.5 + (Math.random() - 0.5) * 0.6),
          lerp(lo[2], hi[2], noise(0.5, 0.6, p[i * 3 + 2] * s + system.age) * 0.5 + 0.5 + (Math.random() - 0.5) * 0.6)
        );
        if (local) v1.applyQuaternion(cp.quaternion);
        setVelocity(system, i, v1.x, v1.y, v1.z, true);
      }
    },
  };
};

DEFS.C_INIT_VelocityRandom = (def) => {
  const speedMin = compileFloat(def.m_fSpeedMin, 0);
  const speedMax = compileFloat(def.m_fSpeedMax, 0);
  const localMin = compileVector(def.m_LocalCoordinateSystemSpeedMin, [0, 0, 0]);
  const localMax = compileVector(def.m_LocalCoordinateSystemSpeedMax, [0, 0, 0]);
  const point = cpOf(def);
  const lo = [0, 0, 0];
  const hi = [0, 0, 0];
  return {
    init(system, start, end) {
      const cp = system.controlPoint(point);
      for (let i = start; i < end; i++) {
        randomInSphere(v1).normalize().multiplyScalar(lerp(speedMin(system, i), speedMax(system, i), Math.random()));
        localMin(system, i, lo);
        localMax(system, i, hi);
        v2.set(lerp(lo[0], hi[0], Math.random()), lerp(lo[1], hi[1], Math.random()), lerp(lo[2], hi[2], Math.random())).applyQuaternion(cp.quaternion);
        v1.add(v2);
        setVelocity(system, i, v1.x, v1.y, v1.z, true);
      }
    },
  };
};

DEFS.C_INIT_VelocityFromCP = (def) => {
  const point = def.m_velocityInput?.m_nControlPoint ?? def.m_nControlPoint ?? 0;
  const scale = def.m_flVelocityScale ?? 1;
  return {
    init(system, start, end) {
      const value = system.controlPoint(point).value;
      for (let i = start; i < end; i++) setVelocity(system, i, value.x * scale, value.y * scale, value.z * scale, true);
    },
  };
};

DEFS.C_INIT_RandomYawFlip = (def) => {
  const percent = def.m_flPercent ?? 0.5;
  return {
    init(system, start, end) {
      const yaw = system.float(12);
      for (let i = start; i < end; i++) if (Math.random() < percent) yaw[i] += Math.PI;
    },
  };
};

const randomScalar = (field, minKey, maxKey, defMin, defMax, scale = 1, expKey) => (def) => {
  const min = (def[minKey] ?? defMin) * scale;
  const max = (def[maxKey] ?? defMax) * scale;
  const exponent = expKey ? def[expKey] ?? 1 : 1;
  const out = def.m_nFieldOutput ?? field;
  return {
    init(system, start, end) {
      for (let i = start; i < end; i++) writeFloat(system, out, i, lerp(min, max, Math.pow(Math.random(), exponent)));
    },
  };
};
DEFS.C_INIT_RandomRadius = randomScalar(3, "m_flRadiusMin", "m_flRadiusMax", 1, 1, 1, "m_flRadiusRandExponent");
DEFS.C_INIT_RandomLifeTime = randomScalar(1, "m_fLifetimeMin", "m_fLifetimeMax", 0, 0, 1, "m_fLifetimeRandExponent");
DEFS.C_INIT_RandomAlpha = randomScalar(7, "m_nAlphaMin", "m_nAlphaMax", 255, 255, 1 / 255, "m_flAlphaRandExponent");
DEFS.C_INIT_RandomTrailLength = randomScalar(10, "m_flMinLength", "m_flMaxLength", 0.1, 0.1, 1, "m_flLengthRandExponent");
DEFS.C_INIT_RandomScalar = randomScalar(3, "m_flMin", "m_flMax", 0, 0, 1, "m_flExponent");

const randomRotation = (field, defaultMax) => (def) => {
  const min = (def.m_flDegreesMin ?? 0) * deg;
  const max = (def.m_flDegreesMax ?? defaultMax) * deg;
  const offset = (def.m_flDegrees ?? 0) * deg;
  const out = def.m_nFieldOutput ?? field;
  const flip = def.m_bRandomlyFlipDirection ?? false;
  return {
    init(system, start, end) {
      const data = system.float(out);
      for (let i = start; i < end; i++) {
        const value = offset + lerp(min, max, Math.pow(Math.random(), def.m_flRotationRandExponent ?? 1));
        data[i] = flip && Math.random() < 0.5 ? -value : value;
      }
    },
  };
};
DEFS.C_INIT_RandomRotation = randomRotation(4, 360);
DEFS.C_INIT_RandomRotationSpeed = randomRotation(5, 360);
DEFS.C_INIT_RandomYaw = randomRotation(12, 360);

DEFS.C_INIT_RingWave = (def) => {
  const point = cpOf(def);
  const radius = compileFloat(def.m_flInitialRadius, 0);
  const thickness = compileFloat(def.m_flThickness, 0);
  const speedMin = compileFloat(def.m_flInitialSpeedMin, 0);
  const speedMax = compileFloat(def.m_flInitialSpeedMax, 0);
  const perOrbit = compileFloat(def.m_flParticlesPerOrbit, -1);
  const even = Boolean(def.m_bEvenDistribution);
  const xyOnly = def.m_bXYVelocityOnly ?? true;
  let n = 0;
  return {
    init(system, start, end) {
      const cp = system.controlPoint(point);
      const p = system.float(0);
      const q = system.float(2);
      for (let i = start; i < end; i++) {
        const orbit = perOrbit(system, i);
        const angle = even && orbit > 0 ? ((n++ % orbit) / orbit) * Math.PI * 2 : Math.random() * Math.PI * 2;
        const r = radius(system, i) + (Math.random() - 0.5) * thickness(system, i);
        v1.set(Math.cos(angle), Math.sin(angle), 0);
        v2.copy(v1).multiplyScalar(r).applyQuaternion(cp.quaternion).add(cp.position);
        for (let k = 0; k < 3; k++) p[i * 3 + k] = q[i * 3 + k] = v2.getComponent(k);
        const speed = lerp(speedMin(system, i), speedMax(system, i), Math.random());
        v3.copy(v1);
        if (!xyOnly) v3.z = 0;
        v3.applyQuaternion(cp.quaternion).multiplyScalar(speed);
        setVelocity(system, i, v3.x, v3.y, v3.z);
      }
    },
  };
};

// Spawned on the host model's surface, and bound to it for the operators that keep them there
function onModel() {
  return {
    init(system, start, end) {
      const surface = system.host.surface;
      if (!surface) return;
      const p = system.float(0);
      const q = system.float(2);
      const normal = system.float(21);
      system.bindings ??= [];
      for (let i = start; i < end; i++) {
        const binding = surface.sample(v1, v2);
        if (!binding) continue;
        system.bindings[i] = binding;
        for (let k = 0; k < 3; k++) {
          p[i * 3 + k] = q[i * 3 + k] = v1.getComponent(k);
          normal[i * 3 + k] = v2.getComponent(k);
        }
      }
    },
  };
}
DEFS.C_INIT_CreateOnModel = onModel;
DEFS.C_INIT_InitSkinnedPositionFromCPSnapshot = onModel;
DEFS.C_INIT_InitFromCPSnapshot = onModel;
DEFS.C_INIT_CreateOnModelAtHeight = onModel;

DEFS.C_INIT_CreateFromParentParticles = (def) => {
  const velocityScale = def.m_flVelocityScale ?? 0;
  const randomly = Boolean(def.m_bRandomDistribution);
  let next = 0;
  return {
    init(system, start, end) {
      const parent = system.parent;
      if (!parent || parent.count === 0) return;
      const p = system.float(0);
      const q = system.float(2);
      const pp = parent.float(0);
      const pq = parent.float(2);
      for (let i = start; i < end; i++) {
        const j = randomly ? Math.floor(Math.random() * parent.count) : next++ % parent.count;
        for (let k = 0; k < 3; k++) {
          p[i * 3 + k] = pp[j * 3 + k];
          q[i * 3 + k] = pp[j * 3 + k] - (pp[j * 3 + k] - pq[j * 3 + k]) * velocityScale;
        }
      }
    },
  };
};

function inheritFromParent(def, every) {
  const field = def.m_nFieldOutput ?? 6;
  const scale = def.m_flScale ?? 1;
  const randomly = Boolean(def.m_bRandomDistribution);
  const width = VECTOR_FIELDS.has(field) ? 3 : 1;
  const copy = (system, start, end) => {
    const parent = system.parent;
    if (!parent || parent.count === 0) return;
    const data = system.float(field);
    const source = parent.float(field);
    for (let i = start; i < end; i++) {
      const j = randomly ? Math.floor(Math.random() * parent.count) : i % parent.count;
      for (let k = 0; k < width; k++) data[i * width + k] = source[j * width + k] * scale;
    }
  };
  return every ? { update: (system) => copy(system, 0, system.count) } : { init: copy };
}
DEFS.C_INIT_InheritFromParentParticles = (def) => inheritFromParent(def, false);
DEFS.C_OP_InheritFromParentParticles = (def) => inheritFromParent(def, true);
DEFS.C_OP_InheritFromParentParticlesV2 = (def) => inheritFromParent(def, true);

DEFS.C_INIT_PositionWarp = (def) => {
  const min = arr(def.m_vecWarpMin, [1, 1, 1]);
  const max = arr(def.m_vecWarpMax, [1, 1, 1]);
  const point = def.m_nControlPointNumber ?? 0;
  return {
    init(system, start, end) {
      const center = system.controlPoint(point).position;
      const p = system.float(0);
      const q = system.float(2);
      for (let i = start; i < end; i++) {
        const t = Math.random();
        for (let k = 0; k < 3; k++) {
          const c = center.getComponent(k);
          const warp = lerp(min[k], max[k], t);
          p[i * 3 + k] = c + (p[i * 3 + k] - c) * warp;
          q[i * 3 + k] = c + (q[i * 3 + k] - c) * warp;
        }
      }
    },
  };
};

DEFS.C_INIT_NormalAlignToCP = (def) => {
  const point = def.m_transformInput?.m_nControlPoint ?? def.m_nControlPoint ?? 0;
  return {
    init(system, start, end) {
      const forward = system.controlPoint(point).axis(0, v1);
      const normal = system.float(21);
      for (let i = start; i < end; i++) {
        normal[i * 3] = forward.x;
        normal[i * 3 + 1] = forward.y;
        normal[i * 3 + 2] = forward.z;
      }
    },
  };
};

DEFS.C_INIT_RemapParticleCountToScalar = (def) => {
  const inMin = def.m_nInputMin ?? 0;
  const inMax = def.m_nInputMax ?? 10;
  const outMin = def.m_flOutputMin ?? 0;
  const outMax = def.m_flOutputMax ?? 1;
  const field = def.m_nFieldOutput ?? 3;
  const scale = Boolean(def.m_bScaleInitialRange);
  const wrap = Boolean(def.m_bWrap);
  return {
    init(system, start, end) {
      for (let i = start; i < end; i++) {
        let count = system.ids[i];
        if (wrap && inMax > inMin) count = inMin + ((count - inMin) % (inMax - inMin + 1));
        const value = remap(count, inMin, inMax, outMin, outMax);
        const current = VECTOR_FIELDS.has(field) ? system.float(field)[i * 3] : system.float(field)[i];
        writeFloat(system, field, i, scale ? current * value : value);
      }
    },
  };
};

DEFS.C_INIT_CreationNoise = (def) => {
  const field = def.m_nFieldOutput ?? 3;
  const min = def.m_flOutputMin ?? 0;
  const max = def.m_flOutputMax ?? 1;
  const scale = def.m_flNoiseScale ?? 0.1;
  return {
    init(system, start, end) {
      for (let i = start; i < end; i++) {
        const n = noise(system.age * scale * 10 + system.ids[i] * 0.37) * 0.5 + 0.5;
        writeFloat(system, field, i, lerp(min, max, def.m_bAbsVal ? Math.abs(n * 2 - 1) : n));
      }
    },
  };
};

DEFS.C_INIT_PositionPlaceOnGround = (def) => {
  const offset = compileFloat(def.m_flOffset, 0);
  return {
    init(system, start, end) {
      const p = system.float(0);
      const q = system.float(2);
      for (let i = start; i < end; i++) p[i * 3 + 2] = q[i * 3 + 2] = offset(system, i);
    },
  };
};

DEFS.C_INIT_DistanceToCPInit = (def) => {
  const field = def.m_nFieldOutput ?? 3;
  const inMin = compileFloat(def.m_flInputMin, 0);
  const inMax = compileFloat(def.m_flInputMax, 128);
  const outMin = compileFloat(def.m_flOutputMin, 0);
  const outMax = compileFloat(def.m_flOutputMax, 1);
  const point = def.m_nStartCP ?? 0;
  const set = setter(def);
  return {
    init(system, start, end) {
      const cp = system.controlPoint(point).position;
      const p = system.float(0);
      for (let i = start; i < end; i++) {
        const distance = Math.hypot(p[i * 3] - cp.x, p[i * 3 + 1] - cp.y, p[i * 3 + 2] - cp.z);
        const current = VECTOR_FIELDS.has(field) ? system.float(field)[i * 3] : system.float(field)[i];
        writeFloat(system, field, i, set(current, current, remap(distance, inMin(system, i), inMax(system, i), outMin(system, i), outMax(system, i))));
      }
    },
  };
};

DEFS.C_INIT_AgeNoise = (def) => {
  const min = def.m_flAgeMin ?? 0;
  const max = def.m_flAgeMax ?? 1;
  return {
    init(system, start, end) {
      const creation = system.float(8);
      const life = system.float(1);
      for (let i = start; i < end; i++) creation[i] -= lerp(min, max, Math.random()) * life[i];
    },
  };
};

DEFS.C_INIT_RandomVectorComponent = (def) => {
  const field = def.m_nFieldOutput ?? 6;
  const component = def.m_nComponent ?? 0;
  const min = def.m_flMin ?? 0;
  const max = def.m_flMax ?? 0;
  return {
    init(system, start, end) {
      const data = system.float(field);
      for (let i = start; i < end; i++) data[i * 3 + component] = lerp(min, max, Math.random());
    },
  };
};

DEFS.C_INIT_Orient2DRelToCP = (def) => {
  const point = def.m_nCP ?? 0;
  const field = def.m_nFieldOutput ?? 4;
  const offset = (def.m_flRotOffset ?? 0) * deg;
  return {
    init(system, start, end) {
      const cp = system.controlPoint(point).position;
      const p = system.float(0);
      const data = system.float(field);
      for (let i = start; i < end; i++) data[i] = Math.atan2(p[i * 3 + 1] - cp.y, p[i * 3] - cp.x) + offset;
    },
  };
};

// Particles laid along the path between two control points, in turn
function sequentialPath(def) {
  const params = def.m_PathParams ?? {};
  const from = params.m_nStartControlPointNumber ?? 0;
  const to = params.m_nEndControlPointNumber ?? 0;
  const bulge = params.m_flBulge ?? 0;
  const count = def.m_flNumToAssign ?? 100;
  const loop = def.m_bLoop ?? true;
  let n = 0;
  return {
    init(system, start, end) {
      const a = system.controlPoint(from).position;
      const b = system.controlPoint(to).position;
      const p = system.float(0);
      const q = system.float(2);
      for (let i = start; i < end; i++) {
        let t = count > 1 ? n / (count - 1) : 0;
        n = loop ? (n + 1) % Math.max(count, 1) : Math.min(n + 1, count - 1);
        v1.lerpVectors(a, b, t);
        v1.z += Math.sin(t * Math.PI) * bulge * a.distanceTo(b);
        for (let k = 0; k < 3; k++) p[i * 3 + k] = q[i * 3 + k] = v1.getComponent(k);
      }
    },
  };
}
DEFS.C_INIT_CreateSequentialPath = sequentialPath;
DEFS.C_INIT_CreateSequentialPathV2 = sequentialPath;
DEFS.C_INIT_CreateAlongPath = sequentialPath;

DEFS.C_INIT_RemapCPtoVector = (def) => {
  const point = def.m_nCPInput ?? 0;
  const field = def.m_nFieldOutput ?? 0;
  const inMin = arr(def.m_vInputMin, [0, 0, 0]);
  const inMax = arr(def.m_vInputMax, [0, 0, 0]);
  const outMin = arr(def.m_vOutputMin, [0, 0, 0]);
  const outMax = arr(def.m_vOutputMax, [0, 0, 0]);
  return {
    init(system, start, end) {
      const value = system.controlPoint(point).value;
      const data = system.float(field);
      for (let i = start; i < end; i++) {
        for (let k = 0; k < 3; k++) data[i * 3 + k] = remap(value.getComponent(k), inMin[k], inMax[k], outMin[k], outMax[k]);
      }
    },
  };
};

// Initializers that do nothing visible here: velocities inherited from still control points
const nothing = () => ({});
DEFS.C_INIT_InheritVelocity = nothing;
DEFS.C_INIT_NormalOffset = nothing;
DEFS.C_INIT_SequenceLifeTime = nothing;

// ---------------------------------------------------------------- operators

DEFS.C_OP_Decay = () => ({
  update(system) {
    const life = system.float(1);
    const creation = system.float(8);
    for (let i = 0; i < system.count; i++) if (system.age - creation[i] >= life[i]) system.kill(i);
  },
});

DEFS.C_OP_FadeAndKill = (def) => {
  const fadeInStart = def.m_flStartFadeInTime ?? 0;
  const fadeInEnd = def.m_flEndFadeInTime ?? 0.5;
  const fadeOutStart = def.m_flStartFadeOutTime ?? 0.5;
  const fadeOutEnd = def.m_flEndFadeOutTime ?? 1;
  const startAlpha = def.m_flStartAlpha ?? 1;
  const endAlpha = def.m_flEndAlpha ?? 0;
  return {
    update(system) {
      const alpha = system.float(7);
      const initial = system.initialFloat(7);
      for (let i = 0; i < system.count; i++) {
        const t = system.normalizedAge(i);
        let a = 1;
        if (t < fadeInEnd) a = lerp(startAlpha, 1, window(system, i, fadeInStart, fadeInEnd));
        else if (t > fadeOutStart) a = lerp(1, endAlpha, window(system, i, fadeOutStart, fadeOutEnd));
        alpha[i] = initial[i] * a;
        if (t >= 1) system.kill(i);
      }
    },
  };
};

DEFS.C_OP_FadeInSimple = (def) => {
  const time = def.m_flFadeInTime ?? 0.25;
  const field = def.m_nFieldOutput ?? 7;
  return {
    update(system) {
      const data = system.float(field);
      const initial = system.initialFloat(field);
      for (let i = 0; i < system.count; i++) {
        const t = system.normalizedAge(i);
        if (t < time) data[i] = initial[i] * (time > 0 ? t / time : 1);
      }
    },
  };
};

DEFS.C_OP_FadeOutSimple = (def) => {
  const time = def.m_flFadeOutTime ?? 0.25;
  const field = def.m_nFieldOutput ?? 7;
  return {
    update(system) {
      const data = system.float(field);
      const initial = system.initialFloat(field);
      for (let i = 0; i < system.count; i++) {
        const left = 1 - system.normalizedAge(i);
        if (left < time) data[i] = initial[i] * (time > 0 ? left / time : 0);
      }
    },
  };
};

DEFS.C_OP_FadeIn = (def) => {
  const min = def.m_flFadeInTimeMin ?? 0.25;
  const max = def.m_flFadeInTimeMax ?? 0.25;
  const proportional = def.m_bProportional ?? true;
  return {
    update(system) {
      const alpha = system.float(7);
      const initial = system.initialFloat(7);
      for (let i = 0; i < system.count; i++) {
        const time = lerp(min, max, (system.ids[i] * 0.618) % 1);
        const t = proportional ? system.normalizedAge(i) : system.age - system.float(8)[i];
        if (t < time) alpha[i] = initial[i] * (t / time);
      }
    },
  };
};

DEFS.C_OP_FadeOut = (def) => {
  const min = def.m_flFadeOutTimeMin ?? 0.25;
  const max = def.m_flFadeOutTimeMax ?? 0.25;
  const proportional = def.m_bProportional ?? true;
  const ease = def.m_bEaseInAndOut ?? true;
  return {
    update(system) {
      const alpha = system.float(7);
      const initial = system.initialFloat(7);
      for (let i = 0; i < system.count; i++) {
        const time = lerp(min, max, (system.ids[i] * 0.618) % 1);
        const life = system.float(1)[i];
        const left = proportional ? 1 - system.normalizedAge(i) : life - (system.age - system.float(8)[i]);
        if (left < time) {
          const t = clamp(left / time, 0, 1);
          alpha[i] = initial[i] * (ease ? t * t * (3 - 2 * t) : t);
        }
      }
    },
  };
};

DEFS.C_OP_AlphaDecay = (def) => {
  const min = def.m_flMinAlpha ?? 0;
  return {
    update(system) {
      const alpha = system.float(7);
      for (let i = 0; i < system.count; i++) if (alpha[i] <= min) system.kill(i);
    },
  };
};

DEFS.C_OP_RadiusDecay = (def) => {
  const min = def.m_flMinRadius ?? 1;
  return {
    update(system) {
      const radius = system.float(3);
      for (let i = 0; i < system.count; i++) if (radius[i] <= min) system.kill(i);
    },
  };
};

DEFS.C_OP_InterpolateRadius = (def) => {
  const start = def.m_flStartTime ?? 0;
  const end = def.m_flEndTime ?? 1;
  const from = def.m_flStartScale ?? 1;
  const to = def.m_flEndScale ?? 1;
  const ease = Boolean(def.m_bEaseInAndOut);
  const amount = def.m_flBias ?? 0;
  return {
    update(system) {
      const radius = system.float(3);
      const initial = system.initialFloat(3);
      for (let i = 0; i < system.count; i++) {
        let t = window(system, i, start, end);
        if (ease) t = t * t * (3 - 2 * t);
        if (amount) t = biasOf(t, clamp(amount, 0.001, 0.999));
        radius[i] = initial[i] * lerp(from, to, t);
      }
    },
  };
};

DEFS.C_OP_ColorInterpolate = (def) => {
  const fade = arr(def.m_ColorFade, [255, 255, 255, 255]).map((c) => c / 255);
  const start = def.m_flFadeStartTime ?? 0;
  const end = def.m_flFadeEndTime ?? 1;
  const field = def.m_nFieldOutput ?? 6;
  const ease = Boolean(def.m_bEaseInOut);
  return {
    update(system) {
      const color = system.float(field);
      const initial = system.initialFloat(field);
      for (let i = 0; i < system.count; i++) {
        let t = window(system, i, start, end);
        if (ease) t = t * t * (3 - 2 * t);
        for (let k = 0; k < 3; k++) color[i * 3 + k] = lerp(initial[i * 3 + k], fade[k], t);
      }
    },
  };
};

// Verlet steps: last step's movement carried on, slowed by drag, plus gravity and the forces
DEFS.C_OP_BasicMovement = (def) => {
  const gravity = compileVector(def.m_Gravity, [0, 0, 0]);
  const drag = compileFloat(def.m_fDrag, 0);
  const g = [0, 0, 0];
  return {
    update(system, dt) {
      gravity(system, -1, g);
      const keep = Math.pow(1 - clamp(drag(system, -1), 0, 1), dt * 30);
      const p = system.float(0);
      const q = system.float(2);
      const a = system.accel;
      for (let i = 0; i < system.count; i++) {
        for (let k = 0; k < 3; k++) {
          const j = i * 3 + k;
          const now = p[j];
          p[j] = now + (now - q[j]) * keep + (g[k] + a[j]) * dt * dt;
          q[j] = now;
        }
      }
    },
  };
};

// Particles carried along with their control point's movement
DEFS.C_OP_PositionLock = (def) => {
  const point = cpOf(def);
  const jump = def.m_flJumpThreshold ?? 512;
  let last = null;
  return {
    update(system) {
      const cp = system.controlPoint(point).position;
      if (last) {
        v1.subVectors(cp, last);
        if (v1.length() < jump) {
          for (let i = 0; i < system.count; i++) move(system, i, v1.x, v1.y, v1.z);
        }
      }
      last = (last ?? new THREE.Vector3()).copy(cp);
    },
  };
};
DEFS.C_OP_MovementRigidAttachToCP = DEFS.C_OP_PositionLock;

DEFS.C_OP_RampScalarLinearSimple = (def) => {
  const rate = def.m_Rate ?? 0;
  const start = def.m_flStartTime ?? 0;
  const end = def.m_flEndTime ?? 1;
  const field = def.m_nField ?? 3;
  return {
    update(system, dt) {
      const data = system.float(field);
      for (let i = 0; i < system.count; i++) {
        const t = system.normalizedAge(i);
        if (t >= start && t <= end) data[i] += rate * dt;
      }
    },
  };
};

const ramp = (def) => {
  const rateMin = def.m_RateMin ?? 0;
  const rateMax = def.m_RateMax ?? 0;
  const startMin = def.m_flStartTime_min ?? 0;
  const startMax = def.m_flStartTime_max ?? 0;
  const endMin = def.m_flEndTime_min ?? 1;
  const endMax = def.m_flEndTime_max ?? 1;
  const field = def.m_nField ?? 3;
  const proportional = def.m_bProportionalOp ?? true;
  return {
    update(system, dt) {
      const data = system.float(field);
      for (let i = 0; i < system.count; i++) {
        const r = (system.ids[i] * 0.7548776662) % 1;
        const t = proportional ? system.normalizedAge(i) : system.age - system.float(8)[i];
        if (t >= lerp(startMin, startMax, r) && t <= lerp(endMin, endMax, r)) data[i] += lerp(rateMin, rateMax, r) * dt;
      }
    },
  };
};
DEFS.C_OP_RampScalarLinear = ramp;
DEFS.C_OP_RampScalarSpline = ramp;

DEFS.C_OP_SpinUpdate = () => ({
  update(system, dt) {
    const roll = system.float(4);
    const speed = system.float(5);
    for (let i = 0; i < system.count; i++) roll[i] += speed[i] * dt;
  },
});

const spin = (field) => (def) => {
  const rate = (def.m_nSpinRateDegrees ?? 0) * deg;
  const minRate = (def.m_nSpinRateMinDegrees ?? 0) * deg;
  const stop = def.m_fSpinRateStopTime ?? 0;
  return {
    update(system, dt) {
      const data = system.float(field);
      for (let i = 0; i < system.count; i++) {
        const age = system.age - system.float(8)[i];
        const r = stop > 0 ? lerp(rate, minRate, clamp(age / stop, 0, 1)) : rate;
        data[i] += r * dt;
      }
    },
  };
};
DEFS.C_OP_Spin = spin(4);
DEFS.C_OP_SpinYaw = spin(12);

DEFS.C_OP_SetFloat = (def) => {
  const value = compileFloat(def.m_InputValue, 0);
  const field = def.m_nOutputField ?? 3;
  const strength = compileFloat(def.m_Lerp, 1);
  const set = setter(def);
  return {
    update(system) {
      const data = system.float(field);
      const initial = system.initialFloat(field);
      const vector = VECTOR_FIELDS.has(field);
      for (let i = 0; i < system.count; i++) {
        const current = vector ? data[i * 3] : data[i];
        const target = set(current, vector ? initial[i * 3] : initial[i], value(system, i));
        writeFloat(system, field, i, lerp(current, target, strength(system, i)));
      }
    },
  };
};

DEFS.C_OP_SetVec = (def) => {
  const value = compileVector(def.m_InputValue, [0, 0, 0]);
  const field = def.m_nOutputField ?? 6;
  const strength = compileFloat(def.m_Lerp, 1);
  const set = setter(def);
  return {
    update(system) {
      const data = system.float(field);
      const initial = system.initialFloat(field);
      for (let i = 0; i < system.count; i++) {
        value(system, i, out3);
        const s = strength(system, i);
        for (let k = 0; k < 3; k++) {
          const j = i * 3 + k;
          data[j] = lerp(data[j], set(data[j], initial[j], out3[k]), s);
        }
      }
    },
  };
};

DEFS.C_OP_LerpScalar = (def) => {
  const output = compileFloat(def.m_flOutput, 1);
  const field = def.m_nFieldOutput ?? 3;
  const start = def.m_flStartTime ?? 0;
  const end = def.m_flEndTime ?? 1;
  return {
    update(system) {
      const initial = system.initialFloat(field);
      const vector = VECTOR_FIELDS.has(field);
      for (let i = 0; i < system.count; i++) {
        writeFloat(system, field, i, lerp(vector ? initial[i * 3] : initial[i], output(system, i), window(system, i, start, end)));
      }
    },
  };
};

DEFS.C_OP_LerpEndCapScalar = (def) => {
  const output = def.m_flOutput ?? 1;
  const field = def.m_nFieldOutput ?? 3;
  const time = def.m_flLerpTime ?? 1;
  return {
    update(system) {
      if (!system.endcap) return;
      const t = time > 0 ? clamp(system.endcapAge / time, 0, 1) : 1;
      const data = system.float(field);
      for (let i = 0; i < system.count; i++) writeFloat(system, field, i, lerp(VECTOR_FIELDS.has(field) ? data[i * 3] : data[i], output, t));
    },
  };
};

DEFS.C_OP_EndCapTimedDecay = (def) => {
  const time = def.m_flDecayTime ?? 1;
  return {
    update(system) {
      if (system.endcap && system.endcapAge >= time) for (let i = 0; i < system.count; i++) system.kill(i);
    },
  };
};

DEFS.C_OP_EndCapDecay = () => ({
  update(system) {
    if (system.endcap) for (let i = 0; i < system.count; i++) system.kill(i);
  },
});

const oscillate = (def, simple) => {
  const field = def.m_nField ?? 7;
  const rateMin = simple ? def.m_Rate ?? 0 : def.m_RateMin ?? 0;
  const rateMax = simple ? def.m_Rate ?? 0 : def.m_RateMax ?? 0;
  const freqMin = simple ? def.m_Frequency ?? 1 : def.m_FrequencyMin ?? 1;
  const freqMax = simple ? def.m_Frequency ?? 1 : def.m_FrequencyMax ?? 1;
  const mult = def.m_flOscMult ?? 2;
  const add = def.m_flOscAdd ?? 0.5;
  return {
    update(system, dt) {
      const data = system.float(field);
      for (let i = 0; i < system.count; i++) {
        const r = (system.ids[i] * 0.618033) % 1;
        const age = system.age - system.float(8)[i];
        const value = Math.sin((age * mult + add) * lerp(freqMin, freqMax, r) * Math.PI);
        data[i] += lerp(rateMin, rateMax, r) * value * dt;
      }
    },
  };
};
DEFS.C_OP_OscillateScalar = (def) => oscillate(def, false);
DEFS.C_OP_OscillateScalarSimple = (def) => oscillate(def, true);

DEFS.C_OP_OscillateVector = (def) => {
  const field = def.m_nField ?? 0;
  const rateMin = arr(def.m_RateMin, [0, 0, 0]);
  const rateMax = arr(def.m_RateMax, [0, 0, 0]);
  const freqMin = arr(def.m_FrequencyMin, [1, 1, 1]);
  const freqMax = arr(def.m_FrequencyMax, [1, 1, 1]);
  const mult = def.m_flOscMult ?? 2;
  const add = def.m_flOscAdd ?? 0.5;
  return {
    update(system, dt) {
      const data = system.float(field);
      for (let i = 0; i < system.count; i++) {
        const r = (system.ids[i] * 0.618033) % 1;
        const age = system.age - system.float(8)[i];
        for (let k = 0; k < 3; k++) {
          const value = Math.sin((age * mult + add) * lerp(freqMin[k], freqMax[k], r) * Math.PI);
          const change = lerp(rateMin[k], rateMax[k], r) * value * dt;
          data[i * 3 + k] += change;
          if (field === 0) system.float(2)[i * 3 + k] += change;
        }
      }
    },
  };
};

DEFS.C_OP_VectorNoise = (def) => {
  const field = def.m_nFieldOutput ?? 0;
  const min = arr(def.m_vecOutputMin, [0, 0, 0]);
  const max = arr(def.m_vecOutputMax, [1, 1, 1]);
  const scale = def.m_fl4NoiseScale ?? 0;
  const additive = Boolean(def.m_bAdditive);
  const timeScale = def.m_flNoiseAnimationTimeScale ?? 0;
  return {
    update(system, dt) {
      const data = system.float(field);
      for (let i = 0; i < system.count; i++) {
        for (let k = 0; k < 3; k++) {
          const n = noise(data[i * 3] * scale + k * 17.3, data[i * 3 + 1] * scale + system.age * timeScale, data[i * 3 + 2] * scale + system.ids[i] * 0.1) * 0.5 + 0.5;
          const value = lerp(min[k], max[k], n);
          if (additive) {
            data[i * 3 + k] += value * dt;
            if (field === 0) system.float(2)[i * 3 + k] += value * dt;
          } else {
            data[i * 3 + k] = value;
          }
        }
      }
    },
  };
};

DEFS.C_OP_Noise = (def) => {
  const field = def.m_nFieldOutput ?? 3;
  const min = def.m_flOutputMin ?? 0;
  const max = def.m_flOutputMax ?? 1;
  const scale = def.m_fl4NoiseScale ?? 0.001;
  const additive = Boolean(def.m_bAdditive);
  return {
    update(system, dt) {
      const p = system.float(0);
      for (let i = 0; i < system.count; i++) {
        const n = noise(p[i * 3] * scale, p[i * 3 + 1] * scale, p[i * 3 + 2] * scale + system.age) * 0.5 + 0.5;
        const value = lerp(min, max, n);
        const data = system.float(field);
        if (additive) data[i] += value * dt;
        else writeFloat(system, field, i, value);
      }
    },
  };
};

DEFS.C_OP_DistanceToCP = (def) => {
  const field = def.m_nFieldOutput ?? 3;
  const inMin = compileFloat(def.m_flInputMin, 0);
  const inMax = compileFloat(def.m_flInputMax, 128);
  const outMin = compileFloat(def.m_flOutputMin, 0);
  const outMax = compileFloat(def.m_flOutputMax, 1);
  const point = def.m_nStartCP ?? 0;
  const set = setter(def);
  const scale = Boolean(def.m_bScaleInitialRange);
  return {
    update(system) {
      const cp = system.controlPoint(point).position;
      const p = system.float(0);
      const data = system.float(field);
      const initial = system.initialFloat(field);
      const vector = VECTOR_FIELDS.has(field);
      for (let i = 0; i < system.count; i++) {
        const distance = Math.hypot(p[i * 3] - cp.x, p[i * 3 + 1] - cp.y, p[i * 3 + 2] - cp.z);
        const value = remap(distance, inMin(system, i), inMax(system, i), outMin(system, i), outMax(system, i));
        const base = vector ? initial[i * 3] : initial[i];
        writeFloat(system, field, i, scale ? base * value : set(vector ? data[i * 3] : data[i], base, value));
      }
    },
  };
};

DEFS.C_OP_ClampScalar = (def) => {
  const field = def.m_nFieldOutput ?? 3;
  const min = compileFloat(def.m_flOutputMin, 0);
  const max = compileFloat(def.m_flOutputMax, 1);
  return {
    update(system) {
      const data = system.float(field);
      for (let i = 0; i < system.count; i++) {
        if (VECTOR_FIELDS.has(field)) continue;
        data[i] = clamp(data[i], min(system, i), max(system, i));
      }
    },
  };
};

DEFS.C_OP_DistanceCull = (def) => {
  const point = def.m_nControlPoint ?? 0;
  const distance = compileFloat(def.m_flDistance, 0);
  const inside = Boolean(def.m_bCullInside);
  return {
    update(system) {
      const cp = system.controlPoint(point).position;
      const p = system.float(0);
      const limit = distance(system, -1);
      for (let i = 0; i < system.count; i++) {
        const d = Math.hypot(p[i * 3] - cp.x, p[i * 3 + 1] - cp.y, p[i * 3 + 2] - cp.z);
        if (inside ? d < limit : d > limit) system.kill(i);
      }
    },
  };
};

// Particles kept where they were made on the model as it moves (see onModel)
const followModel = () => ({
  update(system) {
    const surface = system.host.surface;
    if (!surface || !system.bindings) return;
    for (let i = 0; i < system.count; i++) {
      const binding = system.bindings[i];
      if (!binding) continue;
      if (binding.last === undefined) {
        binding.last = new THREE.Vector3();
        surface.position(binding, binding.last);
        continue;
      }
      surface.position(binding, v1);
      v2.subVectors(v1, binding.last);
      move(system, i, v2.x, v2.y, v2.z);
      binding.last.copy(v1);
    }
  },
});
DEFS.C_OP_SnapshotRigidSkinToBones = followModel;
DEFS.C_OP_SnapshotSkinToBones = followModel;
DEFS.C_OP_LockToBone = followModel;

DEFS.C_OP_SetToCP = (def) => {
  const point = def.m_nControlPointNumber ?? 0;
  const offset = arr(def.m_vecOffset, [0, 0, 0]);
  const local = Boolean(def.m_bOffsetLocal);
  return {
    update(system) {
      const cp = system.controlPoint(point);
      v1.set(...offset);
      if (local) v1.applyQuaternion(cp.quaternion);
      v1.add(cp.position);
      const p = system.float(0);
      const q = system.float(2);
      for (let i = 0; i < system.count; i++) {
        for (let k = 0; k < 3; k++) p[i * 3 + k] = q[i * 3 + k] = v1.getComponent(k);
      }
    },
  };
};

DEFS.C_OP_MovementRotateParticleAroundAxis = (def) => {
  const axis = compileVector(def.m_vecRotAxis, [0, 0, 1]);
  const rate = compileFloat(def.m_flRotRate, 180);
  const point = cpOf(def);
  const local = Boolean(def.m_bLocalSpace);
  const q = new THREE.Quaternion();
  return {
    update(system, dt) {
      const cp = system.controlPoint(point);
      axis(system, -1, out3);
      v1.set(out3[0], out3[1], out3[2]).normalize();
      if (local) v1.applyQuaternion(cp.quaternion);
      q.setFromAxisAngle(v1, rate(system, -1) * deg * dt);
      const p = system.float(0);
      const pq = system.float(2);
      for (let i = 0; i < system.count; i++) {
        for (const data of [p, pq]) {
          v2.set(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]).sub(cp.position).applyQuaternion(q).add(cp.position);
          data[i * 3] = v2.x;
          data[i * 3 + 1] = v2.y;
          data[i * 3 + 2] = v2.z;
        }
      }
    },
  };
};

DEFS.C_OP_Orient2DRelToCP = (def) => {
  const point = def.m_nCP ?? 0;
  const field = def.m_nFieldOutput ?? 4;
  const offset = (def.m_flRotOffset ?? 0) * deg;
  return {
    update(system) {
      const cp = system.controlPoint(point).position;
      const p = system.float(0);
      const data = system.float(field);
      for (let i = 0; i < system.count; i++) data[i] = Math.atan2(p[i * 3 + 1] - cp.y, p[i * 3] - cp.x) + offset;
    },
  };
};

DEFS.C_OP_DampenToCP = (def) => {
  const point = def.m_nControlPointNumber ?? 0;
  const range = def.m_flRange ?? 100;
  const scale = def.m_flScale ?? 1;
  return {
    update(system) {
      const cp = system.controlPoint(point).position;
      const p = system.float(0);
      const q = system.float(2);
      for (let i = 0; i < system.count; i++) {
        const d = Math.hypot(p[i * 3] - cp.x, p[i * 3 + 1] - cp.y, p[i * 3 + 2] - cp.z);
        if (d < range) {
          const keep = lerp(1 - scale, 1, d / range);
          for (let k = 0; k < 3; k++) q[i * 3 + k] = p[i * 3 + k] - (p[i * 3 + k] - q[i * 3 + k]) * keep;
        }
      }
    },
  };
};

DEFS.C_OP_MaxVelocity = (def) => {
  const max = def.m_flMaxVelocity ?? 0;
  return {
    update(system) {
      if (max <= 0) return;
      const p = system.float(0);
      const q = system.float(2);
      const limit = max * STEP;
      for (let i = 0; i < system.count; i++) {
        v1.set(p[i * 3] - q[i * 3], p[i * 3 + 1] - q[i * 3 + 1], p[i * 3 + 2] - q[i * 3 + 2]);
        if (v1.length() > limit) {
          v1.setLength(limit);
          for (let k = 0; k < 3; k++) q[i * 3 + k] = p[i * 3 + k] - v1.getComponent(k);
        }
      }
    },
  };
};

DEFS.C_OP_RemapSpeed = (def) => {
  const field = def.m_nFieldOutput ?? 3;
  const inMin = def.m_flInputMin ?? 0;
  const inMax = def.m_flInputMax ?? 128;
  const outMin = def.m_flOutputMin ?? 0;
  const outMax = def.m_flOutputMax ?? 1;
  return {
    update(system) {
      for (let i = 0; i < system.count; i++) writeFloat(system, field, i, remap(system.speed(i), inMin, inMax, outMin, outMax));
    },
  };
};

// ------------------------------------------------------------------ forces

DEFS.C_OP_AttractToControlPoint = (def) => {
  const point = cpOf(def);
  const amount = compileFloat(def.m_fForceAmount, 100);
  const falloff = def.m_fFalloffPower ?? 0;
  const scale = arr(def.m_vecComponentScale, [1, 1, 1]);
  return {
    force(system) {
      const cp = system.controlPoint(point).position;
      const p = system.float(0);
      const force = amount(system, -1);
      for (let i = 0; i < system.count; i++) {
        v1.set(cp.x - p[i * 3], cp.y - p[i * 3 + 1], cp.z - p[i * 3 + 2]);
        const d = Math.max(v1.length(), 1);
        v1.multiplyScalar(force / Math.pow(d, falloff) / d);
        system.accel[i * 3] += v1.x * scale[0];
        system.accel[i * 3 + 1] += v1.y * scale[1];
        system.accel[i * 3 + 2] += v1.z * scale[2];
      }
    },
  };
};

DEFS.C_OP_RandomForce = (def) => {
  const min = arr(def.m_MinForce, [0, 0, 0]);
  const max = arr(def.m_MaxForce, [0, 0, 0]);
  return {
    force(system) {
      for (let i = 0; i < system.count; i++) for (let k = 0; k < 3; k++) system.accel[i * 3 + k] += lerp(min[k], max[k], Math.random());
    },
  };
};

DEFS.C_OP_CurlNoiseForce = (def) => {
  const freq = arr(def.m_vecNoiseFreq, [1, 1, 1]);
  const scale = arr(def.m_vecNoiseScale, [1, 1, 1]);
  return {
    force(system) {
      const p = system.float(0);
      for (let i = 0; i < system.count; i++) {
        for (let k = 0; k < 3; k++) {
          system.accel[i * 3 + k] += noise(p[i * 3] * freq[0] * 0.01 + k * 31, p[i * 3 + 1] * freq[1] * 0.01, p[i * 3 + 2] * freq[2] * 0.01 + system.age) * scale[k];
        }
      }
    },
  };
};

DEFS.C_OP_TwistAroundAxis = (def) => {
  const amount = def.m_fForceAmount ?? 0;
  const axis = arr(def.m_TwistAxis, [0, 0, 1]);
  const point = def.m_nControlPointNumber ?? 0;
  const local = Boolean(def.m_bLocalSpace);
  return {
    force(system) {
      const cp = system.controlPoint(point);
      v2.set(...axis).normalize();
      if (local) v2.applyQuaternion(cp.quaternion);
      const p = system.float(0);
      for (let i = 0; i < system.count; i++) {
        v1.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]).sub(cp.position);
        v3.crossVectors(v2, v1).normalize().multiplyScalar(amount);
        for (let k = 0; k < 3; k++) system.accel[i * 3 + k] += v3.getComponent(k);
      }
    },
  };
};

// ------------------------------------------------------------- constraints

DEFS.C_OP_ConstrainDistance = (def) => {
  const min = compileFloat(def.m_fMinDistance, 0);
  const max = compileFloat(def.m_fMaxDistance, 100);
  const point = def.m_nControlPointNumber ?? 0;
  const offset = arr(def.m_CenterOffset, [0, 0, 0]);
  return {
    update(system) {
      const cp = system.controlPoint(point).position;
      const p = system.float(0);
      const lo = min(system, -1);
      const hi = max(system, -1);
      for (let i = 0; i < system.count; i++) {
        v1.set(p[i * 3] - cp.x - offset[0], p[i * 3 + 1] - cp.y - offset[1], p[i * 3 + 2] - cp.z - offset[2]);
        const d = v1.length();
        if (d > hi || (d < lo && d > 0)) {
          v1.setLength(clamp(d, lo, hi));
          p[i * 3] = cp.x + offset[0] + v1.x;
          p[i * 3 + 1] = cp.y + offset[1] + v1.y;
          p[i * 3 + 2] = cp.z + offset[2] + v1.z;
        }
      }
    },
  };
};

DEFS.C_OP_PlanarConstraint = (def) => {
  const point = arr(def.m_PointOnPlane, [0, 0, 0]);
  const normal = arr(def.m_PlaneNormal, [0, 0, 1]);
  const cp = def.m_nControlPointNumber ?? 0;
  const global = Boolean(def.m_bGlobalOrigin);
  return {
    update(system) {
      const origin = global ? v2.set(0, 0, 0) : v2.copy(system.controlPoint(cp).position);
      origin.x += point[0];
      origin.y += point[1];
      origin.z += point[2];
      v3.set(...normal).normalize();
      const p = system.float(0);
      for (let i = 0; i < system.count; i++) {
        v1.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]).sub(origin);
        const d = v1.dot(v3);
        if (d < 0) {
          p[i * 3] -= v3.x * d;
          p[i * 3 + 1] -= v3.y * d;
          p[i * 3 + 2] -= v3.z * d;
        }
      }
    },
  };
};

// The ground under the hero is the only world here, at height 0
DEFS.C_OP_WorldTraceConstraint = () => ({
  update(system) {
    const p = system.float(0);
    const q = system.float(2);
    for (let i = 0; i < system.count; i++) {
      if (p[i * 3 + 2] < 0) {
        p[i * 3 + 2] = 0;
        q[i * 3 + 2] = Math.min(q[i * 3 + 2], 0);
      }
    }
  },
});

// ------------------------------------------------------ control point setters

DEFS.C_OP_SetSingleControlPointPosition = (def) => {
  const target = def.m_nCP1 ?? 1;
  const position = compileVector(def.m_vecCP1Pos, [128, 0, 0]);
  const base = def.m_transformInput?.m_nControlPoint ?? def.m_nHeadLocation ?? 0;
  const world = Boolean(def.m_bUseWorldLocation);
  const once = Boolean(def.m_bSetOnce);
  let done = false;
  return {
    update(system) {
      if (once && done) return;
      done = true;
      const from = system.controlPoint(base);
      position(system, -1, out3);
      v1.set(out3[0], out3[1], out3[2]);
      if (!world) v1.applyQuaternion(from.quaternion).add(from.position);
      const point = system.ownControlPoint(target);
      point.position.copy(v1);
      point.quaternion.copy(from.quaternion);
    },
  };
};

DEFS.C_OP_SetControlPointPositions = (def) => {
  const base = def.m_nHeadLocation ?? 0;
  const world = Boolean(def.m_bUseWorldLocation);
  const entries = [
    [def.m_nCP1 ?? 1, arr(def.m_vecCP1Pos, [128, 0, 0])],
    [def.m_nCP2 ?? 2, arr(def.m_vecCP2Pos, [0, 128, 0])],
    [def.m_nCP3 ?? 3, arr(def.m_vecCP3Pos, [-128, 0, 0])],
    [def.m_nCP4 ?? 4, arr(def.m_vecCP4Pos, [0, -128, 0])],
  ];
  return {
    update(system) {
      const from = system.controlPoint(base);
      for (const [index, position] of entries) {
        v1.set(...position);
        if (!world) v1.applyQuaternion(from.quaternion).add(from.position);
        const point = system.ownControlPoint(index);
        point.position.copy(v1);
        point.quaternion.copy(from.quaternion);
      }
    },
  };
};

DEFS.C_OP_SetControlPointOrientation = (def) => {
  const target = def.m_nCP ?? 0;
  const rotation = arr(def.m_vecRotation, [0, 0, 0]);
  const euler = new THREE.Euler();
  return {
    update(system) {
      const from = system.controlPoint(target);
      const point = system.ownControlPoint(target);
      if (point !== from) point.position.copy(from.position);
      // Source angles: pitch about y, yaw about z, roll about x
      euler.set(rotation[2] * deg, rotation[0] * deg, rotation[1] * deg, "ZYX");
      point.quaternion.setFromEuler(euler);
    },
  };
};

DEFS.C_OP_SetControlPointFromObjectScale = (def) => {
  const output = def.m_nCPOutput ?? 1;
  return {
    update(system) {
      system.ownControlPoint(output).value.set(1, 1, 1);
    },
  };
};

// Children's control points at this system's particles
DEFS.C_OP_SetParentControlPointsToChildCP = (def) => {
  const childPoint = def.m_nChildControlPoint ?? 0;
  const count = def.m_nNumControlPoints ?? 1;
  const first = def.m_nFirstSourcePoint ?? 0;
  return {
    update(system) {
      for (const child of system.children) {
        if (!child.system) continue;
        for (let k = 0; k < count; k++) {
          const from = system.controlPoint(first + k);
          const point = child.system.ownControlPoint(childPoint + k);
          point.position.copy(from.position);
          point.quaternion.copy(from.quaternion);
        }
      }
    },
  };
};

DEFS.C_OP_SetChildControlPoints = (def) => {
  const childPoint = def.m_nFirstControlPoint ?? 3;
  const count = def.m_nNumControlPoints ?? 1;
  const first = def.m_nFirstSourcePoint ?? 0;
  return {
    update(system) {
      const p = system.float(0);
      for (const child of system.children) {
        if (!child.system) continue;
        for (let k = 0; k < count && first + k < system.count; k++) {
          const i = first + k;
          child.system.ownControlPoint(childPoint + k).position.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
        }
      }
    },
  };
};

DEFS.C_OP_StopAfterCPDuration = (def) => {
  const duration = compileFloat(def.m_flDuration, 1);
  return {
    update(system) {
      if (system.age > duration(system, -1)) system.stop();
    },
  };
};

// Control points that stand still here, so their speed is nothing
DEFS.C_OP_RemapSpeedtoCP = () => ({});
DEFS.C_OP_SetControlPointRotation = () => ({});

// Every class this file and the renderers handle
export const supportedClasses = new Set([...Object.keys(DEFS), ...Object.keys(RENDERERS)]);
export const unsupported = new Map();

// Operators run only while their system is, or isn't, ending, if they say so
function endCapFilter(def, instance) {
  const state = def.m_nOpEndCapState;
  if (!state || state === "PARTICLE_ENDCAP_ALWAYS_ON") return instance;
  const wantEndcap = state === "PARTICLE_ENDCAP_ENDCAP_ON";
  for (const method of ["update", "force", "emit"]) {
    const original = instance[method];
    if (original) instance[method] = (system, dt) => system.endcap === wantEndcap && original.call(instance, system, dt);
  }
  return instance;
}

// An operator's strength, often a control point the game sets (16 turns on an effect's custom
// color, 15 holds it): one at nothing does nothing
function strengthFilter(def, instance) {
  if (def.m_flOpStrength === undefined) return instance;
  const strength = compileFloat(def.m_flOpStrength, 1);
  for (const method of ["init", "update", "force", "emit"]) {
    const original = instance[method];
    if (original) instance[method] = (system, a, b) => strength(system, -1) > 0 && original.call(instance, system, a, b);
  }
  return instance;
}

// Parameters the newer files give as literal inputs, made plain numbers and vectors, so code
// reading a number gets one
function flatten(def) {
  const result = {};
  for (const [key, value] of Object.entries(def)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (value.m_nType === "PF_TYPE_LITERAL" && (value.m_nMapType ?? "PF_MAP_TYPE_DIRECT") === "PF_MAP_TYPE_DIRECT") {
        result[key] = value.m_flLiteralValue ?? 0;
        continue;
      }
      if (value.m_nType === "PVEC_TYPE_LITERAL" && Array.isArray(value.m_vLiteralValue)) {
        result[key] = value.m_vLiteralValue;
        continue;
      }
    }
    result[key] = value;
  }
  return result;
}

export function createOperator(def, kind, system) {
  def = flatten(def);
  const name = def._class;
  const make = kind === "renderer" ? RENDERERS[name] : DEFS[name];
  if (!make) {
    unsupported.set(name, (unsupported.get(name) ?? 0) + 1);
    return null;
  }
  try {
    return strengthFilter(def, endCapFilter(def, make(def, system)));
  } catch (error) {
    console.warn(`[particles] ${name}: ${error.message}`);
    return null;
  }
}
