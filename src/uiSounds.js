import { playLoaded, preloadSound, setSoundMix } from "./viewer/soundPlayer.js";
import { fetchData } from "./fetchData.js";

// The game's menu sounds, as its interface plays them. Panorama's stylesheets give a panel a
// sound event for a state (`sound: "<event>"`): most for :active (the press), some for :selected
// (a tab or tile becoming the chosen one) or :hover. Buttons with no such rule are silent (the
// engine's own `activation` and `focus_change` events are at volume 0).
//
// The events come from data/ui-sounds.json (the tracker's audio.js): soundevents_dota_ui and each
// music pack's menu music with all their fields, the defaults of the sound stacks they are (their
// `type`), and the mixer. What the stacks do with the fields:
//   dota_ui_limit_time    not again within block_time of the last of its block_name
//   dota_ui_start_multi   starts soundevent_01, _02... (those whose use_NN is not 0)
//   dota_ui_panner        panner_mode hrtf: from the panel's place on the screen
//   random_weighted       one of vsnd_files by weights (all alike without them)
//
// Marks on elements, installed once for the whole page:
//   data-sound="<event>"         on the press (:active), not when disabled
//   data-select-sound="<event>"  on the click that chooses it (:selected); left off what is chosen
//   data-hover-sound="<event>"   when the pointer comes onto it (:hover)
//
// Which panel plays what (dotastyles.css and the pages' own):
//   ButtonPrimary, TextButton, ButtonBevel, ButtonDark       ui_generic_button_click
//   .TopBarMenuItem:selected (the top bar's sections)        ui_topmenu_activate
//   .SecondaryTabButton:active (the tabs under the top bar)  ui_rollover_micro
//   #DOTASettingsButton / #DOTACloseSettingsButton           ui_settings_multi / _out_multi
//   .TabItem:selected, .HeroSelectionPanel, .CategorySelectionPanel (the Armory),
//   DOTAEconItemAnimated:selected (a cosmetic's tile)        ui_generic_button_click
//   DOTAHeroSlotItemPickerLoadout.IsActive (a slot in CUSTOMIZE)  ui_preview_button_click
//   .HeroCustomizeEnter / .HeroCustomizeExit #HeroCustomize  ui_loadout_slide_in / _out
//   .HeroCard:hover (the hero grid)                          UI.HeroCard.Hover
// Silent in the game: the logo, back and forward, the previous and next hero, the persona
// switch, drop-downs, the hero grid's filters and a hero card's click.
const OWN = {
  // Ours, not the game's: the fog between models, a rush as it closes, a sweep as it parts
  "veil-in": { files: ["sounds/ui/menu/shortwhoosh.wav"], volume: 0.8 },
  "veil-out": { files: ["sounds/ui/menu/switch_view.wav"], volume: 0.7 },
};

let base = "";
let data = null;
let loading = null;
const lastPlayed = {};

// data/ui-sounds.json, once
export function loadUiSounds(modelsBase) {
  loading ??= fetchData(`${modelsBase}data/ui-sounds.json`)
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
    .then((value) => {
      data = value;
      if (value?.mix) setSoundMix(value.mix);
      return value;
    });
  return loading;
}

const eventOf = (name) => OWN[name] ?? data?.events[name];
// A field of an event, else its stack's
const field = (event, key) => event[key] ?? data?.stacks?.[event.type]?.[key];

// One of the files, by the event's weights (random_weighted)
export function pickFile(event) {
  const files = event.files ?? [];
  const weights = Array.isArray(event.weights) ? event.weights : null;
  if (weights) {
    const total = files.reduce((sum, _, index) => sum + (weights[index] ?? 0), 0);
    let roll = Math.random() * total;
    for (let index = 0; index < files.length && total > 0; index++) {
      roll -= weights[index] ?? 0;
      if (roll < 0) return files[index];
    }
  }
  return files[Math.floor(Math.random() * files.length)];
}

// The volume an event plays at: its own, else its stack's
export function eventVolume(event) {
  return field(event, "volume") ?? 1;
}

// A curve of the sound stacks (math_curve_2d): keys [x, y, in slope, out slope, ...], cubic
// Hermite between them, held past the ends
function curve(keys, x) {
  if (!Array.isArray(keys) || !keys.length) return x;
  if (x <= keys[0][0]) return keys[0][1];
  for (let index = 1; index < keys.length; index++) {
    const [x0, y0, , out0] = keys[index - 1];
    const [x1, y1, in1] = keys[index];
    if (x > x1) continue;
    const span = x1 - x0;
    const t = span > 0 ? (x - x0) / span : 0;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * span * out0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * span * in1;
  }
  return keys[keys.length - 1][1];
}

// dota_ui_panner's hrtf mode: the panel's place (uiposition, the screen's middle at 0, +x to the
// left, +z up, half the screen each way) through the stack's curves to how far left and up
function placeOf(event, element) {
  if (field(event, "panner_mode") !== "hrtf" || !element) return null;
  const box = element.getBoundingClientRect();
  const x = 0.5 - (box.left + box.width / 2) / window.innerWidth;
  const z = 0.5 - (box.top + box.height / 2) / window.innerHeight;
  return { left: curve(field(event, "hrtf_pan_horizontal"), x), up: curve(field(event, "hrtf_pan_vertical"), z) };
}

// Through Web Audio, decoded ahead of time, so they play the instant they are called for;
// playLoaded follows the "Voice and sounds" volume and the game's mixer
export function playUiSound(name, element = null) {
  const event = eventOf(name);
  if (!event || !base) {
    return;
  }
  // dota_ui_start_multi: its events together
  for (let n = 1; event[`soundevent_${String(n).padStart(2, "0")}`]; n++) {
    const key = String(n).padStart(2, "0");
    if ((event[`use_${key}`] ?? 1) > 0) playUiSound(event[`soundevent_${key}`], element);
  }
  if (!event.files?.length) {
    return;
  }
  const block = field(event, "block_time");
  const blockName = event.block_name ?? name;
  const now = performance.now();
  if (block && now - (lastPlayed[blockName] ?? -Infinity) < block * 1000) {
    return;
  }
  lastPlayed[blockName] = now;
  playLoaded(base + pickFile(event), { volume: eventVolume(event), rate: field(event, "pitch") ?? 1, place: placeOf(event, element) });
}

export function installUiSounds(soundsBase, modelsBase) {
  base = soundsBase;
  if (installUiSounds.done) {
    return;
  }
  installUiSounds.done = true;
  // The ones the page uses are small, decoded ahead of the clicks: once the page has settled or
  // at the first press, not alongside the first hero's files (the browser plays nothing before a
  // press anyway)
  const preloadAll = () => {
    if (preloadAll.done) return;
    preloadAll.done = true;
    loadUiSounds(modelsBase).then(() => {
      const names = new Set(Object.keys(OWN));
      document.querySelectorAll("[data-sound], [data-select-sound], [data-hover-sound]").forEach((element) => {
        Object.values(element.dataset).forEach((value) => names.add(value));
      });
      const add = (name) => {
        const event = eventOf(name);
        if (!event) return;
        event.files?.forEach((file) => preloadSound(base + file));
        for (let n = 1; event[`soundevent_${String(n).padStart(2, "0")}`]; n++) add(event[`soundevent_${String(n).padStart(2, "0")}`]);
      };
      // and those of CUSTOMIZE and the settings, not on the page yet
      [...names, "ui_loadout_slide_in", "ui_loadout_slide_out", "ui_loadout_equipped", "ui_generic_button_click", "ui_settings_out_multi", "ui_preview_button_click"].forEach(add);
    });
  };
  loadUiSounds(modelsBase);
  setTimeout(() => (window.requestIdleCallback ?? ((callback) => callback()))(preloadAll), 4000);
  document.addEventListener("pointerdown", preloadAll, { once: true });
  document.addEventListener("keydown", preloadAll, { once: true });
  const pressable = (target) => target && !target.disabled && target.getAttribute("aria-disabled") !== "true";
  document.addEventListener("pointerdown", (event) => {
    const target = event.target.closest?.("[data-sound]");
    if (event.button === 0 && pressable(target)) {
      playUiSound(target.dataset.sound, target);
    }
  });
  document.addEventListener("click", (event) => {
    // A press from the keyboard comes as a click alone
    const pressed = event.detail === 0 && event.target.closest?.("[data-sound]");
    if (pressable(pressed)) {
      playUiSound(pressed.dataset.sound, pressed);
    }
    const chosen = event.target.closest?.("[data-select-sound]");
    if (pressable(chosen)) {
      playUiSound(chosen.dataset.selectSound, chosen);
    }
  });
  // When the pointer comes onto a marked element, not while it moves inside it
  let last = null;
  document.addEventListener("pointerover", (event) => {
    const target = event.target.closest?.("[data-hover-sound]");
    if (target && target !== last) {
      playUiSound(target.dataset.hoverSound, target);
    }
    last = target;
  });
}
