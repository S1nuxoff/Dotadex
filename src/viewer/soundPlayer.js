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
  return audioContext().decodeAudioData(await res.arrayBuffer()).catch(() => null);
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

// Plays right away when loaded; a sound still loading is skipped rather than played late
export function playLoaded(url, { volume = 1, rate = 1 } = {}) {
  const buffer = buffers.get(url);
  if (!buffer) {
    preloadSound(url);
    return;
  }
  const ctx = audioContext();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  const gain = ctx.createGain();
  gain.gain.value = volume * effectsVolume();
  source.connect(gain).connect(ctx.destination);
  source.start();
}
