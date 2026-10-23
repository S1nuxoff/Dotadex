import { useEffect, useRef, useState } from "react";
import { fetchData } from "../fetchData.js";

// The game's emoticons (scripts/emoticons.txt, data/emoticons.json in the dataset): each picture
// is a strip of square frames, played at its ms_per_frame

let loading = null;
export function useEmoticons(modelsBase) {
  const [emoticons, setEmoticons] = useState(null);
  useEffect(() => {
    let cancelled = false;
    loading ??= fetchData(`${modelsBase}data/emoticons.json`)
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}));
    loading.then((data) => !cancelled && setEmoticons(data));
    return () => {
      cancelled = true;
    };
  }, [modelsBase]);
  return emoticons;
}

// One emoticon (DOTAEmoticon): its frames counted from the strip's width, shown one after another;
// its picture loads once it comes into view (the Armory lists some two thousand)
export function Emoticon({ modelsBase, emoticon, size = 32 }) {
  const url = `${modelsBase}${emoticon.image}`;
  const [frames, setFrames] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    let image = null;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || image) return;
      observer.disconnect();
      image = new Image();
      image.onload = () => setFrames(Math.max(1, Math.round(image.naturalWidth / image.naturalHeight)));
      image.src = url;
    }, { rootMargin: "200px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [url]);
  const alias = emoticon.aliases?.[0];
  const duration = frames * (Number(emoticon.ms_per_frame) || 100);
  return (
    <span
      ref={ref}
      role="img"
      aria-label={alias ? `:${alias}:` : "Emoticon"}
      title={alias ? `:${alias}:` : undefined}
      className="m-[4px] inline-block shrink-0 bg-no-repeat transition-transform duration-200 hover:scale-[1.2]"
      style={{
        width: size,
        height: size,
        backgroundImage: frames ? `url(${url})` : undefined,
        backgroundSize: `${frames * 100}% 100%`,
        animation: frames > 1 ? `emoticon-strip ${duration}ms steps(${frames}, jump-none) infinite` : undefined,
      }}
    />
  );
}

// The emoticons with ids from..to, in order
export function emoticonRange(emoticons, [from, to]) {
  return Object.entries(emoticons ?? {})
    .filter(([id]) => Number(id) >= from && Number(id) <= to)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([id, emoticon]) => ({ id, ...emoticon }));
}

// The Emoticons category's #EmoticonsContent over its items: every emoticon (the game shows the
// player's unlocked ones), in order of id
export function EmoticonsContent({ modelsBase }) {
  const emoticons = useEmoticons(modelsBase);
  const list = Object.entries(emoticons ?? {}).sort(([a], [b]) => Number(a) - Number(b));
  return (
    <div className="flex max-h-[232px] shrink-0 items-start border-b border-white/[0.04] px-[12px] py-[8px]">
      <p className="mt-[10px] shrink-0 text-[18px] text-[#8b989e]">Emoticons:</p>
      <div className="mx-[12px] flex min-h-0 flex-1 flex-wrap self-stretch overflow-y-auto scrollbar-thin">
        {emoticons === null ? null : list.length ? (
          list.map(([id, emoticon]) => <Emoticon key={id} modelsBase={modelsBase} emoticon={emoticon} />)
        ) : (
          <p className="mt-[10px] text-[18px] text-[#8b989e]/50">Not in the dataset yet</p>
        )}
      </div>
    </div>
  );
}
