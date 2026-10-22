import { Fragment, useEffect, useState } from "react";
import { Code2, Database } from "lucide-react";
import { LANGUAGES } from "../gamedata.js";
import { Popover, Select, useDismiss, useUiScale, VALVE_NOTICE } from "./ui.jsx";
import { useMenuMusic, VolumeSliders } from "./Music.jsx";
import { getVolume, onVolume, setVolume } from "../volume.js";
import { getViewSettings, onViewSettings, setViewSettings } from "../viewSettings.js";

// The sections across the top, as the game's dashboard has them, and the pages of each below
export const SECTIONS = [
  { id: "heroes", name: "Heroes", tabs: [["heroes", "Heroes"]] },
  // The game's Armory: its own tabs (Hero, World, Treasury, All Items) are on its page
  { id: "armory", name: "Armory", tabs: [["armory", "Armory"]] },
  { id: "items", name: "Items", tabs: [["shop", "Items"]] },
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

// The distance between the slanted slots of right.png
const RIGHT_PITCH = 75;

// Ko-fi's cup (simple-icons, CC0)
function KofiIcon({ className }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M11.351 2.715c-2.7 0-4.986.025-6.83.26C2.078 3.285 0 5.154 0 8.61c0 3.506.182 6.13 1.585 8.493 1.584 2.701 4.233 4.182 7.662 4.182h.83c4.209 0 6.494-2.234 7.637-4a9.5 9.5 0 0 0 1.091-2.338C21.792 14.688 24 12.22 24 9.208v-.415c0-3.247-2.13-5.507-5.792-5.87-1.558-.156-2.65-.208-6.857-.208m0 1.947c4.208 0 5.09.052 6.571.182 2.624.311 4.13 1.584 4.13 4v.39c0 2.156-1.792 3.844-3.87 3.844h-.935l-.156.649c-.208 1.013-.597 1.818-1.039 2.546-.909 1.428-2.545 3.064-5.922 3.064h-.805c-2.571 0-4.831-.883-6.078-3.195-1.09-2-1.298-4.155-1.298-7.506 0-2.181.857-3.402 3.012-3.714 1.533-.233 3.559-.26 6.39-.26m6.547 2.287c-.416 0-.65.234-.65.546v2.935c0 .311.234.545.65.545 1.324 0 2.051-.754 2.051-2s-.727-2.026-2.052-2.026m-10.39.182c-1.818 0-3.013 1.48-3.013 3.142 0 1.533.858 2.857 1.949 3.897.727.701 1.87 1.429 2.649 1.896a1.47 1.47 0 0 0 1.507 0c.78-.467 1.922-1.195 2.623-1.896 1.117-1.039 1.974-2.364 1.974-3.897 0-1.662-1.247-3.142-3.039-3.142-1.065 0-1.792.545-2.338 1.298-.493-.753-1.246-1.298-2.312-1.298" />
    </svg>
  );
}

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
        <SettingToggle name="freeCamera" label="Free camera" hint="Turn, zoom and pan on hero pages" />
        <SettingToggle name="particles" label="Particles" hint="The game's effects on heroes and items" />
        <p className="border-t border-line pt-3 text-[11px] leading-snug text-ash/80">{VALVE_NOTICE}</p>
      </Popover>
    </div>
  );
}

// A switch of the view settings kept on this device
function SettingToggle({ name, label, hint }) {
  const [on, setOn] = useState(() => getViewSettings()[name]);
  useEffect(() => onViewSettings((settings) => setOn(settings[name])), [name]);
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-xs text-ash">
      <span>
        {label}
        <span className="block text-[11px] text-ash/60">{hint}</span>
      </span>
      <input type="checkbox" checked={on} onChange={(event) => setViewSettings({ [name]: event.target.checked })} className="size-4 accent-[#c5dcff]" />
    </label>
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
  // The bar spans the screen in the game's pixels: 1920 on 16:9, less on a narrower screen, its
  // right end kept at the right
  const width = document.documentElement.clientWidth / scale;
  const section = sectionOf(tab);
  const active = SECTIONS.findIndex((entry) => entry.id === section.id);
  const dataset = catalog.modelsBase.split("/datasets/")[1]?.split("/resolve")[0];

  return (
    <header className="relative z-30 shrink-0 overflow-x-clip">
      {/* The bar, its shadow and the glow of the open tab hang below it, over the page */}
      <div className="relative" style={{ height: 61 * scale }}>
        <div className="pointer-events-none absolute top-0 left-0 h-[164px] origin-top-left [&>:not([aria-hidden])]:pointer-events-auto" style={{ width, transform: `scale(${scale})` }}>
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
          {/* The bar's four slanted slots, and a fifth left of them: the same picture one slot
              further left, under it, so only its first slot shows */}
          {[RIGHT_PITCH, 0].map((shift) => (
            <div
              key={shift}
              aria-hidden
              className="pointer-events-none absolute top-0 h-[61px] w-[350px] bg-[length:350px_61px] bg-no-repeat"
              style={{ right: shift, backgroundImage: `url(${UI}right.png)` }}
            />
          ))}

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

          <RightButton label="Support Dotadex on Ko-fi" center={1920 - 1661 + RIGHT_PITCH} href="https://ko-fi.com/s1nuxoff">
            <KofiIcon className="size-[28px] text-[#8b95a3]" />
          </RightButton>
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
