import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { fetchData } from "../fetchData.js";
import { playSound } from "./Voice.jsx";
import { DOTADEX_BASE, SOUNDS_BASE, panoramaImage } from "../datasets.js";

// The Armory's Chat Wheel (ChatWheelEntry, collection_shared's 160 x 174 tiles): the chat wheel's
// lines by their categories (data/chat-wheel.json), each with its play button when it has a sound,
// its spray's picture when it is a spray, and its label

let loading = null;
function useChatWheel(modelsBase) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let cancelled = false;
    loading ??= fetchData(`${DOTADEX_BASE}data/chat-wheel.json`)
      .then((res) => (res.ok ? res.json() : { categories: [], messages: {} }))
      .catch(() => ({ categories: [], messages: {} }));
    loading.then((value) => !cancelled && setData(value));
    return () => {
      cancelled = true;
    };
  }, [modelsBase]);
  return data;
}

// A line's name when it has no label (a spray): Frostivus2024_Spray_1 -> Frostivus2024 Spray 1
const nameOf = (name, line) => line.label ?? line.message ?? name.replace(/_/g, " ");

function Line({ modelsBase, name, line, playing, onPlay }) {
  const label = nameOf(name, line);
  const spray = line.image && panoramaImage(`${line.image.replace(/\.(png|psd|tga)$/i, "")}_${line.image.match(/\.(\w+)$/)?.[1]?.toLowerCase() ?? "png"}`);
  return (
    <li className="p-[6px]" style={{ width: 160, height: 174 }}>
      {/* .ChatWheelEntryContainer: the dark gradient, the line's play button and label */}
      <div className="relative flex size-full flex-col items-center border border-white/[0.015] bg-[linear-gradient(160deg,#23211f,#0b0c0f)] px-[12px] pt-[16px] pb-[12px] shadow-[0_6px_24px_-8px_rgb(0_0_0/0.8)]">
        {spray ? (
          <img src={spray} alt="" className="size-[72px] object-contain" onError={(event) => (event.currentTarget.style.visibility = "hidden")} />
        ) : line.files?.length ? (
          <button
            onClick={onPlay}
            aria-label={playing ? `Stop ${label}` : `Play ${label}`}
            className="grid size-[40px] shrink-0 place-items-center rounded-full border border-white/20 bg-gradient-to-b from-[#3a4146] to-[#1c2024] shadow-[0_4px_8px_rgb(0_0_0/0.2)] hover:brightness-200 active:translate-y-px active:brightness-50"
          >
            {playing ? <Pause className="size-[16px] text-white" /> : <Play className="ml-[2px] size-[16px] text-white" />}
          </button>
        ) : (
          <span className="size-[40px] shrink-0" />
        )}
        <span className="mt-[6px] line-clamp-3 max-h-[66px] text-center text-[15px] leading-[22px] text-[#b0bcc2]" title={line.message ?? label}>
          {label}
        </span>
      </div>
    </li>
  );
}

export default function ChatWheelLines({ modelsBase, query }) {
  const data = useChatWheel(modelsBase);
  const [playing, setPlaying] = useState(null);
  const audio = useRef(null);
  useEffect(() => () => audio.current?.pause(), []);
  if (!data) {
    return <p className="py-[32px] text-center text-[18px] text-[#8b989e]/50">Loading the chat wheel</p>;
  }
  const words = query.trim().toLowerCase();
  const play = (name, line) => {
    audio.current?.pause();
    if (playing === name) {
      setPlaying(null);
      return;
    }
    setPlaying(name);
    audio.current = playSound(SOUNDS_BASE + line.files[0], () => setPlaying((value) => (value === name ? null : value)));
  };
  const groups = data.categories
    .map((category) => [category, category.messages.filter((name) => !words || nameOf(name, data.messages[name]).toLowerCase().includes(words))])
    .filter(([, names]) => names.length);
  if (!groups.length) {
    return <p className="py-[32px] text-center text-[18px] text-[#8b989e]/50">Nothing to display</p>;
  }
  return groups.map(([category, names]) => (
    <section key={category.id} className="mb-[24px]">
      <h3 className="ml-[6px] flex items-center">
        <span className="text-[19px] leading-[24px] font-semibold tracking-[1.5px] text-[#b0bcc2] uppercase">{category.name ?? category.id}</span>
        <span className="ml-[6px] text-[16px] leading-[20px] tracking-[1px] text-[#8b989e]">({names.length})</span>
      </h3>
      <ul className="flex flex-wrap">
        {names.map((name) => (
          <Line key={name} modelsBase={modelsBase} name={name} line={data.messages[name]} playing={playing === name} onPlay={() => play(name, data.messages[name])} />
        ))}
      </ul>
    </section>
  ));
}
