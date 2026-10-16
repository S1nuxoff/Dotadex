import { Fragment, useEffect, useState } from "react";
import { Code2, Database } from "lucide-react";
import { LANGUAGES } from "../gamedata.js";
import { Popover, Select, UI_WIDTH as WIDTH, useDismiss, useUiScale } from "./ui.jsx";
import { useMenuMusic, VolumeSliders } from "./Music.jsx";
import { getVolume, onVolume, setVolume } from "../volume.js";

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

// The game's top bar is laid out for a 1920 wide screen and scaled with it; so is this one.
// Everything below is in the game's own pixels, from its dashboard stylesheet and images.
const UI = "/Dotadex/ui/topbar/";
// Where the separators between the tabs cross the middle of the bar, and the room between them
const TAB_LEFT = 386.85;
const TAB_PITCH = 164.65;
// The bar's own picture has five tabs; the separators of any past those are drawn on
const BAR_TABS = 5;

// A flat icon in the bar, tinted as the game washes its icons: dark slate, lighter on hover
function MaskIcon({ src, size, className = "" }) {
  return (
    <span
      aria-hidden
      className={`block bg-current ${className}`}
      style={{ width: size[0], height: size[1], mask: `url(${src}) center / contain no-repeat`, WebkitMask: `url(${src}) center / contain no-repeat` }}
    />
  );
}

function BarButton({ label, onClick, disabled, className = "", children, ...rest }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      data-sound="click"
      className={`grid place-items-center text-[#444a55] transition-colors duration-200 ease-out enabled:hover:text-[#9999aa] enabled:active:text-[#ddddff] disabled:text-[#111111] ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

// One of the slanted buttons on the right, with the game's soft light over it on hover
function RightButton({ label, center, hover, href, onClick, children }) {
  const Tag = href ? "a" : "button";
  return (
    <Tag
      href={href}
      target={href ? "_blank" : undefined}
      rel={href ? "noreferrer" : undefined}
      onClick={onClick}
      title={label}
      aria-label={label}
      data-sound="click"
      className="group absolute top-0 grid h-[61px] w-[76px] place-items-center"
      style={{ right: center - 38 }}
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute top-[-3px] left-1/2 -translate-x-1/2 bg-[length:100%_100%] opacity-0 transition-opacity duration-200 ${
          hover === "exit" ? "h-[60px] w-[77px] group-hover:opacity-100" : "h-[70px] w-[85px] group-hover:opacity-15"
        }`}
        style={{ backgroundImage: `url(${UI}${hover === "exit" ? "exit_hover" : "hover"}.png)` }}
      />
      <span className="relative transition-[filter] duration-200 group-hover:brightness-200">{children}</span>
    </Tag>
  );
}

function SettingsMenu({ language, onLanguage }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, setOpen);
  return (
    <div ref={ref} className="relative">
      <BarButton label="Settings" onClick={() => setOpen(!open)} className={`h-[57px] w-[32px] ${open ? "text-[#9999aa]" : ""}`}>
        <MaskIcon src={`${UI}gear.png`} size={[27, 27]} />
      </BarButton>
      <Popover open={open} className="top-[54px] left-0 w-72 space-y-4 p-4 text-left">
        <div>
          <span className="mb-1 block text-xs text-ash">Language</span>
          <Select
            label="Language"
            value={language}
            onChange={onLanguage}
            className="w-full"
            options={LANGUAGES.map(([value, label]) => ({ value, label }))}
          />
        </div>
        <VolumeSliders />
      </Popover>
    </div>
  );
}

function useMuted() {
  const [levels, setLevels] = useState(getVolume);
  useEffect(() => onVolume(setLevels), []);
  const muted = levels.master <= 0;
  const toggle = () => (muted ? setVolume({ master: levels.unmuted || 0.9 }) : setVolume({ master: 0, unmuted: levels.master }));
  return [muted, toggle];
}

export default function TopNav({ catalog, tab, onTab, onSection, onHome, onBack, onForward, canBack, canForward, onRandom, language, onLanguage }) {
  useMenuMusic(catalog.modelsBase);
  const [muted, toggleMute] = useMuted();
  const scale = useUiScale();
  const width = Math.max(WIDTH, document.documentElement.clientWidth / scale);
  const section = sectionOf(tab);
  const active = SECTIONS.findIndex((entry) => entry.id === section.id);
  const dataset = catalog.modelsBase.split("/datasets/")[1]?.split("/resolve")[0];

  return (
    <header className="relative z-30 shrink-0 overflow-x-clip">
      {/* The bar, its shadow and the glow of the open tab hang below it, over the page */}
      <div className="relative" style={{ height: 61 * scale }}>
        <div className="absolute top-0 left-0 h-[164px] origin-top-left" style={{ width, transform: `scale(${scale})` }}>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: `url(${UI}bar.webp) 0 0 / 1920px 164px no-repeat, url(${UI}tail.png) 0 0 / 1px 164px repeat-x` }}
          />
          {SECTIONS.map((entry, index) => (
            <div
              key={entry.id}
              aria-hidden
              className={`pointer-events-none absolute top-0 h-[116px] w-[511px] bg-[length:100%_100%] transition-opacity duration-300 ${index === active ? "opacity-100" : "opacity-0"}`}
              style={{ left: TAB_LEFT + TAB_PITCH * index - 172.5, backgroundImage: `url(${UI}lit.webp)` }}
            />
          ))}
          {SECTIONS.slice(BAR_TABS).map((entry, index) => (
            <div
              key={entry.id}
              aria-hidden
              className="pointer-events-none absolute top-0 h-[61px] w-[50px] bg-[length:100%_100%]"
              style={{ left: TAB_LEFT + TAB_PITCH * (BAR_TABS + 1 + index) - 27.65, backgroundImage: `url(${UI}separator.png)` }}
            />
          ))}
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 right-0 h-[61px] w-[350px] bg-[length:350px_61px] bg-no-repeat"
            style={{ backgroundImage: `url(${UI}right.png)` }}
          />

          {/* Settings, then back and forward */}
          <div className="absolute top-0 left-[62px] flex h-[61px] items-center">
            <SettingsMenu language={language} onLanguage={onLanguage} />
            <span aria-hidden className="ml-[16px] h-[36px] w-[2px] border-r border-l border-r-[#66666622] border-l-black" />
            <div className="ml-[10px] flex">
              <BarButton label="Back" onClick={onBack} disabled={!canBack} className="h-[57px] w-[24px]">
                <MaskIcon src={`${UI}back.png`} size={[18, 28]} />
              </BarButton>
              <BarButton label="Forward" onClick={onForward} disabled={!canForward} className="h-[57px] w-[24px]">
                <MaskIcon src={`${UI}forward.png`} size={[18, 28]} />
              </BarButton>
            </div>
          </div>

          {/* The Dota logo, home to the hero grid */}
          <button onClick={onHome} data-sound="toptab" aria-label="Dotadex, all heroes" title="Dotadex" className="group absolute top-[-3px] left-[188px] h-[80px] w-[200px]">
            <span
              aria-hidden
              className="pointer-events-none absolute top-[3px] left-[48px] h-[86px] w-[108px] bg-[length:100%_100%] opacity-0 transition-opacity duration-200 group-hover:opacity-100"
              style={{ backgroundImage: `url(${UI}logo_hover.png)` }}
            />
          </button>

          <nav aria-label="Sections">
            {SECTIONS.map((entry, index) => (
              <button
                key={entry.id}
                onClick={() => onSection(entry)}
                data-sound="toptab"
                aria-current={index === active ? "page" : undefined}
                className="topbar-tab absolute top-0 h-[60px] font-display"
                style={{ left: TAB_LEFT + TAB_PITCH * index, width: TAB_PITCH }}
              >
                <span>{entry.name}</span>
              </button>
            ))}
          </nav>

          <RightButton label="The models on Hugging Face" center={1920 - 1661} href={`https://huggingface.co/datasets/${dataset}`}>
            <Database className="size-[26px] text-[#8b95a3]" strokeWidth={1.75} />
          </RightButton>
          <RightButton label="Source on GitHub" center={1920 - 1741} href="https://github.com/S1nuxoff/Dotadex">
            <Code2 className="size-[28px] text-[#8b95a3]" strokeWidth={1.75} />
          </RightButton>
          <RightButton label="A random hero" center={1920 - 1815} onClick={onRandom}>
            <MaskIcon src={`${UI}randomize.svg`} size={[30, 30]} className="text-[#e3b54f]" />
          </RightButton>
          <RightButton label={muted ? "Sound on" : "Sound off"} center={1920 - 1888} hover="exit" onClick={toggleMute}>
            <MaskIcon src={`${UI}quit.png`} size={[28, 28]} className={muted ? "text-[#6b3a22]" : "text-[#bd5e2d] group-hover:text-[#ff6e41]"} />
          </RightButton>
        </div>
      </div>

      {section.tabs.length > 1 && (
        <div className="flex items-center justify-center gap-4 bg-[#0c0f13] pt-3 pb-2.5">
          <Slashed items={section.tabs} active={tab} onPick={onTab} className="font-sans text-[15px] uppercase tracking-[0.2em]" />
        </div>
      )}
    </header>
  );
}
