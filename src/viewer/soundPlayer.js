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

async function fetchBuffer(url) {
  // Some of the game's sounds are WAV rather than MP3
  let res = await fetch(url).catch(() => null);
  if (!res?.ok && url.endsWith(".mp3")) {
    res = await fetch(url.replace(/\.mp3$/, ".wav")).catch(() => null);
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
  gain.gain.value = volume;
  source.connect(gain).connect(ctx.destination);
  source.start();
}
