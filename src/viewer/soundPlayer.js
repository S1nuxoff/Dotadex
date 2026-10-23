import { effectsVolume } from "../volume.js";

// Sounds of animations through Web Audio: loaded and decoded ahead of time, so they
// play on the frame they belong to instead of after a download.

let context = null;
const buffers = new Map(); // url -> AudioBuffer or null, once loaded
const loading = new Map(); // url -> Promise

function audioContext() {
  context ??= new (window.AudioContext || window.webkitAudioContext)();
  return context;
}

// Decoding needs no sound out, so it goes through an offline context: the live one is made only
// once the person has acted, as browsers warn about one made before
let decoder = null;
function decodeContext() {
  decoder ??= new OfflineAudioContext(1, 1, 44100);
  return decoder;
}

const mayPlay = () => navigator.userActivation?.hasBeenActive ?? true;

// Called from a click: browsers only let a page make sound after the person acted
export function unlockSound() {
  audioContext().resume().catch(() => {});
}

// Some of the game's sounds are WAV rather than MP3, a folder at a time: once a folder turns out
// to hold WAVs, its other sounds are asked for as WAV first, sparing a failed request each
const wavFolders = new Set();
const folderOf = (url) => url.slice(0, url.lastIndexOf("/"));

export function likelyUrl(url) {
  return url.endsWith(".mp3") && wavFolders.has(folderOf(url)) ? url.replace(/\.mp3$/, ".wav") : url;
}

export function noteWav(url) {
  wavFolders.add(folderOf(url));
}

async function fetchBuffer(url) {
  const first = likelyUrl(url);
  let res = await fetch(first).catch(() => null);
  if (!res?.ok && first.endsWith(".mp3")) {
    res = await fetch(first.replace(/\.mp3$/, ".wav")).catch(() => null);
    if (res?.ok) {
      noteWav(url);
    }
  } else if (!res?.ok && first !== url) {
    res = await fetch(url).catch(() => null);
  }
  if (!res?.ok) {
    return null;
  }
  return decodeContext().decodeAudioData(await res.arrayBuffer()).catch(() => null);
}

export function preloadSound(url) {
  if (!loading.has(url)) {
    loading.set(
      url,
      fetchBuffer(url).then((buffer) => {
        buffers.set(url, buffer);
        return buffer;
      })
    );
  }
  return loading.get(url);
}

// Plays as soon as it has loaded, however long that takes: for sounds asked for once, like a cast
export async function playWhenReady(url, options) {
  await preloadSound(url);
  playLoaded(url, options);
}

// The game's mixer (scripts/soundmixers.txt, from data/ui-sounds.json): a sound's group is the
// highest priority one whose path part its file path holds (the first listed of equal ones), and
// Default_Mix gives each group's level. Taken relative to the interface's group, so the
// interface plays at the volume the sliders give and the rest keeps the game's balance to it.
let mix = null;
export function setSoundMix(value) {
  mix = value;
}

export function mixLevel(url) {
  if (!mix) {
    return 1;
  }
  // the game's path: from sounds/ on
  const file = url.slice(url.indexOf("/sounds/") + 1);
  let group = null;
  for (const entry of mix.groups) {
    if (entry.class || !file.includes(entry.path) || (group && entry.priority <= group.priority)) continue;
    group = entry;
  }
  const level = (name) => mix.levels[name] ?? 1;
  return group ? level(group.name) / level("UI") : 1;
}

// A sound from a place before the listener, as the game's HRTF panner sends one: forward, plus
// left and up by the given amounts (the remapped screen place, -1 to 1 each)
function placed(ctx, { left = 0, up = 0 }) {
  const panner = ctx.createPanner();
  panner.panningModel = "HRTF";
  // only the direction counts
  panner.rolloffFactor = 0;
  const length = Math.hypot(left, up, 1);
  // the listener looks down -z with +y up and -x to its left
  panner.positionX.value = -left / length;
  panner.positionY.value = up / length;
  panner.positionZ.value = -1 / length;
  return panner;
}

// Plays right away when loaded; a sound still loading is skipped rather than played late
export function playLoaded(url, { volume = 1, rate = 1, place = null } = {}) {
  const buffer = buffers.get(url);
  if (!buffer) {
    preloadSound(url);
    return;
  }
  if (!mayPlay()) {
    return;
  }
  const ctx = audioContext();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  const gain = ctx.createGain();
  gain.gain.value = volume * mixLevel(url) * effectsVolume();
  source.connect(gain);
  (place ? gain.connect(placed(ctx, place)) : gain).connect(ctx.destination);
  source.start();
}
