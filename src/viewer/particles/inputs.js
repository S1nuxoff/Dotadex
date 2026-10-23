// The particle editor's inputs: a number, or a value made from randomness, the system's or a
// particle's age, a control point, a particle's field or noise, then mapped directly, scaled,
// remapped or through a curve. Each is compiled once into a function of (system, particle).
import { bias, clamp, evaluateCurve, lerp, noise, remap } from "./math.js";

// A random number fixed for a particle and an input, so a "constant" random input keeps its
// value when an operator reads it every frame
let nextSeed = 1;
const hashed = (id, seed) => {
  let h = (id * 374761393 + seed * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function source(def) {
  const seed = nextSeed++;
  const randomOf = (system, index) =>
    def.m_nRandomMode === "PF_RANDOM_MODE_VARYING" || index < 0 ? Math.random() : hashed(system.ids[index], seed);
  switch (def.m_nType) {
    // A value the system names (m_NamedValueLocals), as its parent hands it down
    case "PF_TYPE_NAMED_VALUE": {
      const fallback = def.m_flLiteralValue ?? 0;
      return (system) => system.namedValue?.(def.m_NamedValue) ?? fallback;
    }
    case "PF_TYPE_LITERAL":
    case undefined:
      return () => def.m_flLiteralValue ?? 0;
    case "PF_TYPE_RANDOM_UNIFORM": {
      const min = def.m_flRandomMin ?? 0;
      const max = def.m_flRandomMax ?? 1;
      return (system, index) => lerp(min, max, randomOf(system, index));
    }
    case "PF_TYPE_RANDOM_BIASED": {
      const min = def.m_flRandomMin ?? 0;
      const max = def.m_flRandomMax ?? 1;
      const amount = def.m_flBiasParameter ?? 0.5;
      const exponential = def.m_nBiasType === "PF_BIAS_TYPE_EXPONENTIAL";
      return (system, index) => {
        const t = randomOf(system, index);
        return lerp(min, max, exponential ? Math.pow(t, amount > 0 ? 1 / amount : 1) : bias(t, amount));
      };
    }
    case "PF_TYPE_COLLECTION_AGE":
      return (system) => system.age;
    case "PF_TYPE_ENDCAP_AGE":
      return (system) => system.endcapAge;
    case "PF_TYPE_PARTICLE_AGE":
      return (system, index) => (index < 0 ? 0 : system.age - system.float(8)[index]);
    case "PF_TYPE_PARTICLE_AGE_NORMALIZED":
      return (system, index) => (index < 0 ? 0 : system.normalizedAge(index));
    case "PF_TYPE_PARTICLE_NUMBER":
      return (system, index) => (index < 0 ? 0 : system.ids[index]);
    case "PF_TYPE_PARTICLE_NUMBER_NORMALIZED":
      return (system, index) => {
        if (index < 0) return 0;
        const max = system.numberRange();
        return (system.ids[index] % max) / Math.max(max - 1, 1);
      };
    case "PF_TYPE_CONTROL_POINT_COMPONENT": {
      const point = def.m_nControlPoint ?? 0;
      const component = def.m_nVectorComponent ?? 0;
      return (system) => system.controlPoint(point).value.getComponent(component);
    }
    case "PF_TYPE_CONTROL_POINT_SPEED": {
      const point = def.m_nControlPoint ?? 0;
      return (system) => system.controlPoint(point).speed;
    }
    case "PF_TYPE_PARTICLE_FLOAT": {
      const field = def.m_nScalarAttribute ?? 3;
      return (system, index) => (index < 0 ? 0 : system.float(field)[index]);
    }
    case "PF_TYPE_PARTICLE_INITIAL_FLOAT": {
      const field = def.m_nScalarAttribute ?? 3;
      return (system, index) => (index < 0 ? 0 : system.initialFloat(field)[index]);
    }
    case "PF_TYPE_PARTICLE_VECTOR_COMPONENT": {
      const field = def.m_nVectorAttribute ?? 6;
      const component = def.m_nVectorComponent ?? 0;
      return (system, index) => (index < 0 ? 0 : system.vector(field)[index * 3 + component]);
    }
    case "PF_TYPE_PARTICLE_SPEED":
      return (system, index) => (index < 0 ? 0 : system.speed(index));
    case "PF_TYPE_PARTICLE_NOISE": {
      const scale = def.m_flNoiseScale ?? 0.1;
      const out0 = def.m_flNoiseOutputMin ?? 0;
      const out1 = def.m_flNoiseOutputMax ?? 1;
      const rate = Array.isArray(def.m_vecNoiseOffsetRate) ? def.m_vecNoiseOffsetRate : [0, 0, 0];
      return (system, index) => {
        // The system's own value (an emission rate): the noise where control point 0 is, drifting
        // with time as the offset rate says
        if (index < 0) {
          const cp = system.controlPoint(0).position;
          const t = system.age;
          const n = noise((cp.x + rate[0] * t) * scale, (cp.y + rate[1] * t) * scale, (cp.z + rate[2] * t) * scale + t * 0.5);
          return lerp(out0, out1, n * 0.5 + 0.5);
        }
        const p = system.vector(0);
        const n = noise(p[index * 3] * scale, p[index * 3 + 1] * scale, p[index * 3 + 2] * scale + system.age * 0.5);
        return lerp(out0, out1, n * 0.5 + 0.5);
      };
    }
    default:
      return () => def.m_flLiteralValue ?? 0;
  }
}

export function compileFloat(def, fallback = 0) {
  if (def === undefined || def === null) {
    return () => fallback;
  }
  if (typeof def === "number") {
    return () => def;
  }
  if (typeof def !== "object") {
    return () => fallback;
  }
  // A literal is the value itself: a map type the editor left on it is not applied (the card
  // edges' glow has radius 24 and alpha 0.3 with a 0-1 curve left on, which would make both 0)
  if (def.m_nType === "PF_TYPE_LITERAL") {
    const literal = def.m_flLiteralValue ?? 0;
    return () => literal;
  }
  const read = source(def);
  const looped = def.m_nInputMode === "PF_INPUT_MODE_LOOPED";
  switch (def.m_nMapType) {
    case "PF_MAP_TYPE_MULT": {
      const factor = def.m_flMultFactor ?? 1;
      return (system, index) => read(system, index) * factor;
    }
    case "PF_MAP_TYPE_REMAP":
    case "PF_MAP_TYPE_REMAP_BIASED": {
      const in0 = def.m_flInput0 ?? 0;
      const in1 = def.m_flInput1 ?? 1;
      const out0 = def.m_flOutput0 ?? 0;
      const out1 = def.m_flOutput1 ?? 1;
      const amount = def.m_nMapType === "PF_MAP_TYPE_REMAP_BIASED" ? def.m_flRemapBias ?? 0.5 : 0.5;
      return (system, index) => {
        let t = in1 === in0 ? 0 : (read(system, index) - in0) / (in1 - in0);
        t = looped ? t - Math.floor(t) : clamp(t, 0, 1);
        return lerp(out0, out1, bias(t, amount));
      };
    }
    case "PF_MAP_TYPE_CURVE": {
      const curve = def.m_Curve;
      const points = curve?.m_spline ?? [];
      const x0 = points[0]?.x ?? 0;
      const x1 = points[points.length - 1]?.x ?? 1;
      return (system, index) => {
        let x = read(system, index);
        if (looped && x1 > x0) {
          x = x0 + ((((x - x0) % (x1 - x0)) + (x1 - x0)) % (x1 - x0));
        }
        return evaluateCurve(curve, x);
      };
    }
    default:
      return read;
  }
}

// Vector inputs, into a 3-array
export function compileVector(def, fallback = [0, 0, 0]) {
  if (Array.isArray(def)) {
    return (system, index, out) => ((out[0] = def[0]), (out[1] = def[1]), (out[2] = def[2]), out);
  }
  if (!def || typeof def !== "object") {
    return (system, index, out) => ((out[0] = fallback[0]), (out[1] = fallback[1]), (out[2] = fallback[2]), out);
  }
  const literal = def.m_vLiteralValue ?? fallback;
  switch (def.m_nType) {
    case "PVEC_TYPE_LITERAL_COLOR": {
      const c = def.m_LiteralColor ?? [255, 255, 255];
      return (system, index, out) => ((out[0] = c[0] / 255), (out[1] = c[1] / 255), (out[2] = c[2] / 255), out);
    }
    case "PVEC_TYPE_RANDOM_UNIFORM":
    case "PVEC_TYPE_RANDOM_UNIFORM_OFFSET": {
      const min = def.m_vRandomMin ?? [0, 0, 0];
      const max = def.m_vRandomMax ?? [0, 0, 0];
      const offset = def.m_nType === "PVEC_TYPE_RANDOM_UNIFORM_OFFSET" ? literal : [0, 0, 0];
      return (system, index, out) => {
        for (let k = 0; k < 3; k++) {
          out[k] = offset[k] + lerp(min[k], max[k], Math.random());
        }
        return out;
      };
    }
    case "PVEC_TYPE_CP_VALUE":
    case "PVEC_TYPE_CP_RELATIVE_POSITION": {
      const point = def.m_nControlPoint ?? 0;
      const scale = def.m_vCPValueScale ?? [1, 1, 1];
      return (system, index, out) => {
        const p = system.controlPoint(point).position;
        out[0] = p.x * scale[0];
        out[1] = p.y * scale[1];
        out[2] = p.z * scale[2];
        return out;
      };
    }
    case "PVEC_TYPE_FLOAT_COMPONENTS": {
      const x = compileFloat(def.m_FloatComponentX, 0);
      const y = compileFloat(def.m_FloatComponentY, 0);
      const z = compileFloat(def.m_FloatComponentZ, 0);
      return (system, index, out) => ((out[0] = x(system, index)), (out[1] = y(system, index)), (out[2] = z(system, index)), out);
    }
    case "PVEC_TYPE_FLOAT_INTERP_GRADIENT": {
      const t = compileFloat(def.m_FloatInterp, 0);
      const in0 = def.m_flInterpInput0 ?? 0;
      const in1 = def.m_flInterpInput1 ?? 1;
      const stops = (def.m_Gradient?.m_Stops ?? []).map((stop) => [stop.m_flPosition, stop.m_Color.map((c) => c / 255)]);
      return (system, index, out) => {
        const x = remap(t(system, index), in0, in1, 0, 1);
        if (!stops.length) {
          return ((out[0] = 1), (out[1] = 1), (out[2] = 1), out);
        }
        let i = 0;
        while (i < stops.length - 1 && stops[i + 1][0] < x) i++;
        const a = stops[i];
        const b = stops[Math.min(i + 1, stops.length - 1)];
        const f = b[0] > a[0] ? clamp((x - a[0]) / (b[0] - a[0]), 0, 1) : 0;
        for (let k = 0; k < 3; k++) out[k] = lerp(a[1][k], b[1][k], f);
        return out;
      };
    }
    case "PVEC_TYPE_FLOAT_INTERP_OPEN":
    case "PVEC_TYPE_FLOAT_INTERP_CLAMPED": {
      const t = compileFloat(def.m_FloatInterp, 0);
      const in0 = def.m_flInterpInput0 ?? 0;
      const in1 = def.m_flInterpInput1 ?? 1;
      const out0 = def.m_vInterpOutput0 ?? [0, 0, 0];
      const out1 = def.m_vInterpOutput1 ?? [1, 1, 1];
      const clamped = def.m_nType === "PVEC_TYPE_FLOAT_INTERP_CLAMPED";
      return (system, index, out) => {
        const f = remap(t(system, index), in0, in1, 0, 1, clamped);
        for (let k = 0; k < 3; k++) out[k] = lerp(out0[k], out1[k], f);
        return out;
      };
    }
    case "PVEC_TYPE_PARTICLE_VECTOR":
    case "PVEC_TYPE_PARTICLE_INITIAL_VECTOR": {
      const field = def.m_nVectorAttribute ?? 6;
      const scale = def.m_vVectorAttributeScale ?? [1, 1, 1];
      const initial = def.m_nType === "PVEC_TYPE_PARTICLE_INITIAL_VECTOR";
      return (system, index, out) => {
        const data = initial ? system.initialVector(field) : system.vector(field);
        for (let k = 0; k < 3; k++) out[k] = index < 0 ? 0 : data[index * 3 + k] * scale[k];
        return out;
      };
    }
    default:
      return (system, index, out) => ((out[0] = literal[0]), (out[1] = literal[1]), (out[2] = literal[2]), out);
  }
}
