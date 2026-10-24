// What of the game's particle effects the viewer does not do yet, measured over every system the
// heroes' and items' effects use (the dataset's bundles, each system counted once):
//   - operator classes it has no code for, or only a stub that does nothing
//   - parameters the files give that its code never reads, by class
//   - kinds of input values (PF_TYPE_*, PVEC_TYPE_*, PF_MAP_TYPE_*) it does not know
//   - against the engine's schema (particles/schema.json): its classes the site has no code for,
//     and the operators its defaults do not reach (files older than the class, or of a class the
//     engine no longer has)
// What the viewer knows is read from the text of src/viewer/particles, so nothing is imported.
// The bundles are kept in node_modules/.cache/particle-bundles and fetched again only when changed.
//   npm run particles:coverage [-- --top 40] [-- --json out.json] [-- --schema schema.json]
import fs from "fs";
import path from "path";
import { DATASETS, datasetBase, datasetId } from "../src/datasets.js";

const DATASET = datasetId(DATASETS.particles);
const BASE = datasetBase(DATASETS.particles);
const CACHE = path.resolve("node_modules/.cache/particle-bundles");
const SOURCE = path.resolve("src/viewer/particles");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const TOP = Number(arg("--top", 30));

// ------------------------------------------------------------------ what the viewer knows

const source = fs
  .readdirSync(SOURCE)
  .filter((file) => file.endsWith(".js"))
  .map((file) => fs.readFileSync(path.join(SOURCE, file), "utf8"))
  .join("\n");
const handled = new Set([...source.matchAll(/DEFS\.(C_\w+)\s*=/g)].map((match) => match[1]));
for (const match of source.matchAll(/^\s*(C_OP_Render\w+):/gm)) handled.add(match[1]);
const stubs = new Set([...source.matchAll(/DEFS\.(C_\w+)\s*=\s*(?:nothing|\(\)\s*=>\s*\(\{\}\));/g)].map((match) => match[1]));
const knownKeys = new Set(source.match(/\bm_\w+/g));
const knownTypes = new Set(source.match(/\b(?:PF_TYPE|PVEC_TYPE|PF_MAP_TYPE)_\w+/g));
// What the inputs do without naming it
knownTypes.add("PF_MAP_TYPE_DIRECT");

// ------------------------------------------------------------------ the bundles

async function listBundles() {
  const files = [];
  let url = `https://huggingface.co/api/datasets/${DATASET}/tree/main/particles/bundles?recursive=true&expand=false`;
  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Listing the bundles failed (HTTP ${res.status})`);
    for (const entry of await res.json()) if (entry.type === "file") files.push({ path: entry.path, oid: entry.oid });
    url = res.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
  }
  return files;
}

async function loadBundles() {
  fs.mkdirSync(CACHE, { recursive: true });
  const indexFile = path.join(CACHE, "index.json");
  const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, "utf8")) : {};
  const files = await listBundles();
  const todo = files.filter((file) => index[file.path] !== file.oid || !fs.existsSync(path.join(CACHE, file.path)));
  console.log(`${files.length} bundles, ${todo.length} to fetch`);
  for (let i = 0; i < todo.length; i += 16) {
    await Promise.all(
      todo.slice(i, i + 16).map(async (file) => {
        const res = await fetch(BASE + file.path);
        if (!res.ok) return;
        const target = path.join(CACHE, file.path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
        index[file.path] = file.oid;
      })
    );
    if (i % 400 === 0) process.stdout.write(`\r  ${Math.min(i + 16, todo.length)}/${todo.length}`);
  }
  if (todo.length) process.stdout.write("\n");
  fs.writeFileSync(indexFile, JSON.stringify(index));
  // Every system once, by its path
  const systems = new Map();
  for (const file of files) {
    const target = path.join(CACHE, file.path);
    if (!fs.existsSync(target)) continue;
    for (const [name, def] of Object.entries(JSON.parse(fs.readFileSync(target, "utf8")))) {
      if (def && !systems.has(name.toLowerCase())) systems.set(name.toLowerCase(), def);
    }
  }
  return systems;
}

// ------------------------------------------------------------------ counting

const GROUPS = ["m_PreEmissionOperators", "m_Emitters", "m_Initializers", "m_ForceGenerators", "m_Operators", "m_Constraints", "m_Renderers"];
// Kept by the editor or the game's bookkeeping only (not how anything looks), or read by name
// through a shared helper of every operator
const IGNORED = new Set([
  "_class",
  "m_bDisableOperator",
  "m_Notes",
  "m_nOpEndCapState",
  "m_flOpStrength",
  "m_nBehaviorVersion",
  "m_controlPointConfigurations",
  "m_bShouldHitboxesFallbackToRenderBounds",
  "m_nFirstMultipleOverride_BackwardCompat",
  "m_flNoDrawTimeToGoToSleep",
  "m_BoundingBoxMin",
  "m_BoundingBoxMax",
  "m_nLOD",
  "m_flCullRadius",
  "m_nCullControlPoint",
  "m_flPreSimulationTime",
]);
// A value that only says "off" (what the game does when the file leaves the parameter out)
const isOff = (value) => value === false || value === 0 || value === "" || value === null || (Array.isArray(value) && !value.length);
const isInput = (value) => value && typeof value === "object" && !Array.isArray(value) && /^(PF|PVEC)_TYPE_/.test(value.m_nType ?? "");

const classes = new Map(); // class -> systems
const keys = new Map(); // "class key" -> { systems, values: Map(value -> systems) }
const types = new Map(); // type -> systems

function countOnce(map, key, seen) {
  if (seen.has(key)) return;
  seen.add(key);
  map.set(key, (map.get(key) ?? 0) + 1);
}

function countKey(owner, key, value, seen) {
  if (isOff(value)) return;
  const id = `${owner} ${key}`;
  if (seen.has(`k:${id}`)) return;
  seen.add(`k:${id}`);
  const entry = keys.get(id) ?? { systems: 0, values: new Map() };
  entry.systems++;
  const shown = isInput(value) ? value.m_nType : JSON.stringify(value).slice(0, 60);
  entry.values.set(shown, (entry.values.get(shown) ?? 0) + 1);
  keys.set(id, entry);
}

// Input values anywhere below, by their kind
function countTypes(value, seen) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) return value.forEach((item) => countTypes(item, seen));
  if (isInput(value)) {
    countOnce(types, value.m_nType, seen);
    if (value.m_nMapType) countOnce(types, value.m_nMapType, seen);
  }
  Object.values(value).forEach((item) => countTypes(item, seen));
}

function countParams(owner, params, seen) {
  for (const [key, value] of Object.entries(params)) {
    if (IGNORED.has(key)) continue;
    // A structure without a name of its own (VisibilityInputs) only counts by what is in it
    if (/^m_/.test(key)) countKey(owner, key, value, seen);
    // One level into structures that are not inputs (a transform input, texture layers)
    const nested = Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) : value && typeof value === "object" && !isInput(value) ? [value] : [];
    for (const item of nested) {
      for (const [inner, innerValue] of Object.entries(item)) {
        if (!IGNORED.has(inner) && /^m_/.test(inner)) countKey(owner, `${key}.${inner}`, innerValue, seen);
      }
    }
  }
}

// The engine's classes, from the dataset or a file (--schema); null when there is none
async function loadSchema() {
  const file = arg("--schema");
  if (file) return JSON.parse(fs.readFileSync(file, "utf8"));
  const res = await fetch(`${BASE}particles/schema.json`).catch(() => null);
  return res?.ok ? res.json() : null;
}
const fieldsOf = (schema, name) => {
  const fields = new Set();
  for (let c = schema.classes[name]; c; c = schema.classes[c.base]) Object.keys(c.fields).forEach((field) => fields.add(field));
  return fields;
};

const schema = await loadSchema();
const older = new Map(); // class -> systems with an operator of it older than the class's fields
const systems = await loadBundles();
for (const def of systems.values()) {
  const seen = new Set();
  const top = {};
  for (const [key, value] of Object.entries(def)) if (!GROUPS.includes(key) && key !== "m_Children" && !key.startsWith("__")) top[key] = value;
  countParams("(system)", top, seen);
  for (const group of GROUPS) {
    for (const op of def[group] ?? []) {
      if (!op?._class || op.m_bDisableOperator) continue;
      countOnce(classes, op._class, seen);
      countParams(op._class, op, seen);
      if (schema?.classes[op._class]) {
        const fields = fieldsOf(schema, op._class);
        if (Object.keys(op).some((key) => key !== "_class" && !fields.has(key)) && !seen.has(`older:${op._class}`)) {
          seen.add(`older:${op._class}`);
          older.set(op._class, (older.get(op._class) ?? 0) + 1);
        }
      }
    }
  }
  countTypes(def, seen);
}

// ------------------------------------------------------------------ the report

const total = systems.size;
const share = (n) => `${String(n).padStart(6)} ${((n / total) * 100).toFixed(1).padStart(5)}%`;
const lines = [];
const print = (line = "") => lines.push(line);

const missing = [...classes].filter(([name]) => !handled.has(name) || stubs.has(name)).sort((a, b) => b[1] - a[1]);
const usedHandled = [...classes].filter(([name]) => handled.has(name) && !stubs.has(name));
print(`${total} systems, ${classes.size} operator classes; ${usedHandled.length} done, ${missing.length} missing or stubs`);
print();
print(`Operator classes not done (systems using them):`);
for (const [name, count] of missing.slice(0, TOP)) print(`${share(count)}  ${name}${stubs.has(name) ? "  (stub)" : ""}`);

// Parameters of done classes (and of systems) the code never names
const unread = [...keys]
  .filter(([id]) => {
    const [owner, key] = id.split(" ");
    const name = key.split(".").pop();
    return (owner === "(system)" || (handled.has(owner) && !stubs.has(owner))) && !knownKeys.has(name);
  })
  .sort((a, b) => b[1].systems - a[1].systems);
print();
print(`Parameters the files give that the code never reads (systems; most common values):`);
for (const [id, entry] of unread.slice(0, TOP)) {
  const values = [...entry.values].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([value, n]) => `${value} ×${n}`).join(", ");
  print(`${share(entry.systems)}  ${id}   ${values}`);
}

const unknownTypes = [...types].filter(([type]) => !knownTypes.has(type)).sort((a, b) => b[1] - a[1]);
print();
print(`Kinds of input values the inputs do not know (systems):`);
for (const [type, count] of unknownTypes.slice(0, TOP)) print(`${share(count)}  ${type}`);

if (schema) {
  const engine = Object.keys(schema.classes).filter((name) => /^C_(OP|INIT)_/.test(name));
  const unused = engine.filter((name) => !classes.has(name));
  const notInEngine = [...classes].filter(([name]) => !schema.classes[name]).sort((a, b) => b[1] - a[1]);
  print();
  print(`Engine schema (build ${schema.source?.build ?? "?"}): ${engine.length} operator classes, ${engine.filter((name) => handled.has(name) && !stubs.has(name)).length} done here, ${unused.length} used by no file here`);
  print(`Classes the files use that the engine no longer has (no defaults for them; systems):`);
  for (const [name, count] of notInEngine.slice(0, TOP)) print(`${share(count)}  ${name}`);
  print(`Classes with operators older than the engine's fields (no defaults for those; systems):`);
  for (const [name, count] of [...older].sort((a, b) => b[1] - a[1]).slice(0, TOP)) print(`${share(count)}  ${name}`);
}

console.log(lines.join("\n"));
const out = arg("--json");
if (out) {
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        systems: total,
        classes: Object.fromEntries(missing.map(([name, count]) => [name, { systems: count, stub: stubs.has(name) }])),
        parameters: Object.fromEntries(unread.map(([id, entry]) => [id, { systems: entry.systems, values: Object.fromEntries(entry.values) }])),
        inputs: Object.fromEntries(unknownTypes),
      },
      null,
      1
    )
  );
  console.log(`Written to ${out}`);
}
