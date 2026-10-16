// How loud things are, kept on this device: everything, the menu music, and the rest
// (voice lines, animation sounds, previews)
const DEFAULTS = { master: 0.9, music: 0.5, effects: 0.8 };

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("volume") ?? "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

let levels = load();
const listeners = new Set();

export function getVolume() {
  return levels;
}

export function setVolume(change) {
  levels = { ...levels, ...change };
  try {
    localStorage.setItem("volume", JSON.stringify(levels));
  } catch {}
  listeners.forEach((listener) => listener(levels));
}

export function onVolume(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const musicVolume = () => levels.master * levels.music;
export const effectsVolume = () => levels.master * levels.effects;
