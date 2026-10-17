import { useEffect, useRef, useState } from "react";
import { soundsBase } from "./Voice.jsx";
import { getVolume, musicVolume, onVolume, setVolume } from "../volume.js";

// The game's own menu music, one track after another, as the main menu plays it
const TRACKS = [
  "sounds/music/valve_dota_001/music/ui_main_01.mp3",
  "sounds/music/valve_dota_001/music/ui_hero_select.wav",
  "sounds/music/valve_dota_001/music/ui_main_02.mp3",
  "sounds/music/valve_dota_001/music/ui_world_map.mp3",
  "sounds/music/valve_dota_001/diretide/ui_main_03.mp3",
];

export function useMenuMusic(modelsBase) {
  const audio = useRef(null);
  const track = useRef(0);
  useEffect(() => {
    const play = () => {
      if (musicVolume() <= 0) {
        audio.current?.pause();
        return;
      }
      if (!audio.current) {
        const element = new Audio(soundsBase(modelsBase) + TRACKS[track.current]);
        // On to the next track when one ends, round and round; one that will not load is skipped
        const next = () => {
          if (audio.current !== element) {
            return;
          }
          track.current = (track.current + 1) % TRACKS.length;
          audio.current = null;
          play();
        };
        element.addEventListener("ended", next);
        element.addEventListener("error", next);
        audio.current = element;
      }
      audio.current.volume = Math.min(musicVolume(), 1);
      audio.current.play().catch(() => {});
    };
    // Browsers let a page play sound only after it was clicked
    play();
    window.addEventListener("pointerdown", play, { once: true });
    const stop = onVolume(play);
    return () => {
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
