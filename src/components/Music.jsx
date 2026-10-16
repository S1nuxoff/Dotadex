import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { createAudio, soundsBase } from "./Voice.jsx";
import { IconButton, Popover, useDismiss } from "./ui.jsx";
import { getVolume, musicVolume, onVolume, setVolume } from "../volume.js";

// The game's own menu music, one track after another, as the main menu plays it
const TRACKS = [
  "sounds/music/valve_dota_001/music/ui_main_01.mp3",
  "sounds/music/valve_dota_001/music/ui_hero_select.mp3",
  "sounds/music/valve_dota_001/music/ui_main_02.mp3",
  "sounds/music/valve_dota_001/music/ui_world_map.mp3",
  "sounds/music/valve_dota_001/diretide/ui_main_03.mp3",
];

function useMenuMusic(modelsBase) {
  const audio = useRef(null);
  const track = useRef(0);
  useEffect(() => {
    const play = () => {
      if (musicVolume() <= 0) {
        audio.current?.pause();
        return;
      }
      if (!audio.current) {
        const element = createAudio(soundsBase(modelsBase) + TRACKS[track.current]);
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
        let failures = 0;
        element.addEventListener("error", () => {
          // The first error is the .mp3 giving way to the .wav; a second means neither is there
          failures += 1;
          if (failures > 1) {
            next();
          }
        });
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

// Plays the menu music and offers the volume of everything, the music and the other sounds
export default function SoundSettings({ modelsBase }) {
  useMenuMusic(modelsBase);
  const [open, setOpen] = useState(false);
  const [levels, setLevels] = useState(getVolume);
  const ref = useDismiss(open, setOpen);
  useEffect(() => onVolume(setLevels), []);

  return (
    <div ref={ref} className="relative">
      <IconButton label="Volume" onClick={() => setOpen(!open)} active={open}>
        <SlidersHorizontal className="size-4" />
      </IconButton>
      <Popover open={open} className="top-11 right-0 w-60 space-y-3 p-3">
        <Slider label="Overall" value={levels.master} onChange={(master) => setVolume({ master })} />
        <Slider label="Music" value={levels.music} onChange={(music) => setVolume({ music })} />
        <Slider label="Voice and sounds" value={levels.effects} onChange={(effects) => setVolume({ effects })} />
      </Popover>
    </div>
  );
}
