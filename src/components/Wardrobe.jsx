import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronLeft, ChevronRight, Layers, RotateCcw, Search, X } from "lucide-react";
import {
  SORTS,
  heroPortrait,
  heroSlots,
  personaOf,
  itemIcon,
  itemsForSlot,
  rarity,
  slotName,
  sortItems,
} from "../catalog.js";
import { ItemCard, Select } from "./ui.jsx";
import { equipSound } from "../uiSounds.js";

function SlotRow({ slot, item, isDefault, onOpen }) {
  const icon = item && itemIcon(item);
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-raised/60">
      <span className="relative h-9 w-[54px] shrink-0 overflow-hidden rounded bg-stage">
        {icon && <img src={icon} alt="" loading="lazy" className="size-full object-contain" />}
        {item && <span className="absolute inset-x-0 bottom-0 h-[2px]" style={{ background: rarity(item).color }} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-ash">{slotName(slot.slot)}</span>
        <span className={`block truncate text-sm ${isDefault ? "text-bone/70" : "text-bone"}`}>
          {item ? item.name : "Nothing"}
        </span>
      </span>
      <span className="shrink-0 text-xs text-ash tabular-nums">{slot.count || ""}</span>
      <ChevronRight className="size-4 shrink-0 text-ash" />
    </button>
  );
}

function SlotPicker({ catalog, hero, slot, equipped, onEquip, onBack }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("newest");

  const items = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const all = itemsForSlot(catalog, hero.id, slot.slot).filter((item) =>
      words.every((word) => item.name.toLowerCase().includes(word))
    );
    return sortItems(all, sort);
  }, [catalog, hero, slot, query, sort]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 pt-4 pb-3">
        <button onClick={onBack} className="grid size-8 place-items-center rounded-md text-ash hover:bg-raised hover:text-bone" aria-label="Back to slots">
          <ChevronLeft className="size-5" />
        </button>
        <div className="min-w-0">
          <p className="truncate font-display text-lg leading-tight text-bone">{slotName(slot.slot)}</p>
          <p className="text-xs text-ash">{slot.count} items for {hero.name}</p>
        </div>
      </div>
      <div className="flex gap-2 px-4 pb-3">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line px-2.5 focus-within:border-aegis/70">
          <Search className="size-3.5 shrink-0 text-ash" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            aria-label={`Search ${slotName(slot.slot)} items`}
            className="h-8 w-full bg-transparent text-sm text-bone placeholder:text-ash/70 focus:outline-none"
          />
        </label>
        <Select
          label="Sort"
          value={sort}
          onChange={setSort}
          align="right"
          className="w-28"
          options={SORTS.map((entry) => ({ value: entry.id, label: entry.name }))}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 scrollbar-thin">
        <div className="grid grid-cols-2 gap-2">
          {slot.defaultItem && (
            <ItemCard item={slot.defaultItem} caption="Default" active={!equipped} onClick={() => onEquip(slot.slot, null)} />
          )}
          {items.map((item) => (
            <ItemCard key={item.id} item={item} active={equipped?.id === item.id} onClick={() => onEquip(slot.slot, item.id)} />
          ))}
        </div>
        {items.length === 0 && (
          <p className="py-6 text-sm text-ash">
            {query ? `No ${slotName(slot.slot).toLowerCase()} item matches “${query}”.` : "No other items for this slot are exported yet."}
          </p>
        )}
      </div>
    </div>
  );
}

// Where the picture actually is in an image with transparent margins, as an object-view-box
// inset, so a render drawn off-centre (Puck flying high) sits in the middle of its card
const fits = new Map();
function useContentBox(src) {
  const [box, setBox] = useState(() => fits.get(src) ?? null);
  useEffect(() => {
    if (!src || fits.has(src)) {
      setBox(fits.get(src) ?? null);
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const size = 64;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0, size, size);
        const pixels = context.getImageData(0, 0, size, size).data;
        let top = size, left = size, bottom = -1, right = -1;
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            if (pixels[(y * size + x) * 4 + 3] > 24) {
              top = Math.min(top, y);
              bottom = Math.max(bottom, y);
              left = Math.min(left, x);
              right = Math.max(right, x);
            }
          }
        }
        // Only images with real transparent margins are trimmed, with a little air kept
        const value =
          bottom < 0 || (top < 2 && left < 2 && bottom > size - 3 && right > size - 3)
            ? null
            : `inset(${Math.max(0, top - 2) / size * 100}% ${Math.max(0, size - 1 - right - 2) / size * 100}% ${Math.max(0, size - 1 - bottom - 2) / size * 100}% ${Math.max(0, left - 2) / size * 100}%)`;
        fits.set(src, value);
        if (!cancelled) {
          setBox(value);
        }
      } catch {
        fits.set(src, null);
      }
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);
  return box;
}

// A card of the loadout grid, as the game's: the item standing tall, its name, and what
// picking it does (DEFAULT, EQUIP) or that it is worn (EQUIPPED, in a gold frame)
function LoadoutCard({ image, name, color, state, sound, onPick }) {
  const worn = state === "equipped";
  const box = useContentBox(image);
  return (
    <button
      onClick={onPick}
      data-sound={worn ? undefined : sound}
      data-hover
      className={`group relative flex flex-col overflow-hidden border text-left transition-colors ${
        worn ? "border-aegis shadow-[0_0_0_1px_var(--color-aegis)]" : "border-black/80 hover:border-ash/50"
      }`}
      style={{ background: `linear-gradient(180deg, #11141a 0%, #0b0d11 55%, ${color}33 100%)` }}
    >
      <span className="relative block aspect-[3/4] w-full">
        {image && (
          <img
            src={image}
            alt=""
            loading="lazy"
            style={box ? { objectViewBox: box } : undefined}
            className="absolute inset-0 size-full object-contain p-2 transition-transform duration-200 group-hover:scale-[1.04]"
            onError={(event) => (event.currentTarget.style.visibility = "hidden")}
          />
        )}
        <span className="absolute inset-x-0 bottom-0 h-[2px]" style={{ background: color }} />
      </span>
      <span className="line-clamp-2 min-h-[2.4em] px-2 pt-2 text-center text-sm leading-tight text-bone/90">{name}</span>
      <span
        className={`m-2 mt-1.5 py-1.5 text-center font-display text-sm tracking-[0.14em] ${
          worn
            ? "text-aegis"
            : state === "default"
            ? "text-ash"
            : "bg-gradient-to-b from-[#3a424c] to-[#252b32] text-bone shadow-[inset_0_1px_0_rgb(255_255_255/0.12)] group-hover:from-[#4a535e]"
        }`}
      >
        {worn ? "Equipped" : state === "default" ? "Default" : "Equip"}
      </span>
    </button>
  );
}

// A row of the slot column: what the slot shows now, its name and how many items it has
function LoadoutSlot({ image, name, count, active, onSelect }) {
  return (
    <button
      onClick={onSelect}
      data-sound="click"
      data-hover
      className={`relative flex w-full items-center gap-2.5 border-b border-black/60 px-2 py-2 text-left transition-colors ${
        active ? "bg-gradient-to-r from-[#2a313a] to-[#1d2228]" : "hover:bg-raised/50"
      }`}
    >
      <span className="relative size-12 shrink-0 overflow-hidden border border-black/70 bg-stage">
        {image && <img src={image} alt="" loading="lazy" className="size-full object-cover" onError={(event) => (event.currentTarget.style.visibility = "hidden")} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[13px] leading-tight ${active ? "text-bone" : "text-bone/80"}`}>{name}</span>
        <span className="block text-[11px] text-ash tabular-nums">({count})</span>
      </span>
      {active && <span className="absolute top-1/2 right-1 size-0 -translate-y-1/2 border-y-[6px] border-l-[7px] border-y-transparent border-l-bone" aria-hidden />}
    </button>
  );
}

const heroCrop = (hero) => `https://cdn.steamstatic.com/apps/dota2/images/dota_react/heroes/crops/${hero.id}.png`;

// A tile of the loadout overview, as the game draws it: the slot's name above; the picture
// filling a light steel tile with a white corner and a thin bar along the bottom
function LoadoutTile({ label, image, big, caption, onSelect }) {
  return (
    <button onClick={onSelect} data-sound="click" data-hover className={`group shrink-0 text-left ${big ? "w-52" : "w-[7.5rem]"}`}>
      <span className="block truncate pb-1.5 font-sans text-[15px] uppercase tracking-[0.08em] text-ash group-hover:text-bone">{label}</span>
      <span
        className={`relative block overflow-hidden bg-gradient-to-b from-[#232a32] to-[#151a20] shadow-[0_2px_6px_rgb(0_0_0/0.5)] ring-1 ring-black/70 transition group-hover:brightness-110 ${
          big ? "h-[calc(15rem+1.5rem+1.9rem)]" : "aspect-square"
        }`}
      >
        {image && (
          <img
            src={image}
            alt=""
            loading="lazy"
            className={`absolute inset-0 size-full transition-transform duration-200 group-hover:scale-105 ${big ? "object-contain p-2" : "object-cover"}`}
            onError={(event) => (event.currentTarget.style.visibility = "hidden")}
          />
        )}
        {!big && <span className="absolute top-0 right-0 size-0 border-t-[16px] border-l-[16px] border-t-white/80 border-l-transparent" aria-hidden />}
        <span className="absolute inset-x-0 bottom-0 h-[3px] bg-black/35" aria-hidden />
        {big && (
          <>
            {caption && <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pt-6 pb-2 text-base text-bone">{caption}</span>}
          </>
        )}
      </span>
    </button>
  );
}

export default function Wardrobe({ catalog, outfit, onEquip, onEquipSet, onReset, onClose, tiles = false }) {
  const hero = catalog.heroesById[outfit.hero];
  const slots = useMemo(() => heroSlots(catalog, hero.id, outfit.persona ?? 0), [catalog, hero, outfit.persona]);
  // Sets of the body shown: the hero's own or the persona's
  const sets = useMemo(
    () => catalog.sets.filter((set) => set.hero === hero.id && personaOf(set.items.map((id) => catalog.itemsById[id]).find(Boolean)?.slot) === (outfit.persona ?? 0)),
    [catalog, hero, outfit.persona]
  );
  // As tiles, nothing is open at first: the overview of every slot
  const [selected, setSelected] = useState(() => (tiles ? null : sets.length ? "sets" : slots[0]?.slot));
  const [query, setQuery] = useState("");
  const changed = Object.keys(outfit.slots).length > 0;
  const words = query.trim().toLowerCase();

  // The cards of what is picked in the column
  const cards = useMemo(() => {
    if (selected === "sets") {
      return sets
        .filter((set) => !words || set.name.toLowerCase().includes(words))
        .map((set) => {
          const worn = set.items.every((id) => outfit.slots[catalog.itemsById[id]?.slot]?.id === id);
          const first = catalog.itemsById[set.items[0]];
          return {
            key: set.id,
            image: set.icon ? itemIcon(set) : null,
            name: set.name,
            color: first ? rarity(first).color : "#8b96a3",
            state: worn ? "equipped" : "equip",
            sound: "equip",
            onPick: () => onEquipSet(set),
          };
        });
    }
    const slot = slots.find((entry) => entry.slot === selected);
    if (!slot) {
      return [];
    }
    const chosen = outfit.slots[slot.slot];
    const list = [];
    if (slot.defaultItem && (!words || slot.defaultItem.name.toLowerCase().includes(words))) {
      list.push({
        key: `default-${slot.slot}`,
        image: slot.defaultItem.icon ? itemIcon(slot.defaultItem) : heroCrop(hero),
        name: slot.defaultItem.name,
        color: rarity(slot.defaultItem).color,
        state: chosen ? "default" : "equipped",
        sound: "unequip",
        onPick: () => onEquip(slot.slot, null),
      });
    }
    for (const item of sortItems(itemsForSlot(catalog, hero.id, slot.slot), "newest")) {
      if (words && !item.name.toLowerCase().includes(words)) {
        continue;
      }
      list.push({
        key: item.id,
        image: itemIcon(item),
        name: item.name,
        color: rarity(item).color,
        state: chosen?.id === item.id ? "equipped" : "equip",
        sound: equipSound(slot.slot),
        onPick: () => onEquip(slot.slot, item.id),
      });
    }
    return list;
  }, [selected, sets, slots, outfit.slots, words, catalog, hero, onEquip, onEquipSet]);

  // The hero's newest sets for the store-like row, four at a time
  const newest = useMemo(() => {
    const dateOf = (set) => set.items.map((id) => catalog.itemsById[id]?.date ?? "").sort().pop() ?? "";
    return [...sets].sort((a, b) => dateOf(b).localeCompare(dateOf(a))).slice(0, 28);
  }, [sets, catalog]);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(newest.length / 4));

  // The set worn in full, if any, for the big tile
  const wornSet = sets.find((set) => set.items.every((id) => outfit.slots[catalog.itemsById[id]?.slot]?.id === id));

  if (tiles && !selected) {
    return (
      <div className="px-8 pt-5 pb-8">
        {changed && (
          <button onClick={onReset} data-sound="click" className="mb-3 inline-flex items-center gap-1.5 text-xs text-ash hover:text-bone">
            <RotateCcw className="size-3.5" /> Back to the default look
          </button>
        )}
        <div className="flex items-start gap-6">
          {sets.length > 0 && (
            <LoadoutTile
              label="Full sets"
              image={wornSet?.icon ? itemIcon(wornSet) : sets[0].icon ? itemIcon(sets[0]) : heroPortrait(hero)}
              caption={wornSet ? wornSet.name : "Default"}
              big
              onSelect={() => setSelected("sets")}
            />
          )}
          <div className="flex flex-wrap gap-x-6 gap-y-6">
            {slots.map((slot) => {
              const chosen = outfit.slots[slot.slot];
              const item = chosen ? catalog.itemsById[chosen.id] : slot.defaultItem;
              // Some default pieces have no picture in the game: the hero's portrait stands in
              const image = item?.icon ? itemIcon(item) : heroCrop(hero);
              return <LoadoutTile key={slot.slot} label={slotName(slot.slot)} image={image} onSelect={() => setSelected(slot.slot)} />;
            })}
          </div>
        </div>
        {slots.length === 0 && sets.length === 0 && (
          <p className="text-sm text-ash">{hero.name}'s items are not exported yet. They appear here as the export runs.</p>
        )}
        {newest.length > 0 && (
          <section className="mt-9">
            <div className="flex items-center gap-3">
              <h3 className="font-sans text-[15px] uppercase tracking-[0.16em] text-ash">Available</h3>
              <span className="text-sm text-ash/60">Newest sets</span>
              <span className="ml-auto flex items-center gap-2">
                {Array.from({ length: pages }, (_, index) => (
                  <span key={index} className={`size-1.5 rounded-full ${index === page ? "bg-bone" : "bg-ash/40"}`} />
                ))}
                {[
                  [-1, ChevronLeft, "Previous"],
                  [1, ChevronRight, "Next"],
                ].map(([step, Icon, label]) => (
                  <button
                    key={label}
                    onClick={() => setPage((page + step + pages) % pages)}
                    data-sound="click"
                    aria-label={label}
                    className="grid size-7 place-items-center rounded-full bg-raised text-ash hover:text-bone"
                  >
                    <Icon className="size-4" />
                  </button>
                ))}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-3">
              {newest.slice(page * 4, page * 4 + 4).map((set) => {
                const first = catalog.itemsById[set.items.find((id) => catalog.itemsById[id])];
                const look = first ? rarity(first) : null;
                return (
                  <div key={set.id} className="flex flex-col bg-black/50 p-2 ring-1 ring-black/70">
                    <div className="relative aspect-[16/11] overflow-hidden bg-gradient-to-b from-[#3a4047] to-[#22272d]">
                      {set.icon && <img src={itemIcon(set)} alt="" loading="lazy" className="absolute inset-0 size-full object-contain" />}
                    </div>
                    <p className="mt-2 truncate text-center text-[15px] text-bone">{set.name}</p>
                    <p className="text-center font-sans text-xs uppercase tracking-[0.14em]" style={{ color: look?.color }}>
                      {look ? look.name : "Set"}
                    </p>
                    <button
                      onClick={() => onEquipSet(set)}
                      data-sound="equip"
                      className="mt-2 bg-gradient-to-b from-[#3f8f63] to-[#2b6847] py-1.5 font-sans text-sm font-semibold uppercase tracking-[0.12em] text-bone shadow-[inset_0_1px_0_rgb(255_255_255/0.2)] hover:from-[#4aa673]"
                    >
                      Equip
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    );
  }

  if (tiles) {
    const title = selected === "sets" ? "Full sets" : slotName(selected);
    return (
      <div className="px-8 pt-4 pb-8">
        <div className="flex items-center gap-3">
          <button onClick={() => setSelected(null)} data-sound="back" className="inline-flex items-center gap-1 font-display text-xs tracking-[0.16em] text-ash hover:text-bone">
            <ChevronLeft className="size-4" /> Loadout
          </button>
          <span className="text-ash/35">/</span>
          <span className="font-display text-sm tracking-[0.16em] text-bone">{title}</span>
          <label className="ml-auto flex w-52 items-center gap-2 border px-2">
            <Search className="size-3.5 shrink-0 text-ash" aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              aria-label="Search the loadout"
              className="h-7 w-full bg-transparent text-sm text-bone placeholder:text-ash/70 focus:outline-none"
            />
          </label>
        </div>
        {cards.length > 0 ? (
          <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
            {cards.map(({ key, ...card }) => (
              <LoadoutCard key={key} {...card} />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-ash">{words ? `Nothing matches “${query}”.` : "No other items for this slot are exported yet."}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex items-center gap-2 border-b border-black/60 px-3 py-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 border px-2">
          <Search className="size-3.5 shrink-0 text-ash" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            aria-label="Search the loadout"
            className="h-7 w-full bg-transparent text-sm text-bone placeholder:text-ash/70 focus:outline-none"
          />
        </label>
        {changed && (
          <button onClick={onReset} className="inline-flex h-7 items-center gap-1.5 px-2 text-xs text-ash hover:text-bone" title="Back to the default look">
            <RotateCcw className="size-3.5" /> Default
          </button>
        )}
        {onClose && (
          <button onClick={onClose} className="grid size-7 place-items-center text-ash hover:text-bone" aria-label="Close the loadout">
            <X className="size-5" />
          </button>
        )}
      </div>
      {slots.length === 0 && sets.length === 0 ? (
        <p className="px-4 py-5 text-sm text-ash">{hero.name}'s items are not exported yet. They appear here as the export runs.</p>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="w-60 shrink-0 overflow-y-auto border-r border-black/60 bg-black/20 scrollbar-thin">
            {sets.length > 0 && (
              <LoadoutSlot
                image={sets[0].icon ? itemIcon(sets[0]) : heroPortrait(hero)}
                name="Full Sets"
                count={sets.length}
                active={selected === "sets"}
                onSelect={() => setSelected("sets")}
              />
            )}
            {slots.map((slot) => {
              const chosen = outfit.slots[slot.slot];
              const item = chosen ? catalog.itemsById[chosen.id] : slot.defaultItem;
              return (
                <LoadoutSlot
                  key={slot.slot}
                  image={item ? itemIcon(item) : null}
                  name={slotName(slot.slot)}
                  count={slot.count}
                  active={selected === slot.slot}
                  onSelect={() => setSelected(slot.slot)}
                />
              );
            })}
          </div>
          <div className="min-w-0 flex-1 overflow-y-auto p-2 scrollbar-thin">
            {cards.length > 0 ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
                {cards.map(({ key, ...card }) => (
                  <LoadoutCard key={key} {...card} />
                ))}
              </div>
            ) : (
              <p className="p-2 text-sm text-ash">{words ? `Nothing matches “${query}”.` : "No other items for this slot are exported yet."}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
