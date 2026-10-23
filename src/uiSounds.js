import { playLoaded, preloadSound } from "./viewer/soundPlayer.js";

// The game's own interface sounds (WAV, as the game keeps them), played for elements marked
// with data-sound="<name>",
// and a soft rollover for those marked data-hover. Installed once for the whole page.
const FILES = {
  toptab: ["sounds/ui/menu/click_toptab.wav"],
  click: ["sounds/ui/menu/click_forward.wav"],
  back: ["sounds/ui/menu/click_back.wav"],
  toggle: ["sounds/ui/menu/option_toggle.wav"],
  settings: ["sounds/ui/menu/settings_open.wav"],
  pick: ["sounds/ui/menu/pick_select.wav"],
  hover: ["sounds/ui/buttonrollover.wav"],
  // The fog between models: a rush as it closes, a sweep as it parts
  "veil-in": ["sounds/ui/menu/shortwhoosh.wav"],
  "veil-out": ["sounds/ui/menu/switch_view.wav"],
  // CHANGE OUTFIT opening and closing (ui_loadout_slide_in / _out)
  "loadout-slide-in": ["sounds/ui/menu/map_open.wav"],
  "loadout-slide-out": ["sounds/ui/menu/shortwhoosh.wav"],
  unequip: ["sounds/ui/inventory/inv_unequip.wav"],
  equip: ["sounds/ui/inventory/common_equip.wav"],
  "equip-blade": ["sounds/ui/inventory/metalblade_equip_01.wav", "sounds/ui/inventory/metalblade_equip_02.wav"],
  "equip-armour": ["sounds/ui/inventory/metalarmour_equip_01.wav", "sounds/ui/inventory/metalarmour_equip_02.wav"],
  "equip-metal": ["sounds/ui/inventory/metalsmall_equip_01.wav", "sounds/ui/inventory/metalsmall_equip_02.wav"],
  "equip-heavy": ["sounds/ui/inventory/metalheavy_equip_01.wav", "sounds/ui/inventory/metalheavy_equip_02.wav"],
  "equip-staff": ["sounds/ui/inventory/staff_equip_01.wav", "sounds/ui/inventory/staff_equip_02.wav"],
};

// The equip sound of a slot, by what it usually is made of
export function equipSound(slot = "") {
  const name = slot.replace(/_persona_\d+$/, "");
  if (/weapon|offhand/.test(name)) return "equip-blade";
  if (/armor|shoulder|arms|gloves/.test(name)) return "equip-armour";
  if (/head|helm|mask/.test(name)) return "equip-metal";
  if (/mount|legs/.test(name)) return "equip-heavy";
  return "equip";
}

let base = "";

// Through Web Audio, decoded ahead of time, so they play the instant they are called for;
// playLoaded follows the "Voice and sounds" volume
export function playUiSound(name, volume = 1, rate = 1) {
  const files = FILES[name];
  if (!files || !base) {
    return;
  }
  playLoaded(base + files[Math.floor(Math.random() * files.length)], { volume, rate });
}

export function installUiSounds(soundsBase) {
  base = soundsBase;
  if (installUiSounds.done) {
    return;
  }
  installUiSounds.done = true;
  // All of them are small, decoded ahead of the clicks: once the page has settled or at the first
  // press, not alongside the first hero's files (the browser plays nothing before a press anyway)
  const preloadAll = () => {
    if (preloadAll.done) return;
    preloadAll.done = true;
    for (const files of Object.values(FILES)) {
      files.forEach((file) => preloadSound(base + file));
    }
  };
  setTimeout(() => (window.requestIdleCallback ?? ((callback) => callback()))(preloadAll), 4000);
  document.addEventListener("pointerdown", preloadAll, { once: true });
  document.addEventListener("keydown", preloadAll, { once: true });
  document.addEventListener("click", (event) => {
    const target = event.target.closest?.("[data-sound]");
    if (target) {
      playUiSound(target.dataset.sound, 0.7);
    }
  });
  // A rollover when the pointer comes onto a marked element, not while it moves inside it
  let last = null;
  document.addEventListener("pointerover", (event) => {
    const target = event.target.closest?.("[data-hover]");
    if (target && target !== last) {
      playUiSound("hover", 0.25);
    }
    last = target;
  });
}
