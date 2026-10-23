import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Search } from "lucide-react";
import { effectsVolume } from "../volume.js";
import { likelyUrl, noteWav } from "../viewer/soundPlayer.js";

// Where the sounds are: the sounds dataset next to the models one
export function soundsBase(modelsBase) {
  return modelsBase.replace("dota2-models", "dota2-sounds");
}

// Some of the game's sounds are WAV rather than MP3: when the .mp3 is missing, try .wav
export function createAudio(url) {
  const first = likelyUrl(url);
  const audio = new Audio(first);
  if (first.endsWith(".mp3")) {
    audio.addEventListener(
      "error",
      () => {
        noteWav(url);
        audio.src = url.replace(/\.mp3$/, ".wav");
      },
      { once: true }
    );
  }
  return audio;
}

// A sound loading ahead of when it is played (playSound's `audio`): a line fetched only when the
// animation says it starts late, after its download
export function prepareSound(url) {
  const audio = createAudio(url);
  audio.preload = "auto";
  return audio;
}

// One sound at a time across the page. A line the hero says (speech) is also told to the stage,
// whose hero moves its face with it ("dotadex:speech")
let current = null;
export function playSound(url, onEnd, { speech = false, audio = createAudio(url) } = {}) {
  current?.pause();
  audio.volume = Math.min(effectsVolume(), 1);
  const start = () => audio.play().catch(() => onEnd?.());
  // HAVE_FUTURE_DATA: a prepared sound may have loaded already
  if (audio.readyState >= 3) start();
  else audio.addEventListener("canplay", start, { once: true });
  audio.addEventListener("ended", () => onEnd?.());
  audio.addEventListener("pause", () => onEnd?.());
  current = audio;
  if (speech) window.dispatchEvent(new CustomEvent("dotadex:speech", { detail: { audio, url } }));
  return audio;
}

// Situations a voice line is for, from the words in its event name
export const CATEGORIES = [
  ["Spawn", /spawn|respawn|battlebegins|horn/],
  ["Kills", /kill|firstblood|rampage|ownage|godlike|dominat|megakill|unstoppable|wicked|monster|holy|streak|ending/],
  ["Death", /death|dying|die\b|_die_|suicide/],
  ["Abilities", /ability|cast|_skill|ult|spell/],
  ["Attacking", /attack/],
  ["Moving", /move|_go_|order/],
  ["Buying items", /purch|item|buy|blink|bkb|bottle|rapier|aghs|refresher|shard|tango|ward/],
  ["Level up", /level/],
  ["Last hits and denies", /lasthit|last_hit|deny/],
  ["Runes", /rune|haste|regen|doubledamage|illusion|invis|arcane|bounty|water|shield/],
  ["Taking damage", /pain|hit\b|_hit_|hurt/],
  ["Laughs", /laugh/],
  ["Thanks", /thanks|thank/],
  ["Victory and defeat", /win|victory|lose|defeat|immort|^.*_won/],
  ["Rivals and allies", /rival|ally|enemy|friend/],
  ["Rare", /rare/],
];

export function categoryOf(event) {
  const words = event.toLowerCase();
  return CATEGORIES.find(([, pattern]) => pattern.test(words))?.[0] ?? "Other";
}

// "pudge_pud_attack_01" -> "attack 01"
function lineName(event) {
  const parts = event.split("_");
  return parts.slice(Math.min(2, parts.length - 1)).join(" ");
}

function Line({ url, label, playing, onPlay }) {
  return (
    <li>
      <button
        onClick={onPlay}
        className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-raised ${
          playing ? "text-aegis" : "text-bone/90"
        }`}
      >
        {playing ? <Pause className="size-3.5 shrink-0" /> : <Play className="size-3.5 shrink-0 text-ash" />}
        <span className="truncate">{label}</span>
      </button>
    </li>
  );
}

export function SoundList({ base, files, labels, speech = false }) {
  const [playing, setPlaying] = useState(null);
  const ref = useRef(null);
  useEffect(() => () => ref.current?.pause(), []);
  const toggle = (file) => {
    if (playing === file) {
      ref.current?.pause();
      setPlaying(null);
      return;
    }
    setPlaying(file);
    ref.current = playSound(base + file, () => setPlaying((value) => (value === file ? null : value)), { speech });
  };
  return (
    <ul className="space-y-0.5">
      {files.map((file, index) => (
        <Line key={file} url={base + file} label={labels?.[index] ?? file.split("/").pop().replace(/\.(mp3|wav)$/, "")} playing={playing === file} onPlay={() => toggle(file)} />
      ))}
    </ul>
  );
}

export default function Voice({ modelsBase, heroKey }) {
  const [lines, setLines] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const base = soundsBase(modelsBase);

  useEffect(() => {
    let cancelled = false;
    setLines(null);
    fetch(`${modelsBase}data/voices/${heroKey}.json`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => !cancelled && setLines(data))
      .catch((reason) => !cancelled && setError(reason.message));
    return () => {
      cancelled = true;
    };
  }, [modelsBase, heroKey]);

  const groups = useMemo(() => {
    const words = query.trim().toLowerCase();
    const result = new Map();
    for (const line of lines ?? []) {
      if (words && !line.event.toLowerCase().includes(words.replace(/\s+/g, "_"))) {
        continue;
      }
      const category = categoryOf(line.event);
      const list = result.get(category) ?? [];
      line.files.forEach((file, index) => list.push({ file, label: lineName(line.event) + (line.files.length > 1 ? ` (${index + 1})` : "") }));
      result.set(category, list);
    }
    const order = [...CATEGORIES.map(([name]) => name), "Other"];
    return [...result].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }, [lines, query]);

  if (error) {
    return <p className="p-4 text-sm text-ash">The voice lines did not load. {error}</p>;
  }
  if (!lines) {
    return <p className="p-4 text-sm text-ash">Loading the voice lines</p>;
  }

  const total = lines.reduce((sum, line) => sum + line.files.length, 0);
  return (
    <div className="px-4 pt-2 pb-6">
      <label className="flex items-center gap-2 rounded-lg border border-line px-2.5 focus-within:border-aegis/70">
        <Search className="size-3.5 shrink-0 text-ash" aria-hidden />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${total} voice lines`}
          aria-label="Search voice lines"
          className="h-8 w-full bg-transparent text-sm text-bone placeholder:text-ash/70 focus:outline-none"
        />
      </label>
      {groups.map(([category, list]) => (
        <details key={category} className="mt-3" open={groups.length <= 3}>
          <summary className="cursor-pointer text-sm text-bone select-none">
            {category} <span className="text-xs text-ash tabular-nums">{list.length}</span>
          </summary>
          <div className="mt-1.5">
            <SoundList base={base} files={list.map((entry) => entry.file)} labels={list.map((entry) => entry.label)} speech />
          </div>
        </details>
      ))}
    </div>
  );
}
