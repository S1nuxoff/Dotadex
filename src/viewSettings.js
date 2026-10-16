// How the stage may be handled, kept on this device. On a hero's page the camera is fixed as in
// the game and a drag turns the hero; freeCamera lets it orbit, zoom and pan everywhere.
const DEFAULTS = { freeCamera: false };

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("view") ?? "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

let settings = load();
const listeners = new Set();

export function getViewSettings() {
  return settings;
}

export function setViewSettings(change) {
  settings = { ...settings, ...change };
  try {
    localStorage.setItem("view", JSON.stringify(settings));
  } catch {}
  listeners.forEach((listener) => listener(settings));
}

export function onViewSettings(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
