// The game's particle operators by class: what each emitter, initializer, force, operator,
// constraint and control point setter does, with the defaults the game's schema gives the
// parameters a file leaves out. A class not here is skipped (and counted, see supportedClasses).
import * as THREE from "three";
import { compileFloat, compileVector } from "./inputs.js";
import { bias as biasOf, clamp, lerp, noise, quaternionToSource, random, randomInSphere, remap, toSource } from "./math.js";
import { RENDERERS, sheetTextureOf } from "./render.js";
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
  // m_flScalePerParentParticle: the rate times the parent's live particles times it, in place of
  // the emission scale (particles.dll 0x1801112d0; without a parent, times it alone)
  const perParent = def.m_flScalePerParentParticle > 0 ? def.m_flScalePerParentParticle : 0;
  const fromKilled = Boolean(def.m_bInitFromKilledParentParticles);
  let carried = 0;
  let ends = Infinity;
  return {
    // Whether it emits no more: past its duration (none: never), or, made from the parent's
    // killed particles, once the parent emits no more and has none left
    done(system) {
      if (fromKilled) return !system.parent || (system.parent.emittersDone && system.parent.count === 0);
      return system.age > ends;
    },
    emit(system, dt) {
      // One particle for each the parent lost, made from it (C_INIT_InitFromParentKilled)
      if (fromKilled) {
        const parent = system.parent;
        if (!parent) return;
        parent.keepKilled = true;
        system.fromKilled = parent.killed.splice(0, parent.killed.length);
        if (system.fromKilled.length) system.spawn(system.fromKilled.length);
        system.fromKilled = null;
        return;
      }
      const from = start(system, -1);
      const length = duration(system, -1);
      ends = length > 0 ? from + length : Infinity;
      if (system.age < from || (length > 0 && system.age > from + length)) {
        return;
      }
      const factor = perParent ? (system.parent ? system.parent.count : 1) * perParent : scale;
      carried += Math.max(rate(system, -1), 0) * factor * dt;
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
  // With a snapshot control point: one particle for each of its points
  const snapshotPoint = def.m_nSnapshotControlPoint ?? -1;
  let left = null;
  return {
    done: () => left === 0,
    // Marks it as an emitter that makes its particles at once (ParticleSystem.numberRange)
    emitted: 0,
    emit(system) {
      if (left === null && system.age >= start(system, -1)) {
        const snapshot = snapshotPoint >= 0 && system.snapshot(snapshotPoint);
        const points = snapshot && (system.host.snapshotData?.(snapshot)?.position ?? system.host.snapshotPoints?.(snapshot));
        left = points?.length ? points.length : Math.max(0, Math.round(count(system, -1)));
        system.emittedAtOnce = (system.emittedAtOnce ?? 0) + left;
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
    done: (system) => duration > 0 && system.age > start + duration,
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

// A value set to a rotation, its speed, yaw or pitch is in degrees in the file (0 to 360 for any
// turn), kept in radians; a scale of what is there stays as it is
function degreesIn(def, field, value) {
  if (!ANGLE_FIELDS.has(Number(field)) || /SCALE/.test(def.m_nSetMethod ?? "")) return value;
  return (system, index) => value(system, index) * deg;
}

DEFS.C_INIT_InitFloat = (def) => {
  const field = def.m_nOutputField ?? 3;
  const value = degreesIn(def, field, compileFloat(def.m_InputValue, 0));
  // How far from what is there to the new value: 1 sets it, beyond 1 goes past it
  const strength = compileFloat(def.m_InputStrength, 1);
  const set = setter(def);
  return {
    init(system, start, end) {
      const data = system.float(field);
      for (let i = start; i < end; i++) {
        const current = VECTOR_FIELDS.has(field) ? data[i * 3] : data[i];
        writeFloat(system, field, i, lerp(current, set(current, current, value(system, i)), strength(system, i)));
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
        // As particles.dll does (0x18013ba4d..0x18013bb1f): a random direction, made positive
        // where m_vecDistanceBiasAbs says, times m_vecDistanceBias, then normalized again, so a
        // flattened sphere (bias 1 1 0) spreads over the whole disk instead of gathering in
        // its middle
        for (let k = 0; k < 3; k++) {
          let c = v1.getComponent(k);
          if (absBias[k]) c = Math.abs(c);
          v1.setComponent(k, c * distanceBias[k]);
        }
        if (v1.lengthSq() > 1e-12) v1.normalize();
        const direction = v1.clone();
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

// Spread evenly over a sphere round a control point, one point after another along a spiral
// from pole to pole (as many as the particles the system holds, or the density squared), each
// moving out from the centre (in, when its speed is below nothing)
DEFS.C_INIT_CreateSpiralSphere = (def) => {
  const point = def.m_nOverrideCP >= 0 ? def.m_nOverrideCP : def.m_nControlPointNumber ?? 0;
  const radius = def.m_flInitialRadius ?? 0;
  const speedMin = def.m_flInitialSpeedMin ?? 0;
  const speedMax = def.m_flInitialSpeedMax ?? 0;
  const golden = Math.PI * (3 - Math.sqrt(5));
  let next = 0;
  return {
    init(system, start, end) {
      const cp = system.controlPoint(point).position;
      const total = def.m_bUseParticleCount ? system.maxParticles : Math.max(1, def.m_nDensity ?? 10) ** 2;
      const p = system.float(0);
      const q = system.float(2);
      for (let i = start; i < end; i++) {
        const k = next++ % total;
        const z = 1 - (2 * (k + 0.5)) / total;
        const ring = Math.sqrt(Math.max(0, 1 - z * z));
        v1.set(Math.cos(k * golden) * ring, Math.sin(k * golden) * ring, z);
        for (let c = 0; c < 3; c++) p[i * 3 + c] = q[i * 3 + c] = cp.getComponent(c) + v1.getComponent(c) * radius;
        const speed = random(speedMin, speedMax);
        if (speed) setVelocity(system, i, v1.x * speed, v1.y * speed, v1.z * speed);
      }
    },
  };
};

// On an epitrochoid round a control point: at t = the particle's number (m_bUseCount) or the
// time it is made, times m_flParticleDensity, (R1 + R2) cos t - offset cos((R1 + R2) / R2 t) on
// axis m_nComponent1 and the same with sin on m_nComponent2 (-1: none); in the control point's
// frame (m_bUseLocalCoords), and from where the particle already is (m_bOffsetExistingPos)
DEFS.C_INIT_CreateInEpitrochoid = (def) => {
  const point = cpOf(def);
  const density = compileFloat(def.m_flParticleDensity, 10);
  const offset = compileFloat(def.m_flOffset, 4);
  const radius1 = compileFloat(def.m_flRadius1, 40);
  const radius2 = compileFloat(def.m_flRadius2, 24);
  const first = def.m_nComponent1 ?? 0;
  const second = def.m_nComponent2 ?? 1;
  const byCount = Boolean(def.m_bUseCount);
  const local = Boolean(def.m_bUseLocalCoords);
  const fromExisting = Boolean(def.m_bOffsetExistingPos);
  return {
    init(system, start, end) {
      const cp = system.controlPoint(point);
      const p = system.float(0);
      const q = system.float(2);
      const creation = system.float(8);
      for (let i = start; i < end; i++) {
        const t = (byCount ? system.ids[i] : creation[i]) * density(system, i);
        const sum = radius1(system, i) + radius2(system, i);
        const ratio = sum / (radius2(system, i) || 1e-6);
        const d = offset(system, i);
        v1.set(0, 0, 0);
        if (first >= 0 && first < 3) v1.setComponent(first, sum * Math.cos(t) - d * Math.cos(ratio * t));
        if (second >= 0 && second < 3) v1.setComponent(second, sum * Math.sin(t) - d * Math.sin(ratio * t));
        if (local) v1.applyQuaternion(cp.quaternion);
        if (fromExisting) {
          move(system, i, v1.x, v1.y, v1.z);
        } else {
          v1.add(cp.position);
          for (let k = 0; k < 3; k++) p[i * 3 + k] = q[i * 3 + k] = v1.getComponent(k);
        }
      }
    },
  };
};

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

// The system's model renderer, which knows its model's sequences and attachments
const modelRenderer = (system) => system.renderers.find((renderer) => renderer.sequence);
// A named sequence's number in the system's model, -1 when it is not there
const sequenceNumber = (system, name) => modelRenderer(system)?.sequence(name) ?? -1;

// One of the named sequences of the model the system draws, at random
DEFS.C_INIT_RandomNamedModelSequence = (def) => {
  const names = arr(def.m_names, []);
  const field = def.m_nFieldOutput ?? 9;
  return {
    init(system, start, end) {
      if (!names.length) return;
      const data = system.float(field);
      for (let i = start; i < end; i++) {
        const number = sequenceNumber(system, names[Math.floor(Math.random() * names.length)]);
        if (number >= 0) data[i] = number;
      }
    },
  };
};

// Particles playing one of the in-names go on to the out-name in its place: after some time
// (seconds or, proportional, of their life), or as the system ends
const remapNamedSequence = (def, when) => {
  const pairs = arr(def.m_inNames, []).map((name, k) => [name, arr(def.m_outNames, [])[k]]).filter(([, out]) => out);
  const input = def.m_nFieldInput ?? 9;
  const output = def.m_nFieldOutput ?? 9;
  return {
    update(system) {
      const numbers = pairs.map(([from, to]) => [sequenceNumber(system, from), sequenceNumber(system, to)]).filter(([from, to]) => from >= 0 && to >= 0);
      if (!numbers.length) return;
      const read = system.float(input);
      const write = system.float(output);
      for (let i = 0; i < system.count; i++) {
        if (!when(system, i)) continue;
        const found = numbers.find(([from]) => Math.round(read[i]) === from);
        if (found) write[i] = found[1];
      }
    },
  };
};
DEFS.C_OP_RemapNamedModelSequenceOnceTimed = (def) => {
  const time = def.m_flRemapTime ?? 1;
  const proportional = Boolean(def.m_bProportional);
  return remapNamedSequence(def, (system, i) => (proportional ? system.normalizedAge(i) : system.age - system.float(8)[i]) >= time);
};
DEFS.C_OP_RemapNamedModelSequenceEndCap = (def) => remapNamedSequence(def, (system) => system.endcap);

DEFS.C_INIT_InitialVelocityNoise = (def) => {
  const min = compileVector(def.m_vecOutputMin, [0, 0, 0]);
  const max = compileVector(def.m_vecOutputMax, [1, 1, 1]);
  // Noise through time and through space: particles made one after another, or near one
  // another, get much the same speed (a rope through them stays smooth)
  const timeScale = compileFloat(def.m_flNoiseScale, 1);
  const placeScale = compileFloat(def.m_flNoiseScaleLoc, 0.01);
  const offset = arr(def.m_vecOffsetLoc, [0, 0, 0]);
  const timeOffset = def.m_flOffset ?? 0;
  const point = def.m_TransformInput?.m_nControlPoint ?? def.m_nControlPointNumber ?? 0;
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
        const t = (system.age + timeOffset) * timeScale(system, i);
        const s = placeScale(system, i);
        const x = (p[i * 3] + offset[0]) * s;
        const y = (p[i * 3 + 1] + offset[1]) * s;
        const z = (p[i * 3 + 2] + offset[2]) * s;
        v1.set(
          lerp(lo[0], hi[0], noise(x + t, y, z) * 0.5 + 0.5),
          lerp(lo[1], hi[1], noise(x + 31.7, y + t, z + 7.3) * 0.5 + 0.5),
          lerp(lo[2], hi[2], noise(x + 11.1, y + 53.9, z + t) * 0.5 + 0.5)
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
  // The ring's plane turned in the control point's space, in degrees: pitch about y, yaw about
  // z, roll about x (a ring standing upright round a fan)
  const pitch = compileFloat(def.m_flPitch, 0);
  const yaw = compileFloat(def.m_flYaw, 0);
  const roll = compileFloat(def.m_flRoll, 0);
  const turned = def.m_flPitch !== undefined || def.m_flYaw !== undefined || def.m_flRoll !== undefined;
  const turn = new THREE.Quaternion();
  const euler = new THREE.Euler();
  let n = 0;
  return {
    init(system, start, end) {
      const cp = system.controlPoint(point);
      if (turned) turn.setFromEuler(euler.set(roll(system, -1) * deg, pitch(system, -1) * deg, yaw(system, -1) * deg, "ZYX"));
      const p = system.float(0);
      const q = system.float(2);
      for (let i = start; i < end; i++) {
        const orbit = perOrbit(system, i);
        const angle = even && orbit > 0 ? ((n++ % orbit) / orbit) * Math.PI * 2 : Math.random() * Math.PI * 2;
        const r = radius(system, i) + (Math.random() - 0.5) * thickness(system, i);
        v1.set(Math.cos(angle), Math.sin(angle), 0);
        if (turned) v1.applyQuaternion(turn);
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

// On the points of the snapshot at the control point (where the artist put them on the model),
// in their order or at random; on the model's surface when there is no snapshot
const fromSnapshot = (def, point) => {
  const randomly = Boolean(def.m_bRandom);
  const increment = def.m_flIncrement ?? 1;
  const setRadius = Boolean(def.m_bSetRadius);
  const copyColor = Boolean(def.m_bCopyColor);
  const fallback = onModel();
  let next = def.m_nSnapShotStartPoint ?? 0;
  return {
    init(system, start, end) {
      const snapshot = system.snapshot(point);
      const points = snapshot && system.host.snapshotPoints?.(snapshot);
      if (!points?.length) return fallback.init(system, start, end);
      const surface = system.host.surface;
      const p = system.float(0);
      const q = system.float(2);
      const normal = system.float(21);
      const radius = system.float(3);
      const color = system.float(6);
      system.bindings ??= [];
      for (let i = start; i < end; i++) {
        const k = randomly ? Math.floor(Math.random() * points.length) : Math.floor(next) % points.length;
        if (!randomly) next += increment;
        const found = points[k];
        const binding = { mesh: found.mesh, index: found.index, offset: found.offset };
        system.bindings[i] = binding;
        surface.position(binding, v1);
        for (let c = 0; c < 3; c++) p[i * 3 + c] = q[i * 3 + c] = v1.getComponent(c);
        if (found.normal) for (let c = 0; c < 3; c++) normal[i * 3 + c] = found.normal[c];
        if (setRadius && found.radius !== undefined) radius[i] = found.radius;
        if (copyColor && found.color) for (let c = 0; c < 3; c++) color[i * 3 + c] = found.color[c];
      }
    },
  };
};
// m_bRigid (set in nearly every file) has the game carry a point by its strongest bone alone
// instead of the bones' blend: the vertex it is bound to here moves all but the same way
DEFS.C_INIT_InitSkinnedPositionFromCPSnapshot = (def) => fromSnapshot(def, def.m_nSnapshotControlPointNumber ?? 1);

// A snapshot whose points are in a control point's own space (a blade's points along the bone
// the weapon's attachment hangs on, a crown's round the head's): each point put where that
// control point carries it
const snapshotInSpace = (def, point, space) => {
  const randomly = Boolean(def.m_bRandom);
  const increment = def.m_flIncrement ?? 1;
  let next = def.m_nSnapShotStartPoint ?? 0;
  return {
    init(system, start, end) {
      const snapshot = system.snapshot(point);
      const positions = snapshot && system.host.snapshotData?.(snapshot)?.position;
      if (!positions?.length) return;
      // A space nothing sets is the world's origin: the points stay as the file gives them, and
      // MovementRigidAttachToCP carries them to the weapon (Ember Spirit's sword fire, CP 4;
      // it was put at the effect's own CP 0, which moved the fire off the blade a second time)
      const cp = system.controlPointIfSet(space);
      const p = system.float(0);
      const q = system.float(2);
      for (let i = start; i < end; i++) {
        const k = randomly ? Math.floor(Math.random() * positions.length) : Math.floor(next) % positions.length;
        if (!randomly) next += increment;
        const [x = 0, y = 0, z = 0] = positions[k];
        v1.set(x, y, z);
        if (cp) v1.applyQuaternion(cp.quaternion).add(cp.position);
        for (let c = 0; c < 3; c++) p[i * 3 + c] = q[i * 3 + c] = v1.getComponent(c);
      }
    },
  };
};

// The same, when it reads the snapshot's positions (it may read another of its streams instead,
// a color or a radius, which is not done here: on the model's surface then); in a control
// point's space when it names one. A system that holds its particles with MovementRigidAttachToCP
// takes the points as given too: they are offsets in that control point's space (Timbersaw's saw
// outline round attach_saw), which binding them to the model's nearest vertices moved a second time
DEFS.C_INIT_InitFromCPSnapshot = (def, system) => {
  // The stream it reads; -1 (the default) reads the one it writes, the position unless it names another
  const read = def.m_nAttributeToRead ?? -1;
  if ((read === -1 ? def.m_nAttributeToWrite ?? 0 : read) !== 0) return onModel();
  const point = def.m_nControlPointNumber ?? 0;
  const space = def.m_nLocalSpaceCP ?? -1;
  const rigid = (system?.def?.m_Operators ?? []).some((op) => op?._class === "C_OP_MovementRigidAttachToCP" && !op.m_bDisableOperator && (op.m_nFieldInput ?? 2) === 2);
  return space >= 0 || rigid ? snapshotInSpace(def, point, space) : fromSnapshot(def, point);
};
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
        // Bound to the model where the parent is, for the operators that keep it there
        const binding = parent.bindings?.[j];
        if (binding) {
          system.bindings ??= [];
          system.bindings[i] = { mesh: binding.mesh, index: binding.index, offset: binding.offset };
        }
      }
    },
  };
};

// The radius unless the file names a field (files that inherit the tint write field 6 out)
function inheritFromParent(def, every) {
  const field = def.m_nFieldOutput ?? 3;
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

// Positions stretched from a control point by a warp between the two vectors, times the value of
// m_nScaleControlPointNumber when something sets one (the model's scale, so a weapon's snapshot
// shrinks with a hero drawn smaller)
DEFS.C_INIT_PositionWarp = (def) => {
  const min = arr(def.m_vecWarpMin, [1, 1, 1]);
  const max = arr(def.m_vecWarpMax, [1, 1, 1]);
  const point = def.m_nControlPointNumber ?? 0;
  const scalePoint = def.m_nScaleControlPointNumber ?? -1;
  return {
    init(system, start, end) {
      const center = system.controlPoint(point).position;
      const scaled = scalePoint >= 0 && system.controlPointIfSet(scalePoint)?.value;
      const by = scaled && scaled.lengthSq() > 0 ? scaled : null;
      const p = system.float(0);
      const q = system.float(2);
      for (let i = start; i < end; i++) {
        const t = Math.random();
        for (let k = 0; k < 3; k++) {
          const c = center.getComponent(k);
          const warp = lerp(min[k], max[k], t) * (by ? by.getComponent(k) : 1);
          p[i * 3 + k] = c + (p[i * 3 + k] - c) * warp;
          q[i * 3 + k] = c + (q[i * 3 + k] - c) * warp;
        }
      }
    },
  };
};

const CP_AXES = { PARTICLE_CP_AXIS_X: 0, PARTICLE_CP_AXIS_Y: 1, PARTICLE_CP_AXIS_Z: 2 };

// Normals along an axis of the control point (m_nControlPointAxis, x by default)
DEFS.C_INIT_NormalAlignToCP = (def) => {
  const point =
    def.m_nControlPointNumber ?? def.m_transformInput?.m_nControlPoint ?? def.m_nControlPoint ?? 0;
  const axis = CP_AXES[def.m_nControlPointAxis] ?? 0;
  return {
    init(system, start, end) {
      const forward = system.controlPoint(point).axis(axis, v1);
      const normal = system.float(21);
      for (let i = start; i < end; i++) {
        normal[i * 3] = forward.x;
        normal[i * 3 + 1] = forward.y;
        normal[i * 3 + 2] = forward.z;
      }
    },
  };
};

// A field from the particle's number, m_nInputMin..m_nInputMax remapped to the output range
// (counting round again past the end, m_bWrap); particles outside the range left as they are
// (m_bActiveRange)
DEFS.C_INIT_RemapParticleCountToScalar = (def) => {
  const inMin = def.m_nInputMin ?? 0;
  const inMax = def.m_nInputMax ?? 10;
  const outMin = def.m_flOutputMin ?? 0;
  const outMax = def.m_flOutputMax ?? 1;
  const field = def.m_nFieldOutput ?? 3;
  const scale = Boolean(def.m_bScaleInitialRange);
  const wrap = Boolean(def.m_bWrap);
  const active = Boolean(def.m_bActiveRange);
  return {
    init(system, start, end) {
      for (let i = start; i < end; i++) {
        let count = system.ids[i];
        if (wrap && inMax > inMin) count = inMin + ((count - inMin) % (inMax - inMin + 1));
        if (active && (count < inMin || count > inMax)) continue;
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

// A field taken from the parent's particle this one is made from as it was killed; one not made
// by such an emitter keeps what it has
DEFS.C_INIT_InitFromParentKilled = (def) => {
  const field = def.m_nAttributeToCopy ?? -1;
  return {
    init(system, start, end) {
      for (let i = start; i < end; i++) {
        const record = system.fromKilled?.[i - start];
        if (!record) continue;
        for (const [from, values] of record) {
          if (field >= 0 && from !== field) continue;
          system.float(from).set(values, i * values.length);
          if (from === 0) system.float(2).set(values, i * 3);
        }
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

// A path between two control points (m_PathParams), as the game makes it: a curve through a
// middle point at m_flMidPoint of the way, pushed out by m_flBulge times the length along the
// start's (m_nBulgeControl 1) or end's (2) forward axis, less so the more that axis follows the
// path, or by a random vector of up to m_flBulge (0)
const pathStart = new THREE.Vector3();
const pathMiddle = new THREE.Vector3();
const pathEnd = new THREE.Vector3();
function path(params = {}) {
  const from = params.m_nStartControlPointNumber ?? 0;
  const to = params.m_nEndControlPointNumber ?? 0;
  const middle = params.m_flMidPoint ?? 0.5;
  const bulge = params.m_flBulge ?? 0;
  const control = params.m_nBulgeControl ?? 0;
  const startOffset = arr(params.m_vStartPointOffset, [0, 0, 0]);
  const middleOffset = arr(params.m_vMidPointOffset, [0, 0, 0]);
  const endOffset = arr(params.m_vEndOffset, [0, 0, 0]);
  return {
    // The three points for now; a random bulge is drawn again each time unless one is passed
    update(system, randomBulge) {
      pathStart.copy(system.controlPoint(from).position).add(v1.fromArray(startOffset));
      pathEnd.copy(system.controlPoint(to).position).add(v1.fromArray(endOffset));
      pathMiddle.lerpVectors(pathStart, pathEnd, middle).add(v1.fromArray(middleOffset));
      if (control) {
        const forward = system.controlPoint(control === 2 ? to : from).axis(0, v1);
        const along = v2.subVectors(pathEnd, pathStart);
        const length = along.length();
        const scale = length > 1e-6 ? 1 - Math.abs(along.divideScalar(length).dot(forward)) : 0;
        pathMiddle.addScaledVector(forward, bulge * length * scale);
      } else if (bulge) {
        pathMiddle.add(randomBulge ?? v1.set(random(-bulge, bulge), random(-bulge, bulge), random(-bulge, bulge)));
      }
    },
    // The point t of the way along it
    at(t, target) {
      v2.lerpVectors(pathStart, pathMiddle, t);
      v3.lerpVectors(pathMiddle, pathEnd, t);
      return target.lerpVectors(v2, v3, t);
    },
  };
}

// Particles laid along the path between two control points, in turn
function sequentialPath(def) {
  const route = path(def.m_PathParams);
  // A number in CreateSequentialPath, an input in V2 (the card edges' named SideCount)
  const countOf = compileFloat(def.m_flNumToAssign, 100);
  const loop = def.m_bLoop ?? true;
  let n = 0;
  return {
    init(system, start, end) {
      const count = Math.round(countOf(system, -1));
      route.update(system);
      const p = system.float(0);
      const q = system.float(2);
      for (let i = start; i < end; i++) {
        let t = count > 1 ? n / (count - 1) : 0;
        n = loop ? (n + 1) % Math.max(count, 1) : Math.min(n + 1, count - 1);
        route.at(t, v1);
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

// The radius the scale of the object at a control point (m_nControlPoint): models a particle draws
// at its own size then (Terrorblade's blade planes). The viewer draws every model at its own
// scale, so that is 1
DEFS.C_INIT_RadiusFromCPObject = () => ({
  init(system, start, end) {
    system.float(3).fill(1, start, end);
  },
});

// Initializers that do nothing visible here: velocities inherited from still control points
const nothing = () => ({});
// Made moving as their control point does, by a share of its speed
DEFS.C_INIT_InheritVelocity = (def) => {
  const point = def.m_nControlPointNumber ?? 0;
  const scale = def.m_flVelocityScale ?? 1;
  return {
    init(system, start, end) {
      const cp = system.controlPoint(point);
      // Its movement since the last frame, a second's worth
      v1.subVectors(cp.position, cp.previous).multiplyScalar(60 * scale);
      for (let i = start; i < end; i++) setVelocity(system, i, v1.x, v1.y, v1.z, true);
    },
  };
};

// The normal turned by a random offset, in a control point's space if asked, then made unit
DEFS.C_INIT_NormalOffset = (def) => {
  const min = arr(def.m_OffsetMin, [0, 0, 0]);
  const max = arr(def.m_OffsetMax, [0, 0, 0]);
  const point = def.m_nControlPointNumber ?? 0;
  const local = Boolean(def.m_bLocalCoords);
  const normalize = Boolean(def.m_bNormalize);
  return {
    init(system, start, end) {
      const cp = system.controlPoint(point);
      const normal = system.float(21);
      for (let i = start; i < end; i++) {
        v1.set(random(min[0], max[0]), random(min[1], max[1]), random(min[2], max[2]));
        if (local) v1.applyQuaternion(cp.quaternion);
        v2.set(normal[i * 3], normal[i * 3 + 1], normal[i * 3 + 2]).add(v1);
        if (normalize && v2.lengthSq() > 0) v2.normalize();
        normal[i * 3] = v2.x;
        normal[i * 3 + 1] = v2.y;
        normal[i * 3 + 2] = v2.z;
      }
    },
  };
};

// Normals turned as their control point turns
DEFS.C_OP_NormalLock = (def) => {
  const point = def.m_nControlPointNumber ?? 0;
  let last = null;
  const turn = new THREE.Quaternion();
  return {
    update(system) {
      const cp = system.controlPoint(point);
      if (last) {
        turn.copy(last).invert().premultiply(cp.quaternion);
        const normal = system.float(21);
        for (let i = 0; i < system.count; i++) {
          v1.set(normal[i * 3], normal[i * 3 + 1], normal[i * 3 + 2]).applyQuaternion(turn);
          normal[i * 3] = v1.x;
          normal[i * 3 + 1] = v1.y;
          normal[i * 3 + 2] = v1.z;
        }
      }
      last = (last ?? new THREE.Quaternion()).copy(cp.quaternion);
    },
  };
};

// Lives as long as its sequence of the sheet plays at m_flFramerate frames a second (the sheet is
// loaded before the effect starts; without one the particle keeps its lifetime)
DEFS.C_INIT_SequenceLifeTime = (def, system) => {
  const rate = def.m_flFramerate ?? 30;
  const texture = sheetTextureOf(system.def);
  return {
    init(system, start, end) {
      const sequences = texture && system.host.loadedTexture?.(texture)?.sheet?.sequences;
      if (!sequences?.length || rate <= 0) return;
      const life = system.float(1);
      const sequence = system.float(9);
      for (let i = start; i < end; i++) {
        life[i] = sequences[Math.abs(Math.floor(sequence[i])) % sequences.length].frames.length / rate;
      }
    },
  };
};

// ---------------------------------------------------------------- operators

// Particles kept on the path between two control points each step, the n-th of every
// m_flNumToAssign (or of all of them, m_bUseParticleCount) at n of the way; m_flCohesionStrength
// pulls them only part way, m_fMaxDistance keeps them at most that far from their place
DEFS.C_OP_MaintainSequentialPath = (def) => {
  const route = path(def.m_PathParams);
  const assign = def.m_flNumToAssign ?? 100;
  const byCount = Boolean(def.m_bUseParticleCount);
  const cohesion = def.m_flCohesionStrength ?? 1;
  const maxDistance = def.m_fMaxDistance ?? 0;
  const bulge = def.m_PathParams?.m_flBulge ?? 0;
  // A random bulge drawn once, so the path holds still
  const randomBulge = new THREE.Vector3(random(-bulge, bulge), random(-bulge, bulge), random(-bulge, bulge));
  return {
    update(system) {
      route.update(system, randomBulge);
      const count = Math.max(byCount ? system.count : assign, 1);
      const p = system.float(0);
      const q = system.float(2);
      for (let i = 0; i < system.count; i++) {
        const t = count > 1 ? (i % count) / (count - 1) : 0;
        route.at(t, v1);
        v2.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]).lerp(v1, cohesion);
        if (maxDistance > 0 && v2.distanceTo(v1) > maxDistance) v2.sub(v1).setLength(maxDistance).add(v1);
        for (let k = 0; k < 3; k++) {
          const move = v2.getComponent(k) - p[i * 3 + k];
          p[i * 3 + k] += move;
          q[i * 3 + k] += move;
        }
      }
    },
  };
};

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
  const amount = def.m_flBias ?? 0.5;
  // Only within its window of the particle's life (particles.dll 0x1801f0c60: life > 0 and
  // start ≤ age / life ≤ end, a window shorter than the step widened to it); outside it the radius
  // is left to the other operators (Broodmother's page web pulses by OscillateScalar once grown)
  return {
    update(system, dt) {
      const radius = system.float(3);
      const initial = system.initialFloat(3);
      const born = system.float(8);
      const life = system.float(1);
      for (let i = 0; i < system.count; i++) {
        if (!(life[i] > 0) || end <= start) continue;
        const share = (system.age - born[i]) / life[i];
        const last = Math.max(end, start + dt / life[i]);
        if (share < start || share > last) continue;
        let t = clamp((share - start) / (end - start), 0, 1);
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

// Particles carried along with their control point's movement; turned with it too when locked
// rigidly (a blade's glow stays on the blade as it swings)
const lockToCP = (def, rigid) => {
  const point = cpOf(def);
  const jump = def.m_flJumpThreshold ?? 512;
  let last = null;
  const lastTurn = new THREE.Quaternion();
  const turn = new THREE.Quaternion();
  return {
    update(system) {
      const cp = system.controlPoint(point);
      if (last && v1.subVectors(cp.position, last).length() < jump) {
        // The turn since the last step, about where the control point was
        turn.copy(lastTurn).invert().premultiply(cp.quaternion);
        const p = system.float(0);
        for (let i = 0; i < system.count; i++) {
          if (rigid) {
            v3.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]).sub(last).applyQuaternion(turn).add(cp.position);
            move(system, i, v3.x - p[i * 3], v3.y - p[i * 3 + 1], v3.z - p[i * 3 + 2]);
          } else {
            move(system, i, v1.x, v1.y, v1.z);
          }
        }
      }
      last = (last ?? new THREE.Vector3()).copy(cp.position);
      lastTurn.copy(cp.quaternion);
    },
  };
};
DEFS.C_OP_PositionLock = (def) => lockToCP(def, Boolean(def.m_bLockRot));

// Particles held at a control point by an offset in its own space: the place they were made at
// (or a field an initializer filled), turned with the control point unless m_bOffsetLocal is
// off. Most follow InitFromCPSnapshot with its space left at the world's origin, so a weapon's
// snapshot, drawn round the origin, is carried onto the weapon's attachment.
DEFS.C_OP_MovementRigidAttachToCP = (def, system) => {
  const point = cpOf(def);
  // The default input (2) is the particles' own place: the one each was made at, kept from now on
  const input = def.m_nFieldInput ?? 2;
  const output = def.m_nFieldOutput ?? 0;
  const local = def.m_bOffsetLocal ?? true;
  const offsets = input === 2 ? system.initialVector(0) : null;
  return {
    update(system) {
      const cp = system.controlPoint(point);
      const from = offsets ?? system.float(input);
      const to = system.float(output);
      const previous = output === 0 ? system.float(2) : null;
      for (let i = 0; i < system.count; i++) {
        const j = i * 3;
        v1.set(from[j], from[j + 1], from[j + 2]);
        if (local) v1.applyQuaternion(cp.quaternion);
        v1.add(cp.position);
        if (previous) for (let c = 0; c < 3; c++) previous[j + c] += v1.getComponent(c) - to[j + c];
        to[j] = v1.x;
        to[j + 1] = v1.y;
        to[j + 2] = v1.z;
      }
    },
  };
};

DEFS.C_OP_RampScalarLinearSimple = (def) => {
  const rate = def.m_Rate ?? 0;
  const start = def.m_flStartTime ?? 0;
  const end = def.m_flEndTime ?? 1;
  const field = def.m_nField ?? 3;
  // Its times are shares of the particle's life not capped at 1 (particles.dll 0x1801e6be0:
  // (now − born) / life, start ≤ t < end, nothing for a life of 0), so a particle past its life
  // still ramps: Underlord's loadout rift, a black disc of life 1 that grows and fades from its
  // 2nd second, stayed on for good while the share stopped at 1
  return {
    update(system, dt) {
      const data = system.float(field);
      const born = system.float(8);
      const life = system.float(1);
      for (let i = 0; i < system.count; i++) {
        if (!(life[i] > 0)) continue;
        const t = (system.age - born[i]) / life[i];
        if (t >= start && t < end) data[i] += rate * dt;
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
  const field = def.m_nOutputField ?? 3;
  const value = degreesIn(def, field, compileFloat(def.m_InputValue, 0));
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
  const time = def.m_flDecayTime ?? 0;
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
  const field = def.m_nFieldOutput ?? 6;
  const min = arr(def.m_vecOutputMin, [0, 0, 0]);
  const max = arr(def.m_vecOutputMax, [1, 1, 1]);
  const scale = def.m_fl4NoiseScale ?? 0.1;
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
  const scale = def.m_fl4NoiseScale ?? 0.1;
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

// The distance between two points (vector inputs: control points, a particle's own vectors),
// from m_flInputMin..Max to m_flOutputMin..Max, into a field. The loadout pedestal's soft fog
// measures its two rim attachments (attachment_distance_a and _b) with it, and pushes itself out
// from the middle by that (AttractToControlPoint with a negative force on the field)
DEFS.C_OP_DistanceBetweenVecs = (def) => {
  const field = def.m_nFieldOutput ?? 3;
  const first = compileVector(def.m_vecPoint1, [0, 0, 0]);
  const second = compileVector(def.m_vecPoint2, [0, 0, 0]);
  const inMin = compileFloat(def.m_flInputMin, 0);
  const inMax = compileFloat(def.m_flInputMax, 128);
  const outMin = compileFloat(def.m_flOutputMin, 0);
  const outMax = compileFloat(def.m_flOutputMax, 1);
  const perSecond = Boolean(def.m_bDeltaTime);
  const set = setter(def);
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  return {
    update(system, dt) {
      const data = system.float(field);
      const initial = system.initialFloat(field);
      const vector = VECTOR_FIELDS.has(field);
      for (let i = 0; i < system.count; i++) {
        first(system, i, a);
        second(system, i, b);
        let distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        if (perSecond && dt > 0) distance /= dt;
        const value = remap(distance, inMin(system, i), inMax(system, i), outMin(system, i), outMax(system, i));
        writeFloat(system, field, i, set(vector ? data[i * 3] : data[i], vector ? initial[i * 3] : initial[i], value));
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

// Particles kept where they were made on the model as it moves (see onModel), letting go over
// the part of their life the operator gives (LockToBone's fade)
const followModel = (def) => {
  const fadeStart = def.m_flLifeTimeFadeStart ?? 0;
  const fadeEnd = def.m_flLifeTimeFadeEnd ?? 0;
  return {
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
        binding.last.copy(v1);
        const hold = fadeEnd > fadeStart ? 1 - clamp((system.normalizedAge(i) - fadeStart) / (fadeEnd - fadeStart), 0, 1) : 1;
        if (hold > 0) move(system, i, v2.x * hold, v2.y * hold, v2.z * hold);
      }
    },
  };
};
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
  // Most files name the control point m_nCP, the newer ones as a transform input
  const point = def.m_nCP ?? cpOf(def);
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
  const inMax = def.m_flInputMax ?? 1;
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
  const falloff = def.m_fFalloffPower ?? 2;
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

// Kept on the ground, at its height plus m_flOffset, while the ground is within the trace: from
// m_flTraceOffset above the particle down m_flMaxTraceLength; the ground under the hero is the
// only world here, flat at height 0, so its normal is up (m_bSetNormal)
DEFS.C_OP_MovementPlaceOnGround = (def) => {
  const offset = compileFloat(def.m_flOffset, 0);
  const length = def.m_flMaxTraceLength ?? 128;
  const above = def.m_flTraceOffset ?? 64;
  const normal = Boolean(def.m_bSetNormal);
  return {
    update(system) {
      const p = system.float(0);
      const q = system.float(2);
      const n = system.float(21);
      for (let i = 0; i < system.count; i++) {
        const top = p[i * 3 + 2] + above;
        if (top < 0 || top - length > 0) continue;
        p[i * 3 + 2] = q[i * 3 + 2] = offset(system, i);
        if (normal) {
          n[i * 3] = n[i * 3 + 1] = 0;
          n[i * 3 + 2] = 1;
        }
      }
    },
  };
};

// Hue turned by m_flHueAdjust degrees, saturation and lightness moved by their adjusts, each step
// from the color the particle has before it: one this operator wrote last step is undone first,
// so the turn is not added up step after step
const hsl = new THREE.Color();
const hslOut = { h: 0, s: 0, l: 0 };
DEFS.C_OP_ColorAdjustHSL = (def) => {
  const hue = compileFloat(def.m_flHueAdjust, 0);
  const saturation = compileFloat(def.m_flSaturationAdjust, 0);
  const lightness = compileFloat(def.m_flLightnessAdjust, 0);
  let written = new Map();
  return {
    update(system) {
      const color = system.float(6);
      const next = new Map();
      for (let i = 0; i < system.count; i++) {
        const id = system.ids[i];
        const k = i * 3;
        const memo = written.get(id) ?? new Float32Array(6);
        if (!(written.has(id) && color[k] === memo[3] && color[k + 1] === memo[4] && color[k + 2] === memo[5])) {
          memo[0] = color[k];
          memo[1] = color[k + 1];
          memo[2] = color[k + 2];
        }
        hsl.setRGB(memo[0], memo[1], memo[2]).getHSL(hslOut);
        const h = hslOut.h + hue(system, i) / 360;
        hsl.setHSL(h - Math.floor(h), clamp(hslOut.s + saturation(system, i), 0, 1), clamp(hslOut.l + lightness(system, i), 0, 1));
        memo[3] = color[k] = hsl.r;
        memo[4] = color[k + 1] = hsl.g;
        memo[5] = color[k + 2] = hsl.b;
        next.set(id, memo);
      }
      written = next;
    },
  };
};

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
  const target = def.m_nCP ?? 1;
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

// m_nOutputCP at m_nInputCP, turned so its x axis follows the ground's normal under it; the ground
// under the hero is the only world here, flat at height 0, so the normal is always up
const X_TO_UP = new THREE.Quaternion().setFromUnitVectors(
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 0, 1),
);
DEFS.C_OP_SetCPOrientationToGroundNormal = (def) => {
  const input = def.m_nInputCP ?? 0;
  const output = def.m_nOutputCP ?? 1;
  return {
    update(system) {
      const from = system.controlPoint(input);
      const point = system.ownControlPoint(output);
      point.position.copy(from.position);
      point.quaternion.copy(X_TO_UP);
    },
  };
};

// m_nOutputCP turned where it stands so its x axis points at m_nInputCP (away from it with
// m_bPointAway; level with m_b2DOrientation): the card edges' CP5, along an edge
const X_AXIS = new THREE.Vector3(1, 0, 0);
DEFS.C_OP_SetCPOrientationToPointAtCP = (def) => {
  const input = def.m_nInputCP ?? 0;
  const output = def.m_nOutputCP ?? 0;
  const away = Boolean(def.m_bPointAway);
  const flat = Boolean(def.m_b2DOrientation);
  const direction = new THREE.Vector3();
  return {
    update(system) {
      const at = system.controlPoint(output);
      direction.subVectors(system.controlPoint(input).position, at.position);
      if (away) direction.negate();
      if (flat) direction.z = 0;
      if (direction.lengthSq() < 1e-8) return;
      const point = system.ownControlPoint(output);
      if (point !== at) point.position.copy(at.position);
      point.quaternion.setFromUnitVectors(X_AXIS, direction.normalize());
    },
  };
};

DEFS.C_OP_SetControlPointFromObjectScale = (def) => {
  const output = def.m_nCPOutput ?? 1;
  return {
    update(system) {
      system.ownControlPoint(output).value.setScalar(system.host.objectScale?.() ?? 1);
    },
  };
};

// One control point of each child in group m_nChildGroupID, in the order the file lists them: the
// k-th child's m_nChildControlPoint at this system's control point m_nFirstSourcePoint + k, for
// m_nNumControlPoints children; turned too with m_bSetOrientation. A "dual" effect (Lina's
// lina_flame_hand_dual: the same child twice, CP0 and CP1 at her two hands) puts one on each
DEFS.C_OP_SetParentControlPointsToChildCP = (def) => {
  const group = def.m_nChildGroupID ?? 0;
  const childPoint = def.m_nChildControlPoint ?? 0;
  const count = def.m_nNumControlPoints ?? 1;
  const first = def.m_nFirstSourcePoint ?? 0;
  const orient = Boolean(def.m_bSetOrientation);
  return {
    update(system) {
      const children = system.children.filter((child) => (child.def.m_nGroupID ?? 0) === group);
      for (let k = 0; k < Math.min(count, children.length); k++) {
        const child = children[k].system;
        if (!child) continue;
        const from = system.controlPoint(first + k);
        const point = child.ownControlPoint(childPoint);
        point.previous.copy(point.position);
        point.position.copy(from.position);
        if (orient) point.quaternion.copy(from.quaternion);
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

// One control point of each child in group m_nChildGroupID, in the order the file lists them, put
// where a particle is: the k-th child's at particle m_nFirstSourcePoint + k; as many children
// as m_nNumControlPoints, or as there are particles (m_bNumBasedOnParticleCount). Turned to face
// the way the particle moves (m_bSetOrientation), or its m_nOrientationField
DEFS.C_OP_SetPerChildControlPoint = (def) => {
  const group = def.m_nChildGroupID ?? 0;
  const childPoint = def.m_nFirstControlPoint ?? 0;
  const count = def.m_nNumControlPoints ?? 1;
  const first = def.m_nFirstSourcePoint ?? 0;
  const step = def.m_nParticleIncrement ?? 1;
  const byCount = Boolean(def.m_bNumBasedOnParticleCount);
  const orient = Boolean(def.m_bSetOrientation);
  const field = def.m_nOrientationField ?? 19;
  const forward = new THREE.Vector3(1, 0, 0);
  return {
    update(system) {
      const p = system.float(0);
      const q = system.float(2);
      const n = orient && field >= 0 && VECTOR_FIELDS.has(field) ? system.float(field) : null;
      const children = system.children.filter((child) => (child.def.m_nGroupID ?? 0) === group);
      const total = Math.min(children.length, byCount ? system.count : count);
      for (let k = 0; k < total; k++) {
        const i = first + k * step;
        const child = children[k].system;
        if (!child || i >= system.count) continue;
        const point = child.ownControlPoint(childPoint);
        point.previous.copy(point.position);
        point.position.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
        if (orient) {
          if (n) v1.set(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]);
          else v1.set(p[i * 3] - q[i * 3], p[i * 3 + 1] - q[i * 3 + 1], p[i * 3 + 2] - q[i * 3 + 2]);
          if (v1.lengthSq() > 1e-12) point.quaternion.setFromUnitVectors(forward, v1.normalize());
        }
      }
    },
  };
};

// Control points at the system's model particles, each at an attachment of its model as it is
// posed now (hitboxes are not in the dataset yet: the particle's own place then)
DEFS.C_OP_SetControlPointsToModelParticles = (def) => {
  const firstPoint = def.m_nFirstControlPoint ?? 0;
  const count = def.m_nNumControlPoints ?? 1;
  const first = def.m_nFirstSourcePoint ?? 0;
  const name = def.m_bAttachment ? def.m_AttachmentName : null;
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  return {
    update(system) {
      const renderer = modelRenderer(system);
      const p = system.float(0);
      for (let k = 0; k < count && first + k < system.count; k++) {
        const i = first + k;
        const point = system.ownControlPoint(firstPoint + k);
        point.previous.copy(point.position);
        if (name && renderer?.attachment(system, i, name, position, quaternion)) {
          toSource(position, point.position);
          quaternionToSource(quaternion, point.quaternion);
        } else {
          point.position.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
        }
      }
    },
  };
};

// Control points from m_nFirstControlPoint on put where particles from m_nFirstSourcePoint on
// are, turned to face the way each moves (m_bSetOrientation)
DEFS.C_OP_SetControlPointsToParticle = (def) => {
  const firstPoint = def.m_nFirstControlPoint ?? 0;
  const count = def.m_nNumControlPoints ?? 1;
  const first = def.m_nFirstSourcePoint ?? 0;
  const orient = Boolean(def.m_bSetOrientation);
  const forward = new THREE.Vector3(1, 0, 0);
  return {
    update(system) {
      const p = system.float(0);
      const q = system.float(2);
      for (let k = 0; k < count && first + k < system.count; k++) {
        const i = first + k;
        const point = system.ownControlPoint(firstPoint + k);
        point.previous.copy(point.position);
        point.position.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
        if (orient) {
          v1.set(p[i * 3] - q[i * 3], p[i * 3 + 1] - q[i * 3 + 1], p[i * 3 + 2] - q[i * 3 + 2]);
          if (v1.lengthSq() > 1e-12) point.quaternion.setFromUnitVectors(forward, v1.normalize());
        }
      }
    },
  };
};

// The particles turned as a control point is (and by a turn of their own after it), as roll,
// pitch and yaw
DEFS.C_OP_RemapCPOrientationToRotations = (def) => {
  const cp = cpOf(def);
  const rotation = arr(def.m_vecRotation, [0, 0, 0]);
  // Source angles: pitch about y, yaw about z, roll about x
  const offset = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[2] * deg, rotation[0] * deg, rotation[1] * deg, "ZYX"));
  const turn = new THREE.Quaternion();
  const euler = new THREE.Euler();
  return {
    update(system) {
      turn.copy(system.controlPoint(cp).quaternion).multiply(offset);
      euler.setFromQuaternion(turn, "ZYX");
      system.float(4).fill(euler.x, 0, system.count);
      system.float(20).fill(euler.y, 0, system.count);
      system.float(12).fill(euler.z, 0, system.count);
    },
  };
};

// A field (most often the normal) set to the way a control point faces, times m_flScale
DEFS.C_OP_RemapControlPointDirectionToVector = (def) => {
  const cp = def.m_nControlPointNumber ?? 0;
  const field = def.m_nFieldOutput ?? 21;
  const scale = def.m_flScale ?? 1;
  return {
    update(system) {
      v1.set(scale, 0, 0).applyQuaternion(system.controlPoint(cp).quaternion);
      if (!VECTOR_FIELDS.has(field)) return;
      const data = system.float(field);
      for (let i = 0; i < system.count; i++) {
        data[i * 3] = v1.x;
        data[i * 3 + 1] = v1.y;
        data[i * 3 + 2] = v1.z;
      }
    },
  };
};

// A field set to the way from a particle to a control point, turned m_flOffsetRot degrees
// round m_vecOffsetAxis, of length one (m_bNormalize) times m_flScale
DEFS.C_OP_RemapDirectionToCPToVector = (def) => {
  const cp = def.m_nCP ?? 0;
  const field = def.m_nFieldOutput ?? 21;
  const scale = def.m_flScale ?? 1;
  const normalize = Boolean(def.m_bNormalize);
  const axis = new THREE.Vector3(...arr(def.m_vecOffsetAxis, [0, 0, 1]));
  const turn = def.m_flOffsetRot ? new THREE.Quaternion().setFromAxisAngle(axis.lengthSq() ? axis.normalize() : axis.set(0, 0, 1), def.m_flOffsetRot * deg) : null;
  return {
    update(system) {
      if (!VECTOR_FIELDS.has(field)) return;
      const target = system.controlPoint(cp).position;
      const p = system.float(0);
      const data = system.float(field);
      for (let i = 0; i < system.count; i++) {
        v1.set(target.x - p[i * 3], target.y - p[i * 3 + 1], target.z - p[i * 3 + 2]);
        if (turn) v1.applyQuaternion(turn);
        if (normalize) v1.normalize();
        v1.multiplyScalar(scale);
        data[i * 3] = v1.x;
        data[i * 3 + 1] = v1.y;
        data[i * 3 + 2] = v1.z;
      }
    },
  };
};

// A vector field (the normal unless m_nFieldOutput) turned each second by a rate between
// m_flRotRateMin and m_flRotRateMax degrees round an axis between m_vecRotAxisMin and
// m_vecRotAxisMax, both picked once for each particle; times m_flScale, of length one when
// m_bNormalize
DEFS.C_OP_RotateVector = (def) => {
  const field = def.m_nFieldOutput ?? 21;
  const axisMin = arr(def.m_vecRotAxisMin, [0, 0, 1]);
  const axisMax = arr(def.m_vecRotAxisMax, [0, 0, 1]);
  const rateMin = def.m_flRotRateMin ?? 180;
  const rateMax = def.m_flRotRateMax ?? 180;
  const scale = compileFloat(def.m_flScale, 1);
  const normalize = Boolean(def.m_bNormalize);
  const turn = new THREE.Quaternion();
  return {
    update(system, dt) {
      if (!VECTOR_FIELDS.has(field)) return;
      const data = system.float(field);
      for (let i = 0; i < system.count; i++) {
        const id = system.ids[i];
        v2.set(lerp(axisMin[0], axisMax[0], (id * 0.618034) % 1), lerp(axisMin[1], axisMax[1], (id * 0.754878) % 1), lerp(axisMin[2], axisMax[2], (id * 0.569840) % 1));
        if (v2.lengthSq() < 1e-12) continue;
        const rate = lerp(rateMin, rateMax, (id * 0.414214) % 1) * scale(system, i);
        turn.setFromAxisAngle(v2.normalize(), rate * deg * dt);
        v1.set(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]).applyQuaternion(turn);
        if (normalize) v1.normalize();
        data[i * 3] = v1.x;
        data[i * 3 + 1] = v1.y;
        data[i * 3 + 2] = v1.z;
      }
    },
  };
};

// A field set from a control point, each axis remapped from m_vInputMin..m_vInputMax to
// m_vOutputMin..m_vOutputMax. A color is read from a control point's value: one the effect
// sets itself; the ones the game sets in code (a gem's or a player's tint, 15, 60) nothing sets
// here, so then the colors stay as authored, as with no tint
DEFS.C_OP_RemapCPtoVector = (def) => {
  const cp = def.m_nCPInput ?? 0;
  const field = def.m_nFieldOutput ?? 0;
  const inMin = arr(def.m_vInputMin, [0, 0, 0]);
  const inMax = arr(def.m_vInputMax, [0, 0, 0]);
  const outMin = arr(def.m_vOutputMin, [0, 0, 0]);
  const outMax = arr(def.m_vOutputMax, [0, 0, 0]);
  const set = setter(def);
  const color = field === 6;
  return {
    update(system) {
      if (!VECTOR_FIELDS.has(field)) return;
      const point = system.controlPoint(cp);
      if (color && !point.set) return;
      const from = color ? point.value : point.position;
      for (let k = 0; k < 3; k++) out3[k] = remap(from.getComponent(k), inMin[k], inMax[k], outMin[k], outMax[k]);
      const data = system.float(field);
      const initial = system.initialFloat(field);
      const position = field === 0 || field === 2;
      for (let i = 0; i < system.count; i++) {
        for (let k = 0; k < 3; k++) data[i * 3 + k] = position ? out3[k] : set(data[i * 3 + k], initial[i * 3 + k], out3[k]);
      }
    },
  };
};

// How far a particle is from m_nStartCP towards m_nEndCP, as a share of the way between them
// (its distance from the start, or along the line when not m_bRadialCheck), remapped from
// m_flInputMin..m_flInputMax to m_flOutputMin..m_flOutputMax into a field; particles outside
// the input range left as they are (m_bActiveRange). Nothing while the two points are one
DEFS.C_OP_PercentageBetweenCPs = (def) => {
  const field = def.m_nFieldOutput ?? 3;
  const inMin = compileFloat(def.m_flInputMin, 0);
  const inMax = compileFloat(def.m_flInputMax, 1);
  const outMin = compileFloat(def.m_flOutputMin, 0);
  const outMax = compileFloat(def.m_flOutputMax, 1);
  const startCP = def.m_nStartCP ?? 0;
  const endCP = def.m_nEndCP ?? 1;
  const radial = def.m_bRadialCheck !== false;
  const active = Boolean(def.m_bActiveRange);
  const set = setter(def);
  const scale = Boolean(def.m_bScaleInitialRange);
  return {
    update(system) {
      const a = system.controlPoint(startCP).position;
      const b = system.controlPoint(endCP).position;
      v2.subVectors(b, a);
      const total = v2.length();
      if (total < 1e-3) return;
      v2.divideScalar(total);
      const p = system.float(0);
      const data = system.float(field);
      const initial = system.initialFloat(field);
      const vector = VECTOR_FIELDS.has(field);
      for (let i = 0; i < system.count; i++) {
        v1.set(p[i * 3] - a.x, p[i * 3 + 1] - a.y, p[i * 3 + 2] - a.z);
        const share = (radial ? v1.length() : v1.dot(v2)) / total;
        const lo = inMin(system, i);
        const hi = inMax(system, i);
        if (active && (share < lo || share > hi)) continue;
        const value = remap(share, lo, hi, outMin(system, i), outMax(system, i));
        const base = vector ? initial[i * 3] : initial[i];
        writeFloat(system, field, i, scale ? base * value : set(vector ? data[i * 3] : data[i], base, value));
      }
    },
  };
};

// The hue shift a prismatic gem gives the effect, put in control point m_nOutputCP (62, where
// renderers read it): the turn from m_DefaultHSVColor to the gem's color when the game marks
// a gem; no gem is worn here, so it is none
DEFS.C_OP_HSVShiftToCP = (def) => {
  const target = def.m_nOutputCP ?? 62;
  return {
    update(system) {
      system.ownControlPoint(target).position.set(0, 0, 0);
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
// A control point's speed into another's value (a trail shown only when a weapon swings fast)
DEFS.C_OP_RemapSpeedtoCP = (def) => {
  const input = def.m_nInControlPointNumber ?? 0;
  const output = def.m_nOutControlPointNumber ?? -1;
  const component = def.m_nField ?? 0;
  const [inMin, inMax, outMin, outMax] = [def.m_flInputMin ?? 0, def.m_flInputMax ?? 1, def.m_flOutputMin ?? 0, def.m_flOutputMax ?? 1];
  return {
    update(system) {
      if (output < 0) return;
      const value = remap(system.controlPoint(input).speed ?? 0, inMin, inMax, outMin, outMax);
      system.ownControlPoint(output).value.setComponent(component, value);
    },
  };
};

// A component of a control point's value into a field, through a range: only a value something
// in the effect sets (the game's code sets the others, and they are nothing here)
DEFS.C_OP_RemapCPtoScalar = (def) => {
  const input = def.m_nCPInput ?? 0;
  const component = def.m_nField ?? 0;
  const field = def.m_nFieldOutput ?? 3;
  const [inMin, inMax, outMin, outMax] = [def.m_flInputMin ?? 0, def.m_flInputMax ?? 1, def.m_flOutputMin ?? 0, def.m_flOutputMax ?? 1];
  const set = setter(def);
  return {
    update(system) {
      const point = system.controlPoint(input);
      if (!point.set) return;
      const value = remap(point.value.getComponent(component), inMin, inMax, outMin, outMax);
      const data = system.float(field);
      const initial = system.initialFloat(field);
      for (let i = 0; i < system.count; i++) {
        if (VECTOR_FIELDS.has(field)) writeFloat(system, field, i, value);
        else data[i] = set(data[i], initial[i], value);
      }
    },
  };
};
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

// An operator's fade in and out over the system's time (m_flOpStartFadeInTime … EndFadeOutTime,
// ~800 operators), as particles.dll does (0x18003f9b0, its time 0x18003f870): the time is the
// system's age, from its end with m_bNormalizeToStopTime on an end-cap operator, moved by a
// random offset and scaled by a random rate only where their seeds are set, and made a phase of
// 0 to 1 by m_flOpFadeOscillatePeriod; nothing before the fade in starts or (where given) after
// the fade out ends, else a ramp up from the start to the end of the fade in and down from the
// start to the end of the fade out. An operator at nothing does nothing (Broodmother's page web:
// its AlphaDecay, on from 0.25 s, killed the web while it faded in from nothing)
function fadeFilter(def, instance) {
  const start = def.m_flOpStartFadeInTime ?? 0;
  const endIn = def.m_flOpEndFadeInTime ?? 0;
  const startOut = def.m_flOpStartFadeOutTime ?? 0;
  const endOut = def.m_flOpEndFadeOutTime ?? 0;
  const period = def.m_flOpFadeOscillatePeriod ?? 0;
  const offsetSeed = def.m_nOpTimeOffsetSeed ?? 0;
  const scaleSeed = def.m_nOpTimeScaleSeed ?? 0;
  if (!start && !endIn && !startOut && !endOut && !period && !offsetSeed && !scaleSeed) return instance;
  const offset = offsetSeed ? lerp(def.m_flOpTimeOffsetMin ?? 0, def.m_flOpTimeOffsetMax ?? 0, Math.random()) : 0;
  const scale = scaleSeed ? 1 / Math.max(1e-4, lerp(def.m_flOpTimeScaleMin ?? 1, def.m_flOpTimeScaleMax ?? 1, Math.random())) : 1;
  const fromEnd = Boolean(def.m_bNormalizeToStopTime) && def.m_nOpEndCapState === "PARTICLE_ENDCAP_ENDCAP_ON";
  const fadeIn = Math.max(endIn, start);
  const fadeOut = Math.max(startOut, fadeIn);
  const fadeOutEnd = Math.max(endOut, fadeOut);
  const strength = (system) => {
    let t = fromEnd ? system.endcapAge : system.age;
    if (offsetSeed) t = Math.max(0, t + offset);
    if (scaleSeed && t > start) t = (t - start) * scale + start;
    if (period > 0) t = ((t / period) % 1 + 1) % 1;
    if (start > t || (endOut > 0 && t > endOut)) return 0;
    let value = 1;
    if (fadeIn > t && fadeIn > start) value = Math.min(value, (t - start) / (fadeIn - start));
    if (t > fadeOut && fadeOutEnd > fadeOut) value = Math.min(value, (t - fadeOutEnd) / (fadeOut - fadeOutEnd));
    return value;
  };
  for (const method of ["init", "update", "force", "emit"]) {
    const original = instance[method];
    if (original) instance[method] = (system, a, b) => strength(system) > 0 && original.call(instance, system, a, b);
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

// The game gives rotations, their speed, yaw and pitch in degrees wherever an operator writes
// a range to them, and keeps them in radians: the range turned to radians
const ANGLE_FIELDS = new Set([4, 5, 12, 20]);
const ANGLE_KEYS = ["m_flOutputMin", "m_flOutputMax", "m_flOutput", "m_flOutputMin2", "m_flOutputMax2"];
function anglesToRadians(def) {
  if (!ANGLE_FIELDS.has(Number(def.m_nFieldOutput))) return def;
  // The noises' range when the file leaves it out: 0 to 1, of degrees here
  if (/Noise$/.test(def._class) && def.m_flOutputMax === undefined) def.m_flOutputMax = 1;
  for (const key of ANGLE_KEYS) {
    if (typeof def[key] === "number") def[key] *= deg;
  }
  return def;
}

export function createOperator(def, kind, system) {
  def = anglesToRadians(flatten(def));
  const name = def._class;
  const make = kind === "renderer" ? RENDERERS[name] : DEFS[name];
  if (!make) {
    unsupported.set(name, (unsupported.get(name) ?? 0) + 1);
    return null;
  }
  try {
    return fadeFilter(def, strengthFilter(def, endCapFilter(def, make(def, system))));
  } catch (error) {
    console.warn(`[particles] ${name}: ${error.message}`);
    return null;
  }
}
