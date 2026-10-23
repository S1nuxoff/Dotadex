import { useEffect, useRef } from "react";
import { createAudio, soundsBase } from "./Voice.jsx";
import { musicVolume, onVolume } from "../volume.js";
import { eventVolume, loadUiSounds, pickFile } from "../uiSounds.js";
import { mixLevel } from "../viewer/soundPlayer.js";
import { getViewSettings, onViewSettings } from "../viewSettings.js";

// The menu music as the game plays it (soundstacks_dota_music): coming to the menu,
// <pack>.music.ui_startup (dota_update_ui_startup: one of its tracks by weight); when it has
// played out, <pack>.music.ui_main (dota_update_ui_main: one of its tracks), and ui_main again
// each time one ends. The volume is the event's (else its stack's) times the Music group's level
// in the mixer, times the music slider.
//
// The stacks name valve_dota_001's events and start them with econ_replacement: the equipped
// music pack's own event plays instead (client.dll 0x181bd8000 does the same for ui_startup).
// Here the pack is the one equipped on its page (the view setting musicPack, a folder of
// sounds/music). Starting ui_startup stops every other `.music.` event (soundevent_limiter), and
// a stopped track fades out over the stacks' fade_out of 3 s; so equipping a pack fades the
// playing track out and starts the new pack's ui_startup. The game holds ui_startup back until
// the player's items are loaded (to know the pack), at most 10 s; the site has nothing to wait for.
export const DEFAULT_PACK = "valve_dota_001";
const FADE_OUT = 3;

// The pack's name in the events (<pack>.music.ui_main) for a folder of sounds/music: they differ
// for some (shop_jbrice_01 plays from jbrice_01); null for a folder with no menu music
export function menuMusicPack(data, folder) {
  for (const name of Object.keys(data?.events ?? {})) {
    const match = name.match(/^(.+)\.music\.ui_main$/);
    if (match && data.events[name].files?.[0]?.startsWith(`sounds/music/${folder}/`)) {
      return match[1];
    }
  }
  return null;
}

function fadeOut(element) {
  const from = element.volume;
  const start = performance.now();
  // not by frames: they stop in a hidden tab
  const timer = setInterval(() => {
    const done = (performance.now() - start) / 1000 / FADE_OUT;
    if (done >= 1) {
      clearInterval(timer);
      element.pause();
      return;
    }
    element.volume = from * (1 - done);
  }, 50);
}

export function useMenuMusic(modelsBase) {
  const audio = useRef(null);
  const stage = useRef("ui_startup");
  useEffect(() => {
    let data = null;
    let pack = null;
    let cancelled = false;
    const play = () => {
      if (!data || cancelled) {
        return;
      }
      if (musicVolume() <= 0) {
        audio.current?.pause();
        return;
      }
      if (!audio.current) {
        const event = data.events[`${pack}.music.${stage.current}`] ?? data.events[`${DEFAULT_PACK}.music.${stage.current}`];
        const file = event && pickFile(event);
        if (!file) {
          return;
        }
        const element = createAudio(soundsBase(modelsBase) + file);
        element.eventVolume = eventVolume(event) * mixLevel(file);
        // ui_main after the startup track, then ui_main again; a track that will not load is
        // passed over the same way
        const next = () => {
          if (audio.current !== element) {
            return;
          }
          stage.current = "ui_main";
          audio.current = null;
          play();
        };
        element.addEventListener("ended", next);
        element.addEventListener("error", next);
        audio.current = element;
      }
      audio.current.volume = Math.min(musicVolume() * audio.current.eventVolume, 1);
      audio.current.play().catch(() => {});
    };
    const equip = (settings) => {
      const next = menuMusicPack(data, settings.musicPack) ?? DEFAULT_PACK;
      if (next === pack) {
        return;
      }
      const started = pack !== null;
      pack = next;
      if (started) {
        if (audio.current && !audio.current.paused) fadeOut(audio.current);
        else audio.current?.pause();
        audio.current = null;
        stage.current = "ui_startup";
        play();
      }
    };
    loadUiSounds(modelsBase).then((value) => {
      data = value;
      equip(getViewSettings());
      play();
    });
    // Browsers let a page play sound only after it was clicked
    window.addEventListener("pointerdown", play, { once: true });
    const stop = onVolume(play);
    const unequip = onViewSettings((settings) => data && equip(settings));
    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", play);
      stop();
      unequip();
      audio.current?.pause();
    };
  }, [modelsBase]);
}
