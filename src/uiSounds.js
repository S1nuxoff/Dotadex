import { playLoaded, preloadSound } from "./viewer/soundPlayer.js";

// The game's menu sounds, as its interface plays them. Panorama's stylesheets give a panel a
// sound event for a state (`sound: "<event>"`): most for :active (the press), some for :selected
// (a tab or tile becoming the chosen one) or :hover. Buttons with no such rule are silent (the
// engine's own `activation` and `focus_change` events are at volume 0). The events are
// soundevents_dota_ui.vsndevts': their files, volume, pitch and block time (dota_ui_limit_time:
// not again within it). A dota_ui_start_multi event plays its events together.
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
const UI = "sounds/ui/panorama/";
const EVENTS = {
  ui_generic_button_click: { files: [`${UI}panorama_generic_button_click_01.wav`], volume: 0.8, block: 0.25 },
  ui_topmenu_activate: { events: ["ui_topmenu_select", "ui_topmenu_swt"] },
  ui_topmenu_select: { files: [`${UI}panorama_weighty_topmenu_01.wav`], volume: 0.85 },
  ui_topmenu_swt: { files: [`${UI}panorama_topmenu_select_03.wav`], volume: 0.6 },
  ui_rollover_micro: { files: [`${UI}panorama_rollover_micro_01.wav`], volume: 1, block: 0.7 },
  ui_settings_multi: { events: ["ui_settings_slide_in", "ui_select_md"] },
  ui_settings_out_multi: { events: ["ui_settings_slide_out", "ui_select_md"] },
  ui_settings_slide_in: { files: [`${UI}panorama_settings_slide_in_01.wav`], volume: 0.6, block: 0.5 },
  ui_settings_slide_out: { files: [`${UI}panorama_settings_slide_out_01.wav`], volume: 0.6, block: 0.5 },
  ui_select_md: { files: [`${UI}panorama_select_md_01.wav`], volume: 1 },
  ui_preview_button_click: { files: ["sounds/ui/menu/map_open.wav"], volume: 0.4, block: 0.25 },
  ui_loadout_slide_in: { files: ["sounds/ui/menu/map_open.wav"], volume: 0.4, rate: 0.8, block: 0.5 },
  ui_loadout_slide_out: { files: ["sounds/ui/menu/shortwhoosh.wav"], volume: 0.4, block: 0.5 },
  "UI.HeroCard.Hover": {
    files: [1, 2, 3, 4, 5, 6].map((n) => `sounds/ui/ui_herocard_hover_0${n}.wav`),
    volume: 0.2,
    rate: 0.8,
  },
  // Ours, not the game's: the fog between models, a rush as it closes, a sweep as it parts
  "veil-in": { files: ["sounds/ui/menu/shortwhoosh.wav"], volume: 0.8 },
  "veil-out": { files: ["sounds/ui/menu/switch_view.wav"], volume: 0.7 },
};

let base = "";
const lastPlayed = {};

// Through Web Audio, decoded ahead of time, so they play the instant they are called for;
// playLoaded follows the "Voice and sounds" volume
export function playUiSound(name) {
  const event = EVENTS[name];
  if (!event || !base) {
    return;
  }
  if (event.events) {
    event.events.forEach(playUiSound);
    return;
  }
  const now = performance.now();
  if (event.block && now - (lastPlayed[name] ?? -Infinity) < event.block * 1000) {
    return;
  }
  lastPlayed[name] = now;
  const files = event.files;
  playLoaded(base + files[Math.floor(Math.random() * files.length)], { volume: event.volume ?? 1, rate: event.rate ?? 1 });
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
    for (const event of Object.values(EVENTS)) {
      event.files?.forEach((file) => preloadSound(base + file));
    }
  };
  setTimeout(() => (window.requestIdleCallback ?? ((callback) => callback()))(preloadAll), 4000);
  document.addEventListener("pointerdown", preloadAll, { once: true });
  document.addEventListener("keydown", preloadAll, { once: true });
  const pressable = (target) => target && !target.disabled && target.getAttribute("aria-disabled") !== "true";
  document.addEventListener("pointerdown", (event) => {
    const target = event.target.closest?.("[data-sound]");
    if (event.button === 0 && pressable(target)) {
      playUiSound(target.dataset.sound);
    }
  });
  document.addEventListener("click", (event) => {
    // A press from the keyboard comes as a click alone
    const pressed = event.detail === 0 && event.target.closest?.("[data-sound]");
    if (pressable(pressed)) {
      playUiSound(pressed.dataset.sound);
    }
    const chosen = event.target.closest?.("[data-select-sound]");
    if (pressable(chosen)) {
      playUiSound(chosen.dataset.selectSound);
    }
  });
  // When the pointer comes onto a marked element, not while it moves inside it
  let last = null;
  document.addEventListener("pointerover", (event) => {
    const target = event.target.closest?.("[data-hover-sound]");
    if (target && target !== last) {
      playUiSound(target.dataset.hoverSound);
    }
    last = target;
  });
}
