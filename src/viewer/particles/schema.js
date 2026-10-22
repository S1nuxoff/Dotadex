import { fetchData } from "../../fetchData.js";
// The engine's particle classes (particles/schema.json in the dataset, from its SchemaSystem): the
// defaults the game gives the fields a .vpcf leaves out. A file writes only what differs from
// them, and the game reads it over a class built with its defaults, nested objects (inputs,
// texture layers) key by key; withDefaults does the same to a system as it is loaded, so the
// operators read what the game reads.
//
// Files older than the class's current fields (a control point number where the class now has a
// transform input; ~3% of operators) or of a class the schema no longer has (~4%) are left as
// they are: the schema does not say how the game upgrades them, and the operators read both.

let loading = null;
let schema = null;
const done = new WeakSet();
const chains = new Map();
export const schemaStats = { filled: 0, older: 0, unknown: 0 };

// Loaded once; resolves with null when the dataset has none (the operators' own fallbacks then)
export function loadSchema(base) {
  loading ??= fetchData(`${base}particles/schema.json`)
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
    .then((json) => (schema = json));
  return loading;
}

// For tools that read the schema from a file
export function setSchema(json) {
  schema = json;
  chains.clear();
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const clone = (value) => (value !== null && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value);

// A class's fields with its bases', the class's own first: { field: { value, type } }
function chain(name) {
  if (!chains.has(name)) {
    let fields = null;
    for (let c = schema.classes[name]; c; c = schema.classes[c.base]) {
      fields ??= new Map();
      for (const [field, value] of Object.entries(c.fields)) {
        if (fields.has(field)) continue;
        const ref = c.refs?.[field];
        fields.set(field, { value: ref !== undefined ? schema.shared[ref] : value, type: c.types?.[field] });
      }
    }
    chains.set(name, fields);
  }
  return chains.get(name);
}

// The default's keys the file left out, at every depth
function merge(target, defaults) {
  for (const [key, value] of Object.entries(defaults)) {
    if (target[key] === undefined) {
      target[key] = clone(value);
    } else if (isObject(target[key]) && isObject(value)) {
      merge(target[key], value);
    }
  }
}

// One object of a class: its fields' defaults, then the structs it holds by their own class
function fill(object, name) {
  const fields = chain(name);
  if (!fields) {
    schemaStats.unknown++;
    return;
  }
  for (const key of Object.keys(object)) {
    if (key !== "_class" && !fields.has(key)) {
      schemaStats.older++;
      return;
    }
  }
  schemaStats.filled++;
  for (const [field, { value, type }] of fields) {
    if (value !== null && value !== undefined) {
      if (object[field] === undefined) {
        object[field] = clone(value);
      } else if (isObject(object[field]) && isObject(value)) {
        merge(object[field], value);
      }
    }
    if (type) {
      const held = object[field];
      for (const item of Array.isArray(held) ? held : [held]) {
        if (isObject(item) && typeof item._class !== "string") fill(item, type);
      }
    }
  }
}

// Every object with a _class in a system (the system itself, its operators, their nested ones)
function visit(value) {
  if (Array.isArray(value)) {
    value.forEach(visit);
  } else if (isObject(value)) {
    if (typeof value._class === "string") fill(value, value._class);
    Object.values(value).forEach(visit);
  }
}

// A system with the engine's defaults filled in, in place, once
export function withDefaults(system) {
  if (schema && isObject(system) && !done.has(system)) {
    done.add(system);
    visit(system);
  }
  return system;
}
