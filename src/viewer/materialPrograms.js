// Material parameters the game works out every frame (a .vmat's DynamicParams: a detail texture
// scrolling, a glow pulsing), from the dataset's materials/dynamic.json:
//   { "materials/....vmat": { "g_vDetailTexCoordOffset": [0.055, 0, "float2", "time", "*", "frac"] } }
// Each a program for a small stack machine: numbers are pushed, operators and functions take
// their values off the top of the stack, "set N" takes one off into local N, "get N" pushes it
// back. Values are vectors of 1 to 4 numbers; a single number goes with every component.

let table = null;
let loading = null;

// Fetched once, from the dataset root (the part of a model's url before "models/")
export function loadMaterialPrograms(root) {
  loading ??= fetch(`${root}materials/dynamic.json`)
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}))
    .then((json) => {
      table = json;
    });
  return loading;
}

// { param: program } of a material by its vmat path, or null
export function materialPrograms(name) {
  return (name && table?.[name.toLowerCase()]) || null;
}

const zip = (a, b, f) => {
  const length = Math.max(a.length, b.length);
  const out = new Array(length);
  for (let i = 0; i < length; i++) out[i] = f(a[a.length === 1 ? 0 : i] ?? 0, b[b.length === 1 ? 0 : i] ?? 0);
  return out;
};
const each = (f) => (a) => a.map(f);
const frac = (x) => x - Math.floor(x);
const dot = (n) => (a, b) => {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += (a[a.length === 1 ? 0 : i] ?? 0) * (b[b.length === 1 ? 0 : i] ?? 0);
  return [sum];
};
const length = (a) => Math.hypot(...a);

// Name: [arguments, function of them]
const FUNCTIONS = {
  sin: [1, each(Math.sin)],
  cos: [1, each(Math.cos)],
  tan: [1, each(Math.tan)],
  frac: [1, each(frac)],
  floor: [1, each(Math.floor)],
  ceil: [1, each(Math.ceil)],
  saturate: [1, each((x) => Math.min(Math.max(x, 0), 1))],
  abs: [1, each(Math.abs)],
  sign: [1, each(Math.sign)],
  sqrt: [1, each(Math.sqrt)],
  rsqrt: [1, each((x) => 1 / Math.sqrt(x))],
  sqr: [1, each((x) => x * x)],
  log: [1, each(Math.log)],
  log2: [1, each(Math.log2)],
  log10: [1, each(Math.log10)],
  exp: [1, each(Math.exp)],
  exp2: [1, each((x) => 2 ** x)],
  SrgbLinearToGamma: [1, each((x) => (x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055))],
  SrgbGammaToLinear: [1, each((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))],
  length: [1, (a) => [length(a)]],
  normalize: [1, (a) => a.map((x) => x / (length(a) || 1))],
  pow: [2, (a, b) => zip(a, b, Math.pow)],
  min: [2, (a, b) => zip(a, b, Math.min)],
  max: [2, (a, b) => zip(a, b, Math.max)],
  step: [2, (a, b) => zip(a, b, (edge, x) => (x >= edge ? 1 : 0))],
  dot2: [2, dot(2)],
  dot3: [2, dot(3)],
  dot4: [2, dot(4)],
  clamp: [3, (x, lo, hi) => zip(zip(x, lo, Math.max), hi, Math.min)],
  lerp: [3, (a, b, t) => zip(zip(a, b, (x, y) => y - x), t, (d, s) => d * s).map((d, i) => (a[a.length === 1 ? 0 : i] ?? 0) + d)],
  smoothstep: [3, (lo, hi, x) => zip(zip(x, lo, (v, l) => v - l), zip(hi, lo, (h, l) => h - l), (v, r) => {
    const t = Math.min(Math.max(r ? v / r : 0, 0), 1);
    return t * t * (3 - 2 * t);
  })],
  float2: [2, (...args) => args.flat().slice(0, 2)],
  float3: [3, (...args) => args.flat().slice(0, 3)],
  float4: [4, (...args) => args.flat().slice(0, 4)],
  random: [2, (lo, hi) => zip(lo, hi, (l, h) => l + Math.random() * (h - l))],
};

const OPERATORS = {
  "+": (a, b) => a + b,
  "-": (a, b) => a - b,
  "*": (a, b) => a * b,
  "/": (a, b) => (b ? a / b : 0),
  "%": (a, b) => (b ? a % b : 0),
  "==": (a, b) => Number(a === b),
  "!=": (a, b) => Number(a !== b),
  ">": (a, b) => Number(a > b),
  ">=": (a, b) => Number(a >= b),
  "<": (a, b) => Number(a < b),
  "<=": (a, b) => Number(a <= b),
};

// The program's value at time t, or null for a program this does not know
export function runProgram(program, t) {
  const stack = [];
  const locals = [];
  for (const step of program) {
    if (typeof step === "number") {
      stack.push([step]);
    } else if (step === "time") {
      stack.push([t]);
    } else if (step === "neg") {
      stack.push(stack.pop().map((x) => -x));
    } else if (step === "!") {
      stack.push(stack.pop().map((x) => Number(!x)));
    } else if (OPERATORS[step]) {
      const b = stack.pop();
      const a = stack.pop();
      if (!a || !b) return null;
      stack.push(zip(a, b, OPERATORS[step]));
    } else if (step.startsWith("set ")) {
      locals[Number(step.slice(4))] = stack.pop();
    } else if (step.startsWith("get ")) {
      stack.push(locals[Number(step.slice(4))] ?? [0]);
    } else if (FUNCTIONS[step]) {
      const [count, f] = FUNCTIONS[step];
      if (stack.length < count) return null;
      stack.push(f(...stack.splice(stack.length - count, count)));
    } else {
      return null;
    }
  }
  const value = stack.pop();
  return value?.every(Number.isFinite) ? value : null;
}
