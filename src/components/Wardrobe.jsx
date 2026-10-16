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

export default function Wardrobe({ catalog, outfit, onEquip, onEquipSet, onReset, onClose }) {
  const [openSlot, setOpenSlot] = useState(null);
  const reduce = useReducedMotion();
  const hero = catalog.heroesById[outfit.hero];
  const slots = useMemo(() => heroSlots(catalog, hero.id, outfit.persona ?? 0), [catalog, hero, outfit.persona]);
  // Sets of the body shown: the hero's own or the persona's
  const sets = useMemo(
    () => catalog.sets.filter((set) => set.hero === hero.id && personaOf(set.items.map((id) => catalog.itemsById[id]).find(Boolean)?.slot) === (outfit.persona ?? 0)),
    [catalog, hero, outfit.persona]
  );
  const changed = Object.keys(outfit.slots).length > 0;
  const picking = slots.find((slot) => slot.slot === openSlot);

  const slide = (direction) =>
    reduce
      ? { initial: false, animate: { opacity: 1 }, exit: { opacity: 0 } }
      : {
          initial: { opacity: 0, x: 24 * direction },
          animate: { opacity: 1, x: 0 },
          exit: { opacity: 0, x: -24 * direction },
          transition: { duration: 0.2, ease: "easeOut" },
        };

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-panel">
      <AnimatePresence mode="wait" initial={false}>
        {picking ? (
          <motion.div key={`slot-${picking.slot}`} className="h-full" {...slide(1)}>
            <SlotPicker
              catalog={catalog}
              hero={hero}
              slot={picking}
              equipped={outfit.slots[picking.slot]}
              onEquip={onEquip}
              onBack={() => setOpenSlot(null)}
            />
          </motion.div>
        ) : (
          <motion.div key="slots" className="flex h-full flex-col" {...slide(-1)}>
            <div className="flex items-center gap-3 px-4 pt-5 pb-3">
              <img src={heroPortrait(hero)} alt="" className="h-9 w-[54px] rounded object-cover" />
              <div className="min-w-0 flex-1">
                <p className="font-display text-lg leading-tight text-bone">Wardrobe</p>
                <p className="truncate text-xs text-ash">What {hero.name} wears</p>
              </div>
              {changed && (
                <button
                  onClick={onReset}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs text-ash hover:text-bone"
                >
                  <RotateCcw className="size-3.5" /> Default
                </button>
              )}
              {onClose && (
                <button onClick={onClose} className="grid size-8 place-items-center rounded-md text-ash hover:text-bone" aria-label="Close the wardrobe">
                  <X className="size-5" />
                </button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pb-4 scrollbar-thin">
              {slots.length === 0 && (
                <p className="border-t border-line px-4 py-5 text-sm text-ash">
                  {hero.name}'s items are not exported yet. They appear here as the export runs.
                </p>
              )}
              <ul className={slots.length ? "border-y border-line py-1" : "hidden"}>
                {slots.map((slot) => {
                  const chosen = outfit.slots[slot.slot];
                  const item = chosen ? catalog.itemsById[chosen.id] : slot.defaultItem;
                  return (
                    <li key={slot.slot}>
                      <SlotRow slot={slot} item={item} isDefault={!chosen} onOpen={() => setOpenSlot(slot.slot)} />
                    </li>
                  );
                })}
              </ul>

              {sets.length > 0 && (
                <section className="pt-4">
                  <h3 className="flex items-center gap-2 px-4 pb-2 text-sm text-bone">
                    <Layers className="size-4 text-ash" /> Sets
                    <span className="text-xs text-ash tabular-nums">{sets.length}</span>
                  </h3>
                  <ul>
                    {sets.map((set) => {
                      const worn = set.items.every((id) => {
                        const item = catalog.itemsById[id];
                        return outfit.slots[item.slot]?.id === id;
                      });
                      return (
                        <li key={set.id}>
                          <button
                            onClick={() => onEquipSet(set)}
                            className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-raised/60 ${worn ? "bg-raised" : ""}`}
                          >
                            <span className="h-9 w-[54px] shrink-0 overflow-hidden rounded bg-stage">
                              {set.icon && (
                                <img
                                  src={itemIcon(set)}
                                  alt=""
                                  loading="lazy"
                                  className="size-full object-cover"
                                  onError={(event) => (event.currentTarget.style.visibility = "hidden")}
                                />
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className={`block truncate text-sm ${worn ? "text-aegis" : "text-bone/90"}`}>{set.name}</span>
                              <span className="block text-xs text-ash">{set.items.length} items</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
