import { fetchData } from "../fetchData.js";

// A hero's face moving with its voice line, as client.dll moves it (C_BaseFlex's visemes, the same
// code as Source 1's):
//
// - The line's phonemes (its sentence: start, end and IPA code point of each sound of speech) are
//   run through a box filter of PHONEME_FILTER seconds at the line's time: each phoneme the filter
//   covers adds its share of the filter times its settings. While inside a phoneme, the filter
//   stretches up to that phoneme's length, to the end of the next phoneme when it follows at once
//   or to its start when there is a gap (not for the last phoneme), and stays that long for the
//   phonemes after it.
// - A phoneme's settings are flex controller values (expressions/heroes/phonemes.txt, the
//   "phonemes" class client.dll loads for heroes; no line has emphasis, so the class counts once).
// - The model's flex rules (each mesh's MRPH block) make the morph targets' weights out of the
//   controllers, clamped to their ranges.
//
// The tracker exports the phonemes per sound folder (sounds/<folder>/phonemes.json, listed in the
// sounds dataset's phonemes.json), the class (expressions/heroes/phonemes.json) and each model's
// controllers and rules (<model>.flex.json beside the glb, listed in models/flex.json). The glb's
// morph targets are named after their flex descriptors (glb.js).
//
// The animations' own face moves come baked into the glb as morph weights, without their
// controllers, so the speech's weights are added on top of them while each mesh is drawn rather
// than added to the controllers first as the game does: the same where the rules are sums, close
// where they multiply controllers (the combination targets such as jawOpen__lipCornerPuller).
//
// Not done: the face animation some newer lines carry besides their phonemes (m_morphData, in the
// phonemes file as `m`): how the game mixes it with the phonemes is not read yet.

// client.dll's phonemefilter and phonemedelay
const PHONEME_FILTER = 0.08;
const PHONEME_DELAY = 0;

const flexLists = new Map();
const flexFiles = new Map();

// The flex controllers and rules of the model at `url` (a glb in the dataset), or null
export function loadFlex(url) {
  const at = url.indexOf("/models/");
  if (at < 0) return Promise.resolve(null);
  const base = url.slice(0, at + 1);
  if (!flexLists.has(base)) {
    const list = fetchData(`${base}models/flex.json`)
      .then((response) => (response.ok ? response.json() : []))
      .then((glbs) => new Set(glbs))
      .catch(() => {
        flexLists.delete(base);
        return new Set();
      });
    flexLists.set(base, list);
  }
  return flexLists.get(base).then((list) => {
    if (!list.has(url.slice(at + 1))) return null;
    const file = url.replace(/\.glb$/, ".flex.json");
    if (!flexFiles.has(file)) {
      const flex = fetch(file)
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
      flex.then((data) => data || flexFiles.delete(file));
      flexFiles.set(file, flex);
    }
    return flexFiles.get(file);
  });
}

const jsonOnce = new Map();
function json(url) {
  if (!jsonOnce.has(url)) {
    const promise = fetchData(url)
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
    promise.then((data) => data || jsonOnce.delete(url));
    jsonOnce.set(url, promise);
  }
  return jsonOnce.get(url);
}

// { tags: [start, end, code, ...], classes } for the sound at `url` (an .mp3 or .wav in the
// sounds dataset), or null when it has no phonemes
export async function loadSpeech(url) {
  const at = url.indexOf("/sounds/");
  if (at < 0) return null;
  const base = url.slice(0, at + 1);
  const path = url.slice(at + 1);
  const folder = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.(mp3|wav)$/, "");
  const folders = await json(`${base}phonemes.json`);
  if (!folders?.includes(folder)) return null;
  const [sounds, classes] = await Promise.all([json(`${base}${folder}/phonemes.json`), json(`${base}expressions/heroes/phonemes.json`)]);
  const entry = sounds?.[name];
  const tags = Array.isArray(entry) ? entry : entry?.p;
  if (!tags?.length || !classes) return null;
  return { tags, classes };
}

// Adds the phonemes' controller values at time t into `values` (by controller name, lower case)
function addVisemes({ tags, classes }, t, values) {
  let dt = PHONEME_FILTER;
  const count = tags.length / 3;
  for (let k = 0; k < count; k++) {
    const start = tags[k * 3];
    const end = tags[k * 3 + 1];
    if (t > start && end > t && k < count - 1) {
      const length = end - start;
      const nextStart = tags[k * 3 + 3];
      const reach = nextStart === end ? Math.min(length, tags[k * 3 + 4] - t) : Math.min(nextStart - t, length);
      dt = Math.max(dt, reach);
    }
    const t1 = (start - t) / dt;
    const t2 = (end - t) / dt;
    if (t1 < 1 && t2 > 0) {
      const scale = Math.min(1, t2) - Math.max(0, t1);
      for (const [key, value] of classes.phonemes[tags[k * 3 + 2]] ?? []) {
        const name = classes.lower[key];
        values.set(name, (values.get(name) ?? 0) + scale * value);
      }
    }
  }
}

// One flex rule run over the controllers (values by index in the mesh's model) and the
// descriptors worked out before it (by name)
function runRule(ops, controllers, descriptors) {
  const stack = [];
  for (const [op, data] of ops) {
    switch (op) {
      case "const":
        stack.push(data);
        break;
      case "fetch1":
        stack.push(controllers[data] ?? 0);
        break;
      case "fetch2":
        stack.push(descriptors.get(data) ?? 0);
        break;
      case "add":
        stack.push(stack.pop() + stack.pop());
        break;
      case "sub": {
        const b = stack.pop();
        stack.push(stack.pop() - b);
        break;
      }
      case "mul":
        stack.push(stack.pop() * stack.pop());
        break;
      case "div": {
        const b = stack.pop();
        const a = stack.pop();
        stack.push(b ? a / b : 0);
        break;
      }
      case "neg":
        stack.push(-stack.pop());
        break;
      case "max":
        stack.push(Math.max(stack.pop(), stack.pop()));
        break;
      case "min":
        stack.push(Math.min(stack.pop(), stack.pop()));
        break;
      default:
        break;
    }
  }
  return stack.length ? stack[stack.length - 1] : 0;
}

// Each mesh's face entry of the newest Face over it (a Face is made again when parts change)
const faceOf = new WeakMap();

// The speech's weights are added only while the mesh is drawn, so the animation's own are left as
// it set them
function drawWithFace(mesh) {
  const add = (sign) => {
    const entry = faceOf.get(mesh);
    if (!entry?.on) return;
    const influences = mesh.morphTargetInfluences;
    for (let i = 0; i < influences.length; i++) influences[i] += sign * entry.added[i];
  };
  for (const [before, after] of [
    ["onBeforeRender", "onAfterRender"],
    ["onBeforeShadow", "onAfterShadow"],
  ]) {
    const own = [mesh[before], mesh[after]];
    mesh[before] = function (...args) {
      own[0]?.apply(this, args);
      add(1);
    };
    mesh[after] = function (...args) {
      add(-1);
      own[1]?.apply(this, args);
    };
  }
}

// The faces of a model's meshes (the hero's and its worn parts', each with its own model's rules),
// moved by one voice line at a time
export class Face {
  // flexByModel: Map of a model's glb url to its flex (loadFlex)
  constructor(group, flexByModel) {
    this.meshes = [];
    group.traverse((mesh) => {
      const flex = mesh.isMesh && mesh.morphTargetInfluences && flexByModel.get(mesh.userData.model);
      if (!flex) return;
      const targets = [];
      for (const [name, index] of Object.entries(mesh.morphTargetDictionary ?? {})) {
        if (flex.rules[name]) targets.push([name, index]);
      }
      if (!targets.length) return;
      const entry = { mesh, flex, targets, added: new Float32Array(mesh.morphTargetInfluences.length), on: false };
      if (!faceOf.has(mesh)) drawWithFace(mesh);
      faceOf.set(mesh, entry);
      this.meshes.push(entry);
    });
    this.speech = null;
    this.values = new Map();
  }

  get empty() {
    return this.meshes.length === 0;
  }

  // Speaks `speech` (loadSpeech) along with `audio` playing it
  speak(audio, speech) {
    if (!speech.classes.lower) speech.classes.lower = speech.classes.keys.map((key) => key.toLowerCase());
    this.speech = { audio, speech };
  }

  update() {
    const speaking = this.speech;
    if (speaking && (speaking.audio.ended || (speaking.audio.paused && speaking.audio.currentTime > 0))) this.speech = null;
    this.values.clear();
    if (this.speech) addVisemes(this.speech.speech, this.speech.audio.currentTime - PHONEME_DELAY, this.values);
    const active = this.values.size > 0;
    for (const entry of this.meshes) {
      entry.added.fill(0);
      entry.on = active;
      if (!active) continue;
      const controllers = entry.flex.controllers.map(([name, min, max]) => Math.min(max, Math.max(min, this.values.get(name.toLowerCase()) ?? 0)));
      const descriptors = new Map();
      for (const [name, ops] of Object.entries(entry.flex.rules)) descriptors.set(name, runRule(ops, controllers, descriptors));
      for (const [name, index] of entry.targets) entry.added[index] = descriptors.get(name) ?? 0;
    }
  }
}
