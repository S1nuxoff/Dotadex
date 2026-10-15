import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search, X, ExternalLink } from "lucide-react";
import { TABS, HERO_COLOR, rarity, itemIcon, heroPortrait } from "../catalog.js";

function rowsFor(catalog, tab) {
  if (tab === "heroes") {
    return catalog.heroes.map((hero) => ({
      key: `hero/${hero.id}`,
      selection: { type: "hero", id: hero.id },
      name: hero.name,
      detail: hero.defaults.length ? `${hero.defaults.length} default items` : "Base model",
      color: HERO_COLOR,
      image: heroPortrait(hero),
      wide: true,
    }));
  }
  return catalog.items
    .filter((item) => item.kind === tab)
    .map((item) => ({
      key: `item/${item.id}`,
      selection: { type: "item", id: item.id },
      name: item.name,
      detail: item.hero ? catalog.heroNames[item.hero] : rarity(item).name,
      color: rarity(item).color,
      image: itemIcon(item),
    }));
}

export default function Sidebar({ catalog, tab, onTab, selected, onSelect }) {
  const [query, setQuery] = useState("");
  const scrollRef = useRef(null);

  const counts = useMemo(() => {
    const result = { heroes: catalog.heroes.length };
    for (const item of catalog.items) {
      result[item.kind] = (result[item.kind] ?? 0) + 1;
    }
    return result;
  }, [catalog]);

  const rows = useMemo(() => {
    const all = rowsFor(catalog, tab);
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return all;
    }
    return all.filter((row) => {
      const text = `${row.name} ${row.detail}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }, [catalog, tab, query]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 56,
    overscan: 12,
  });


  return (
    <aside className="flex h-full flex-col bg-panel">
      <div className="px-5 pt-6 pb-4">
        <h1 className="font-display text-[1.65rem] leading-none text-bone">Dota 2 Model Viewer</h1>
        <p className="mt-2 text-sm text-ash">
          {catalog.heroes.length.toLocaleString("en")} heroes and {catalog.items.length.toLocaleString("en")} items
          from the game files, shown with Dota's hero shading.
        </p>
      </div>

      <div className="px-5">
        <label className="group flex items-center gap-2.5 rounded-lg border border-line bg-stage/60 px-3 py-2 transition-colors focus-within:border-aegis/70">
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
      </div>

      <nav className="mt-4 flex gap-1 overflow-x-auto px-5 pb-3 scrollbar-thin" aria-label="Model types">
        {TABS.filter((entry) => counts[entry.id]).map((entry) => (
          <button
            key={entry.id}
            onClick={() => onTab(entry.id)}
            aria-pressed={tab === entry.id}
            className={`shrink-0 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
              tab === entry.id ? "bg-raised text-bone" : "text-ash hover:text-bone"
            }`}
          >
            {entry.name}
            <span className={`ml-1.5 tabular-nums ${tab === entry.id ? "text-aegis" : "text-ash/60"}`}>
              {counts[entry.id]}
            </span>
          </button>
        ))}
      </nav>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto border-t border-line scrollbar-thin">
        {rows.length === 0 ? (
          <div className="px-5 py-10 text-sm text-ash">
            Nothing matches “{query}”. Try a hero name or part of the item name.
          </div>
        ) : (
          <ul className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtual) => {
              const row = rows[virtual.index];
              const active = selected && `${selected.type}/${selected.id}` === row.key;
              return (
                <li
                  key={row.key}
                  className="absolute inset-x-0"
                  style={{ height: virtual.size, transform: `translateY(${virtual.start}px)` }}
                >
                  <button
                    onClick={() => onSelect(row.selection)}
                    aria-current={active ? "true" : undefined}
                    className={`relative flex h-full w-full items-center gap-3 px-5 text-left transition-colors ${
                      active ? "bg-raised" : "hover:bg-raised/50"
                    }`}
                  >
                    <span
                      className="absolute inset-y-2 left-0 w-[3px] rounded-r"
                      style={{ background: active ? row.color : "transparent" }}
                      aria-hidden
                    />
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
                    <span className="min-w-0">
                      <span className={`block truncate text-sm ${active ? "text-bone" : "text-bone/90"}`}>{row.name}</span>
                      <span className="block truncate text-xs text-ash">{row.detail}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-xs text-ash">
        <span>Updated with each game patch</span>
        <a
          href={`https://huggingface.co/datasets/${catalog.modelsBase.split("/datasets/")[1]?.split("/resolve")[0]}`}
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
