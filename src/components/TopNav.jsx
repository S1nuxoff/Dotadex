import { Fragment } from "react";
import { ExternalLink } from "lucide-react";
import { LANGUAGES } from "../gamedata.js";
import { Select } from "./ui.jsx";
import SoundSettings from "./Music.jsx";

// The sections across the top, as the game's dashboard has them, and the pages of each below
export const SECTIONS = [
  { id: "heroes", name: "Heroes", tabs: [["heroes", "Heroes"]] },
  {
    id: "cosmetics",
    name: "Cosmetics",
    tabs: [
      ["wearable", "Cosmetics"],
      ["sets", "Sets"],
      ["courier", "Couriers"],
      ["ward", "Wards"],
      ["other", "Other"],
    ],
  },
  { id: "items", name: "Items", tabs: [["shop", "Items"]] },
  { id: "treasures", name: "Treasures", tabs: [["treasures", "Treasures"]] },
  {
    id: "music",
    name: "Music",
    tabs: [
      ["music", "Music packs"],
      ["announcers", "Announcers"],
    ],
  },
  { id: "scenes", name: "Scenes", tabs: [["scenes", "Scenes"]] },
];

export function sectionOf(tab) {
  return SECTIONS.find((section) => section.tabs.some(([id]) => id === tab)) ?? SECTIONS[0];
}

function Slashed({ items, active, onPick, className }) {
  return items.map(([id, label], index) => (
    <Fragment key={id}>
      {index > 0 && (
        <span className="text-ash/35" aria-hidden>
          /
        </span>
      )}
      <button
        onClick={() => onPick(id)}
        data-sound="toptab"
        aria-pressed={active === id}
        className={`${className} transition-colors ${active === id ? "text-bone [text-shadow:0_0_14px_rgb(255_255_255/0.3)]" : "text-ash/70 hover:text-bone"}`}
      >
        {label}
      </button>
    </Fragment>
  ));
}

export default function TopNav({ catalog, tab, onTab, onSection, language, onLanguage }) {
  const section = sectionOf(tab);
  return (
    <header className="shrink-0 border-b border-black/70 bg-gradient-to-b from-[#1b2129] to-[#11151b] shadow-[inset_0_-1px_0_rgb(255_255_255/0.04)]">
      <div className="flex h-14 items-center gap-6 px-5">
        <span className="font-display text-xl tracking-[0.12em] text-bone">Dotadex</span>
        <nav className="flex h-full items-stretch" aria-label="Sections">
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              onClick={() => onSection(entry)}
              data-sound="toptab"
              className={`relative px-5 font-sans text-[17px] font-semibold uppercase tracking-[0.16em] transition-colors ${
                entry.id === section.id ? "text-bone" : "text-ash/70 hover:text-bone"
              }`}
            >
              {entry.name}
              {entry.id === section.id && (
                <span className="absolute inset-x-3 bottom-0 h-[2px] bg-gradient-to-r from-transparent via-[#9ec6ff] to-transparent" aria-hidden />
              )}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-4 text-xs text-ash">
          <SoundSettings modelsBase={catalog.modelsBase} />
          <Select
            label="Language"
            value={language}
            onChange={onLanguage}
            align="right"
            className="w-40"
            options={LANGUAGES.map(([value, label]) => ({ value, label }))}
          />
          <a
            href={`https://huggingface.co/datasets/${catalog.modelsBase.split("/datasets/")[1]?.split("/resolve")[0]}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:text-bone"
          >
            Dataset <ExternalLink className="size-3" aria-hidden />
          </a>
        </div>
      </div>
      {section.tabs.length > 1 && (
        <div className="flex items-center justify-center gap-4 pb-2.5">
          <Slashed items={section.tabs} active={tab} onPick={onTab} className="font-sans text-[15px] uppercase tracking-[0.2em]" />
        </div>
      )}
    </header>
  );
}
