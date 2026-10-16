import { useMemo, useState } from "react";
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

// A card of the loadout grid, as the game's: the item standing tall, its name, and what
// picking it does (DEFAULT, EQUIP) or that it is worn (EQUIPPED, in a gold frame)
function LoadoutCard({ image, name, color, state, sound, onPick }) {
  const worn = state === "equipped";
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
            className="absolute inset-0 size-full object-contain p-2 transition-transform duration-200 group-hover:scale-[1.04]"
            onError={(event) => (event.currentTarget.style.visibility = "hidden")}
          />
        )}
        <span className="absolute inset-x-0 bottom-0 h-[2px]" style={{ background: color }} />
      </span>
      <span className="line-clamp-2 min-h-[2.4em] px-1.5 pt-1.5 text-center text-xs leading-tight text-bone/90">{name}</span>
      <span
        className={`m-1.5 mt-1 py-1 text-center font-display text-[11px] tracking-[0.14em] ${
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

export default function Wardrobe({ catalog, outfit, onEquip, onEquipSet, onReset, onClose }) {
  const hero = catalog.heroesById[outfit.hero];
  const slots = useMemo(() => heroSlots(catalog, hero.id, outfit.persona ?? 0), [catalog, hero, outfit.persona]);
  // Sets of the body shown: the hero's own or the persona's
  const sets = useMemo(
    () => catalog.sets.filter((set) => set.hero === hero.id && personaOf(set.items.map((id) => catalog.itemsById[id]).find(Boolean)?.slot) === (outfit.persona ?? 0)),
    [catalog, hero, outfit.persona]
  );
  const [selected, setSelected] = useState(() => (sets.length ? "sets" : slots[0]?.slot));
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
        image: itemIcon(slot.defaultItem),
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
