// ?perf: where the time goes, printed to the console and kept: Shift+Space copies it all. Opening a model prints its stages (files,
// materials, shaders, ...), and every 2 seconds the frame: frames per second, the main thread's
// time in each part of a frame, the GPU's in each pass (EXT_disjoint_timer_query_webgl2, where
// the browser has it), and the draw calls and triangles. Off, every call here does nothing.

// On for the rest of the tab once a page was opened with it (the site rewrites its address as
// heroes and outfits change); ?perf=off turns it off
function readPerfOn() {
  if (typeof window === "undefined") return false;
  const value = new URLSearchParams(window.location.search).get("perf");
  try {
    if (value === "off") sessionStorage.removeItem("perf");
    else if (value !== null) sessionStorage.setItem("perf", "1");
    return sessionStorage.getItem("perf") === "1";
  } catch {
    return value !== null && value !== "off";
  }
}
export const perfOn = readPerfOn();

const REPORT_MS = 2000;
// What was printed, for Shift+Space to copy
const printed = [];
const KEPT_LINES = 400;

function log(text) {
  console.log(text);
  printed.push(text);
  if (printed.length > KEPT_LINES) printed.splice(0, printed.length - KEPT_LINES);
}

if (perfOn) {
  window.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || !event.shiftKey) return;
    // Before the page's own keys (typing a hero's name takes a space too)
    event.preventDefault();
    event.stopImmediatePropagation();
    const text = [navigator.userAgent, `screen ${screen.width}x${screen.height} at ${devicePixelRatio}x`, ...printed].join("\n");
    navigator.clipboard.writeText(text).then(
      () => console.log(`[perf] copied ${printed.length} entries`),
      (error) => console.error("[perf] copying failed", error)
    );
  }, true);
  // Stalls anywhere on the page, not only in the stage's frames: the browser's long animation
  // frames (Chrome) with the scripts that took the time
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < LONG_FRAME_MS) continue;
        const scripts = (entry.scripts ?? [])
          .filter((script) => script.duration >= 5)
          .sort((a, b) => b.duration - a.duration)
          .slice(0, 5)
          .map((script) => `${Math.round(script.duration)} ms ${script.invoker || script.invokerType} ${script.sourceFunctionName || ""} ${(script.sourceURL || "").split("/").pop()}:${script.sourceCharPosition ?? ""}`);
        const rendering = entry.renderStart ? entry.startTime + entry.duration - entry.renderStart : 0;
        const head = `[perf] long browser frame ${Math.round(entry.duration)} ms (blocking ${Math.round(entry.blockingDuration ?? 0)}, rendering ${Math.round(rendering)})`;
        log([head, ...scripts.map((script) => `    ${script}`)].join("\n"));
      }
    }).observe({ type: "long-animation-frame", buffered: true });
  } catch {
    log("[perf] this browser does not report long animation frames");
  }
}
const sums = new Map();
// This frame's parts, for a long frame's own line
const parts = new Map();
// A frame longer than this prints what it spent its time on
const LONG_FRAME_MS = 50;
let frames = 0;
let frameStarted = 0;
let programsBefore = new Set();
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
let announced = false;
export function frameStart(renderer) {
  if (!perfOn) return;
  if (!announced) {
    announced = true;
    gl ??= renderer.getContext();
    timer ??= gl.getExtension("EXT_disjoint_timer_query_webgl2") ?? false;
    log(`[perf] on, the GPU's times: ${timer ? "yes" : "no (this browser has no timer query)"}`);
  }
  renderer.info.autoReset = false;
  renderer.info.reset();
  parts.clear();
  programsBefore = new Set(renderer.info.programs ?? []);
  frameStarted = performance.now();
}

// At the end of a frame; prints the report every 2 seconds
let failed = false;
export function frameEnd(renderer) {
  if (!perfOn || failed) return;
  try {
    report(renderer);
  } catch (error) {
    failed = true;
    console.error("[perf] the frame report failed", error);
  }
}

function report(renderer) {
  frames++;
  add("cpu: whole frame", frameStarted);
  const whole = parts.get("cpu: whole frame");
  if (whole > LONG_FRAME_MS) {
    // The draw includes compiling shaders first used and uploading new textures
    const named = [...parts].filter(([name]) => name !== "cpu: whole frame").map(([name, ms]) => `${name.replace("cpu: ", "")} ${Math.round(ms)}`);
    // The programs made in this frame, by their materials' names and kinds
    const made = (renderer.info.programs ?? []).filter((program) => !programsBefore.has(program));
    const kinds = new Map();
    // A material's name, else the kind of three.js shader (depth, basic, ...) or "custom"
    const nameOf = (program) => program.name || (/^[a-z]+$/.test(program.cacheKey?.split(",")[0] ?? "") ? program.cacheKey.split(",")[0] : "custom");
    for (const program of made) kinds.set(nameOf(program), (kinds.get(nameOf(program)) ?? 0) + 1);
    const list = [...kinds].map(([name, count]) => `${name || "unnamed"}${count > 1 ? ` x${count}` : ""}`).join(", ");
    // How each new program's key differs from the nearest one made before (same shader, as many
    // parts), by the part's place counted from the end, where three.js puts its parameters
    const keyDiffs = made.slice(0, 6).map((program) => {
      const key = program.cacheKey.split(",");
      const near = [...programsBefore]
        .map((other) => other.cacheKey.split(","))
        .filter((other) => other[0] === key[0])
        // Lined up from the end, where the parameters are
        .map((other) => ({ other, diff: key.map((part, i) => (part === other[other.length - key.length + i] ? null : `[-${key.length - i}] ${other[other.length - key.length + i]} -> ${part}`)).filter(Boolean) }))
        .sort((p, q) => p.diff.length - q.diff.length)[0];
      return `    ${nameOf(program)}: ${near ? near.diff.join("; ") || "same key" : "no program like it before"}`;
    });
    const other = Math.round(whole - [...parts].reduce((sum, [name, ms]) => (name === "cpu: whole frame" ? sum : sum + ms), 0));
    log([`[perf] long frame ${Math.round(whole)} ms${made.length ? ` (${made.length} new shader programs: ${list})` : ""}: ${named.join(", ")}, other ${other}`, ...keyDiffs].join("\n"));
  }
  if (timer) collectQueries();
  const elapsed = performance.now() - since;
  if (elapsed < REPORT_MS) return;
  const table = { "frames per second": Math.round((frames * 1000) / elapsed) };
  for (const [name, total] of [...sums].sort(([a], [b]) => a.localeCompare(b))) {
    table[`${name} (ms)`] = Number((total / frames).toFixed(2));
  }
  if (timer === false) table["gpu"] = "no timer query in this browser";
  table["draw calls"] = renderer.info.render.calls;
  table["triangles"] = renderer.info.render.triangles;
  table["textures"] = renderer.info.memory.textures;
  table["geometries"] = renderer.info.memory.geometries;
  table["shader programs"] = renderer.info.programs?.length ?? 0;
  table["pixels drawn"] = `${renderer.domElement.width}x${renderer.domElement.height}`;
  // As text, to copy from the console as it is
  log(["[perf] frame", ...Object.entries(table).map(([name, value]) => `  ${name}: ${value}`)].join("\n"));
  sums.clear();
  frames = 0;
  since = performance.now();
}

// A change that makes every material compile again (lights, shadows), with when it came
export function note(text, renderer = null) {
  if (!perfOn) return;
  let programs = "";
  if (renderer) {
    const kinds = new Map();
    for (const program of renderer.info.programs ?? []) {
      const kind = program.name || program.cacheKey.split(",")[0];
      const short = /^[a-z]+$/.test(kind) ? kind : program.name ? kind : "custom";
      kinds.set(short, (kinds.get(short) ?? 0) + 1);
    }
    programs = ` (shader programs: ${[...kinds].map(([name, count]) => `${name} ${count}`).join(", ")})`;
  }
  log(`[perf] ${text} at ${Math.round(performance.now())} ms${programs}`);
}

// The stages of opening a model, one a line: [[name, ms], ...]
export function stages(title, list) {
  if (!perfOn) return;
  log([`[perf] ${title}`, ...list.map(([name, ms]) => `  ${name}: ${Math.round(ms)} ms`)].join("\n"));
}
