// ?perf: where the time goes, printed to the console. Opening a model prints its stages (files,
// materials, shaders, ...), and every 2 seconds the frame: frames per second, the main thread's
// time in each part of a frame, the GPU's in each pass (EXT_disjoint_timer_query_webgl2, where
// the browser has it), and the draw calls and triangles. Off, every call here does nothing.

export const perfOn = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("perf");

const REPORT_MS = 2000;
const sums = new Map();
// This frame's parts, for a long frame's own line
const parts = new Map();
// A frame longer than this prints what it spent its time on
const LONG_FRAME_MS = 50;
let frames = 0;
let frameStarted = 0;
let since = performance.now();
let gl = null;
let timer;
const pendingQueries = [];

// A time to measure from, for add()
export const now = () => (perfOn ? performance.now() : 0);

// Adds the time since start to the part `name` of this report's frames
export function add(name, start) {
  if (!perfOn) return;
  const ms = performance.now() - start;
  sums.set(name, (sums.get(name) ?? 0) + ms);
  parts.set(name, (parts.get(name) ?? 0) + ms);
}

// The GPU's time for what is drawn between gpuBegin and gpuEnd (one at a time)
export function gpuBegin(renderer, name) {
  if (!perfOn) return null;
  gl ??= renderer.getContext();
  timer ??= gl.getExtension("EXT_disjoint_timer_query_webgl2") ?? false;
  if (!timer) return null;
  const query = gl.createQuery();
  gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
  return { query, name };
}

export function gpuEnd(handle) {
  if (!handle) return;
  gl.endQuery(timer.TIME_ELAPSED_EXT);
  pendingQueries.push(handle);
}

function collectQueries() {
  const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT);
  while (pendingQueries.length) {
    const { query, name } = pendingQueries[0];
    if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
    if (!disjoint) sums.set(`gpu: ${name}`, (sums.get(`gpu: ${name}`) ?? 0) + gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
    gl.deleteQuery(query);
    pendingQueries.shift();
  }
}

// At the start of a frame: the renderer counts draw calls over the whole frame, not per pass
export function frameStart(renderer) {
  if (!perfOn) return;
  renderer.info.autoReset = false;
  renderer.info.reset();
  parts.clear();
  frameStarted = performance.now();
}

// At the end of a frame; prints the report every 2 seconds
export function frameEnd(renderer) {
  if (!perfOn) return;
  frames++;
  add("cpu: whole frame", frameStarted);
  const whole = parts.get("cpu: whole frame");
  if (whole > LONG_FRAME_MS) {
    // The draw includes compiling shaders first used and uploading new textures
    const named = [...parts].filter(([name]) => name !== "cpu: whole frame").map(([name, ms]) => `${name.replace("cpu: ", "")} ${Math.round(ms)}`);
    console.log(`[perf] long frame ${Math.round(whole)} ms: ${named.join(", ")}, other ${Math.round(whole - [...parts].reduce((sum, [name, ms]) => (name === "cpu: whole frame" ? sum : sum + ms), 0))}`);
  }
  if (timer) collectQueries();
  const elapsed = performance.now() - since;
  if (elapsed < REPORT_MS) return;
  const report = { "frames per second": Math.round((frames * 1000) / elapsed) };
  for (const [name, total] of [...sums].sort(([a], [b]) => a.localeCompare(b))) {
    report[`${name} (ms)`] = Number((total / frames).toFixed(2));
  }
  if (timer === false) report["gpu"] = "no timer query in this browser";
  report["draw calls"] = renderer.info.render.calls;
  report["triangles"] = renderer.info.render.triangles;
  report["textures"] = renderer.info.memory.textures;
  report["geometries"] = renderer.info.memory.geometries;
  report["shader programs"] = renderer.info.programs?.length ?? 0;
  report["pixels drawn"] = `${renderer.domElement.width}x${renderer.domElement.height}`;
  // As text, to copy from the console as it is
  console.log(["[perf] frame", ...Object.entries(report).map(([name, value]) => `  ${name}: ${value}`)].join("\n"));
  sums.clear();
  frames = 0;
  since = performance.now();
}

// The stages of opening a model, one a line: [[name, ms], ...]
export function stages(title, list) {
  if (!perfOn) return;
  console.log([`[perf] ${title}`, ...list.map(([name, ms]) => `  ${name}: ${Math.round(ms)} ms`)].join("\n"));
}
