import { useEffect, useRef, useState } from "react";
import { createAudio, soundsBase } from "./Voice.jsx";
import { getVolume, musicVolume, onVolume, setVolume } from "../volume.js";
import { eventVolume, loadUiSounds, pickFile } from "../uiSounds.js";
import { mixLevel } from "../viewer/soundPlayer.js";

// The menu music as the game plays it (soundstacks_dota_music): coming to the menu,
// <pack>.music.ui_startup (dota_update_ui_startup: one of its tracks by weight); when it has
// played out, <pack>.music.ui_main (dota_update_ui_main: one of its tracks), and ui_main again
// each time one ends. The volume is the event's (else its stack's) times the Music group's level
// in the mixer, times the music slider. The default pack; the game takes the player's equipped one.
const PACK = "valve_dota_001";

export function useMenuMusic(modelsBase) {
  const audio = useRef(null);
  const stage = useRef("ui_startup");
  useEffect(() => {
    let data = null;
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
        const event = data.events[`${PACK}.music.${stage.current}`];
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
    loadUiSounds(modelsBase).then((value) => {
      data = value;
      play();
    });
    // Browsers let a page play sound only after it was clicked
    window.addEventListener("pointerdown", play, { once: true });
    const stop = onVolume(play);
    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", play);
      stop();
      audio.current?.pause();
    };
  }, [modelsBase]);
}

function Slider({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="flex justify-between text-xs text-ash">
        <span>{label}</span>
        <span className="tabular-nums">{Math.round(value * 100)}%</span>
      </span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ "--fill": `${value * 100}%` }}
        className="mt-1 w-full"
      />
    </label>
  );
}

// The volume of everything, the music and the other sounds
export function VolumeSliders() {
  const [levels, setLevels] = useState(getVolume);
  useEffect(() => onVolume(setLevels), []);
  return (
    <div className="space-y-3">
      <Slider label="Overall" value={levels.master} onChange={(master) => setVolume({ master })} />
      <Slider label="Music" value={levels.music} onChange={(music) => setVolume({ music })} />
      <Slider label="Voice and sounds" value={levels.effects} onChange={(effects) => setVolume({ effects })} />
    </div>
  );
}
