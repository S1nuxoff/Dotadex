import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronDown, Search } from "lucide-react";
import { formatPrice, itemIcon, rarity } from "../catalog.js";

// Panorama lays the interface out 1080 high and scales it with the screen's height; the width is
// what the screen's shape gives, 1920 on 16:9, never under 4:3 (a narrower screen squeezes it,
// client.dll 0x18055bf2f). One zoom for both here, so a window narrower than 4:3 shrinks to fit.
export const UI_WIDTH = 1920;
export const UI_HEIGHT = 1080;
const MIN_ASPECT = 4 / 3;

// The game's classes for the screen's shape: the nearest of these ratios (client.dll table at
// 0x184f421a0; 17:9 counts as 16:9). Pages move their margins by them.
const ASPECTS = [
  [16 / 9, "16x9"],
  [17 / 9, "16x9"],
  [1.6, "16x10"],
  [4 / 3, "4x3"],
  [7 / 3, "21x9"],
];
function aspectOf(ratio) {
  return ASPECTS.reduce((best, entry) => (Math.abs(entry[0] - ratio) < Math.abs(best[0] - ratio) ? entry : best))[1];
}

function layoutFor() {
  // The page's size without the scrollbar, which a scrollbar coming or going changes too
  const { clientWidth: width, clientHeight: height } = document.documentElement;
  const scale = Math.max(Math.min(height / UI_HEIGHT, width / (UI_HEIGHT * MIN_ASPECT)), 0.5);
  return { scale, aspect: aspectOf(width / height) };
}

export function useUiLayout() {
  const [layout, setLayout] = useState(layoutFor);
  useEffect(() => {
    const observer = new ResizeObserver(() =>
      setLayout((old) => {
        const next = layoutFor();
        return next.scale === old.scale && next.aspect === old.aspect ? old : next;
      })
    );
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, []);
  return layout;
}

export function useUiScale() {
  return useUiLayout().scale;
}

// Valve's terms for fan sites ask for this wherever the game's content is shown
export const VALVE_NOTICE =
  "Dota 2 and all of its content, models, art, sounds and names are trademarks and copyright of Valve Corporation. Dotadex is a fan project, not affiliated with or endorsed by Valve.";

export function IconButton({ label, onClick, children, active, className = "" }) {
  return (
    <button
      onClick={onClick}
      data-sound="toggle"
      data-hover
      title={label}
      aria-label={label}
      className={`grid size-9 shrink-0 place-items-center rounded-lg border transition-colors ${
        active ? "border-aegis/60 bg-raised text-bone" : "border-line bg-panel/80 text-ash hover:text-bone"
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function Toggle({ options, value, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="flex rounded-lg border border-line bg-panel/80 p-0.5">
      {options.map((option) => (
        <button
          key={String(option.value)}
          onClick={() => onChange(option.value)}
          data-sound="toggle"
          aria-pressed={value === option.value}
          disabled={option.disabled}
          title={option.title}
          className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors disabled:opacity-35 ${
            value === option.value ? "bg-raised text-bone" : "text-ash hover:text-bone"
          }`}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Popover({ open, children, className = "" }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className={`absolute z-30 rounded-xl border border-line bg-panel shadow-2xl shadow-black/40 ${className}`}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Closes on a click outside or Escape
export function useDismiss(open, setOpen) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event) => !ref.current?.contains(event.target) && setOpen(false);
    const escape = (event) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open, setOpen]);
  return ref;
}

// A dropdown: options [{ value, label, icon?, hint? }], with a search box when long
export function Select({ value, options, onChange, label, placeholder, className = "", align = "left", up = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useDismiss(open, setOpen);
  const current = options.find((option) => option.value === value);
  const searchable = options.length > 12;
  const shown = searchable
    ? options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        onClick={() => setOpen(!open)}
        data-sound="click"
        data-hover
        aria-expanded={open}
        aria-label={label}
        className={`flex h-8 w-full items-center gap-1.5 rounded-lg border px-2.5 text-sm transition-colors ${
          value ? "border-aegis/40 bg-raised text-bone" : "border-line text-ash hover:text-bone"
        }`}
      >
        {current?.icon}
        <span className="truncate">{current?.label ?? placeholder}</span>
        <ChevronDown className={`ml-auto size-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <Popover
        open={open}
        className={`${up ? "bottom-10" : "top-10"} ${align === "right" ? "right-0" : "left-0"} w-60 overflow-hidden`}
      >
        {searchable && (
          <label className="flex items-center gap-2 border-b border-line px-3 py-2.5">
            <Search className="size-4 text-ash" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Find ${label.toLowerCase()}`}
              className="w-full bg-transparent text-sm text-bone placeholder:text-ash/70 focus:outline-none"
            />
          </label>
        )}
        <ul className="max-h-72 overflow-y-auto py-1 scrollbar-thin">
          {shown.map((option) => (
            <li key={String(option.value)}>
              <button
                data-sound="click"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  setQuery("");
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-raised ${
                  option.value === value ? "text-aegis" : "text-bone/90"
                }`}
              >
                {option.icon}
                <span className="truncate">{option.label}</span>
                {option.hint !== undefined && <span className="ml-auto shrink-0 text-xs text-ash tabular-nums">{option.hint}</span>}
                {option.value === value && <Check className="size-4 shrink-0" />}
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="px-3 py-3 text-sm text-ash">Nothing is called that.</li>}
        </ul>
      </Popover>
    </div>
  );
}

// A cosmetic's tile: icon over a rarity line, name, price
export function ItemCard({ item, active, onClick, caption }) {
  const color = rarity(item).color;
  const icon = itemIcon(item);
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`group relative flex flex-col overflow-hidden rounded-lg border text-left transition-colors ${
        active ? "border-aegis/70 bg-raised" : "border-line bg-stage/50 hover:border-ash/40 hover:bg-raised/60"
      }`}
    >
      <span className="relative block aspect-[256/170] bg-stage">
        {icon && (
          <img
            src={icon}
            alt=""
            loading="lazy"
            className="size-full object-contain"
            onError={(event) => (event.currentTarget.style.visibility = "hidden")}
          />
        )}
        <span className="absolute inset-x-0 bottom-0 h-[2px]" style={{ background: color }} />
      </span>
      <span className="block px-2 pt-1.5 pb-2">
        <span className="line-clamp-2 text-xs leading-snug text-bone/90">{item.name}</span>
        <span className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-ash">
          <span style={{ color }}>{caption ?? rarity(item).name}</span>
          {formatPrice(item.price) && <span className="tabular-nums">{formatPrice(item.price)}</span>}
        </span>
      </span>
    </button>
  );
}
