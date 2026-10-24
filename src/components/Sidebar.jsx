import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ExternalLink, Search, SlidersHorizontal, X } from "lucide-react";
import {
  HERO_COLOR,
  RARITIES,
  SORTS,
  TABS,
  formatPrice,
  heroPortrait,
  itemIcon,
  rarity,
  slotName,
  sortItems,
} from "../catalog.js";
import { Select } from "./ui.jsx";
import { LANGUAGES } from "../gamedata.js";
import { DATASETS, datasetPage, panoramaImage } from "../datasets.js";

const ANY = "";

// Rows of the list for the current tab and filters
function rowsFor(catalog, tab, filters) {
  if (tab === "heroes") {
    return catalog.heroes.map((hero) => ({
      key: `hero/${hero.id}`,
      route: { type: "hero", id: hero.id },
      name: hero.name,
      detail: `${(catalog.itemsByHero[hero.id] ?? []).filter((item) => !item.default).length} cosmetics`,
      color: HERO_COLOR,
      image: heroPortrait(hero),
      wide: true,
    }));
  }

  if (tab === "shop") {
    return catalog.shop.map((item) => ({
      key: `shop/${item.id}`,
      route: { type: "shop", id: item.id },
      name: item.name,
      detail: item.neutral ? "Neutral item" : item.cost ? `${item.cost} gold` : "Item",
      color: "#c9a45c",
      image: panoramaImage(`items/${item.texture}_png`),
      wide: true,
    }));
  }

  if (tab === "scenes") {
    return catalog.scenes.map((scene) => ({
      key: `scene/${scene.id}`,
      route: { type: "scene", id: scene.id },
      name: scene.name,
      detail: `${scene.id.split("/").slice(0, -1).join(" / ") || "map"}, ${(scene.size / 1e6).toFixed(0)} MB`,
      color: "#6fa8dc",
      image: null,
    }));
  }

  if (tab === "music" || tab === "announcers") {
    return catalog.audio.filter((pack) => pack.kind === tab).map((pack) => ({
      key: `audio/${pack.id}`,
      route: { type: "audio", id: pack.id },
      name: pack.name,
      detail: pack.kind === "announcers" ? `Announcer, ${pack.count} lines` : `Music, ${pack.count} tracks`,
      color: pack.kind === "announcers" ? "#c58bf0" : "#c9a45c",
      image: null,
    }));
  }

  if (tab === "treasures") {
    return catalog.treasures.map((treasure) => ({
      key: `treasure/${treasure.id}`,
      route: { type: "treasure", id: treasure.id },
      name: treasure.name,
      detail: `${treasure.tiers.reduce((sum, tier) => sum + tier.length, 0)} items${treasure.date ? `, ${treasure.date.slice(0, 4)}` : ""}`,
      color: rarity(treasure).color,
      image: itemIcon(treasure),
    }));
  }

  if (tab === "sets") {
    return catalog.sets
      .filter((set) => !filters.hero || set.hero === filters.hero)
      .map((set) => {
        const items = set.items.map((id) => catalog.itemsById[id]);
        return {
          key: `set/${set.id}`,
          route: {
            type: "hero",
            id: set.hero,
            slots: Object.fromEntries(items.map((item) => [item.slot, { id: item.id, style: 0 }])),
          },
          name: set.name,
          detail: `${catalog.heroNames[set.hero]}, ${items.length} items`,
          color: rarity(items[0]).color,
          image: itemIcon(set),
          wide: true,
          disabled: !catalog.heroesById[set.hero],
        };
      });
  }

  const items = catalog.items.filter(
    (item) =>
      item.kind === tab &&
      !item.default &&
      (!filters.hero || item.hero === filters.hero) &&
      (!filters.slot || item.slot === filters.slot) &&
      (!filters.rarity || item.rarity === filters.rarity)
  );
  return sortItems(items, filters.sort).map((item) => ({
    key: `item/${item.id}`,
    route: { type: "item", id: item.id },
    name: item.name,
    detail: item.hero ? `${catalog.heroNames[item.hero]}, ${slotName(item.slot).toLowerCase()}` : rarity(item).name,
    price: formatPrice(item.price),
    color: rarity(item).color,
    image: itemIcon(item),
  }));
}

function isActive(row, route) {
  if (!route) {
    return false;
  }
  if (row.key.startsWith("set/")) {
    return (
      route.type === "hero" &&
      route.id === row.route.id &&
      Object.keys(row.route.slots).every((slot) => route.slots?.[slot]?.id === row.route.slots[slot].id)
    );
  }
  return `${route.type}/${route.id}` === row.key;
}

// embedded: under the top bar, which carries the title, the sections and the language
export default function Sidebar({ catalog, tab, onTab, route, onOpen, language, onLanguage, onPrefetch, embedded = false }) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({ hero: ANY, slot: ANY, rarity: ANY, sort: "newest" });
  const [showFilters, setShowFilters] = useState(false);
  const scrollRef = useRef(null);
  const setFilter = (key) => (value) => setFilters((current) => ({ ...current, [key]: value }));

  const counts = useMemo(() => {
    const result = { heroes: catalog.heroes.length, sets: catalog.sets.length, shop: catalog.shop.length, treasures: catalog.treasures.length, music: catalog.audio.filter((pack) => pack.kind === "music").length, announcers: catalog.audio.filter((pack) => pack.kind === "announcers").length, scenes: catalog.scenes.length };
    for (const item of catalog.items) {
      if (!item.default) {
        result[item.kind] = (result[item.kind] ?? 0) + 1;
      }
    }
    return result;
  }, [catalog]);

  const heroOptions = useMemo(() => {
    const heroes = [...new Set(catalog.items.filter((item) => item.hero).map((item) => item.hero))];
    return [
      { value: ANY, label: "Any hero" },
      ...heroes.map((id) => ({ value: id, label: catalog.heroNames[id] })).sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [catalog]);

  const slotOptions = useMemo(() => {
    const slots = new Map();
    for (const item of catalog.items) {
      if (item.slot && !item.default && (!filters.hero || item.hero === filters.hero)) {
        slots.set(item.slot, (slots.get(item.slot) ?? 0) + 1);
      }
    }
    return [
      { value: ANY, label: "Any slot" },
      ...[...slots].sort((a, b) => b[1] - a[1]).map(([slot, count]) => ({ value: slot, label: slotName(slot), hint: count })),
    ];
  }, [catalog, filters.hero]);

  const rarityOptions = [
    { value: ANY, label: "Any rarity" },
    ...Object.entries(RARITIES)
      .filter(([id]) => id !== "default")
      .map(([id, entry]) => ({
        value: id,
        label: entry.name,
        icon: <span className="size-2 shrink-0 rounded-full" style={{ background: entry.color }} />,
      })),
  ];

  const rows = useMemo(() => {
    const all = rowsFor(catalog, tab, filters);
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return all;
    }
    return all.filter((row) => {
      const text = `${row.name} ${row.detail}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }, [catalog, tab, filters, query]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 56,
    overscan: 12,
  });

  const ready = catalog.heroes.length + catalog.items.length;
  const filterable = !["heroes", "shop", "treasures", "music", "announcers", "scenes"].includes(tab);
  const activeFilters = [filters.hero, tab === "wearable" && filters.slot, tab !== "sets" && filters.rarity].filter(Boolean).length;

  return (
    <aside className="flex h-full flex-col bg-panel">
      <div className={embedded ? "px-5 pt-4" : "px-5 pt-6 pb-4"}>
        {!embedded && (
          <>
            <h1 className="font-display text-[1.9rem] leading-none text-bone">Dotadex</h1>
            <p className="mt-1.5 text-sm text-aegis">The complete Dota 2 encyclopedia, in 3D</p>
            <p className="mt-2 text-sm text-ash">Every Dota 2 hero, cosmetic, courier and ward from the game files, shown with Dota's hero shading.</p>
          </>
        )}
        {!embedded && ready < catalog.total && (
          <div className="mt-3">
            <div className="h-1 overflow-hidden rounded-full bg-line" aria-hidden>
              <div className="h-full rounded-full bg-aegis transition-[width] duration-700" style={{ width: `${(ready / catalog.total) * 100}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-ash">
              {ready.toLocaleString("en")} of {catalog.total.toLocaleString("en")} ready. New ones appear as they are exported.
            </p>
          </div>
        )}
      </div>

      <div className="flex gap-2 px-5">
        <label className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-line bg-stage/60 px-3 py-2 transition-colors focus-within:border-aegis/70">
          <Search className="size-4 shrink-0 text-ash" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by item or hero"
            className="w-full bg-transparent text-sm text-bone placeholder:text-ash/70 focus:outline-none"
            aria-label="Search models"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-ash hover:text-bone" aria-label="Clear search">
              <X className="size-4" />
            </button>
          )}
        </label>
        {filterable && (
          <button
            onClick={() => setShowFilters(!showFilters)}
            aria-expanded={showFilters}
            aria-label="Filters and sorting"
            title="Filters and sorting"
            className={`relative grid w-10 shrink-0 place-items-center rounded-lg border transition-colors ${
              showFilters || activeFilters ? "border-aegis/60 text-bone" : "border-line text-ash hover:text-bone"
            }`}
          >
            <SlidersHorizontal className="size-4" />
            {activeFilters > 0 && (
              <span className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full bg-aegis text-[10px] font-semibold text-stage">
                {activeFilters}
              </span>
            )}
          </button>
        )}
      </div>

      {filterable && showFilters && (
        <div className="grid grid-cols-2 gap-2 px-5 pt-3">
          <Select label="Hero" value={filters.hero} onChange={setFilter("hero")} options={heroOptions} placeholder="Any hero" />
          {tab === "wearable" && (
            <Select label="Slot" value={filters.slot} onChange={setFilter("slot")} options={slotOptions} placeholder="Any slot" align="right" />
          )}
          {tab !== "sets" && (
            <Select label="Rarity" value={filters.rarity} onChange={setFilter("rarity")} options={rarityOptions} placeholder="Any rarity" />
          )}
          {tab !== "sets" && (
            <Select
              label="Sort"
              value={filters.sort}
              onChange={setFilter("sort")}
              align="right"
              options={SORTS.map((entry) => ({ value: entry.id, label: `Sort: ${entry.name}` }))}
            />
          )}
          {activeFilters > 0 && (
            <button
              onClick={() => setFilters((current) => ({ ...current, hero: ANY, slot: ANY, rarity: ANY }))}
              className="col-span-2 h-8 rounded-lg text-left text-xs text-ash hover:text-bone"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      <nav className={embedded ? "hidden" : "mt-4 flex flex-wrap gap-1 px-5 pb-3"} aria-label="Model types">
        {TABS.filter((entry) => counts[entry.id]).map((entry) => (
          <button
            key={entry.id}
            onClick={() => onTab(entry.id)}
            data-sound="ui_rollover_micro"
            aria-pressed={tab === entry.id}
            className={`shrink-0 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
              tab === entry.id ? "bg-raised text-bone" : "text-ash hover:text-bone"
            }`}
          >
            {entry.name}
            <span className={`ml-1.5 tabular-nums ${tab === entry.id ? "text-aegis" : "text-ash/60"}`}>
              {counts[entry.id].toLocaleString("en")}
            </span>
          </button>
        ))}
      </nav>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto border-t border-line scrollbar-thin">
        {rows.length === 0 ? (
          <div className="px-5 py-10 text-sm text-ash">
            {query ? `Nothing matches “${query}”. Try a hero name or part of the item name.` : "Nothing matches these filters."}
          </div>
        ) : (
          <ul className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtual) => {
              const row = rows[virtual.index];
              const active = isActive(row, route);
              return (
                <li key={row.key} className="absolute inset-x-0" style={{ height: virtual.size, transform: `translateY(${virtual.start}px)` }}>
                  <button
                    onClick={() => onOpen(row.route)}
                    onPointerEnter={() => onPrefetch?.(row.route)}
                    disabled={row.disabled}
                    title={row.disabled ? "The hero's model is not exported yet" : undefined}
                    aria-current={active ? "true" : undefined}
                    className={`relative flex h-full w-full items-center gap-3 px-5 text-left transition-colors disabled:opacity-40 ${
                      active ? "bg-raised" : "hover:bg-raised/50"
                    }`}
                  >
                    <span className="absolute inset-y-2 left-0 w-[3px] rounded-r" style={{ background: active ? row.color : "transparent" }} aria-hidden />
                    <span className="relative h-9 w-[54px] shrink-0 overflow-hidden rounded bg-stage">
                      {row.image && (
                        <img
                          src={row.image}
                          alt=""
                          loading="lazy"
                          className={`size-full ${row.wide ? "object-cover" : "object-contain"}`}
                          onError={(event) => (event.currentTarget.style.visibility = "hidden")}
                        />
                      )}
                      <span className="absolute inset-x-0 bottom-0 h-[2px]" style={{ background: row.color }} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm ${active ? "text-bone" : "text-bone/90"}`}>{row.name}</span>
                      <span className="block truncate text-xs text-ash">{row.detail}</span>
                    </span>
                    {row.price && <span className="shrink-0 text-xs text-ash tabular-nums">{row.price}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className={embedded ? "hidden" : "flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-xs text-ash"}>
        <Select
          label="Language"
          value={language}
          onChange={onLanguage}
          up
          className="w-40"
          options={LANGUAGES.map(([value, label]) => ({ value, label }))}
        />
        <a
          href={datasetPage(DATASETS.models)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:text-bone"
        >
          Dataset <ExternalLink className="size-3" aria-hidden />
        </a>
      </footer>
    </aside>
  );
}
