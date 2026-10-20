import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { formatPrice, heroSlots, itemIcon, personaOf, rarity, slotName, sortItems } from "../catalog.js";
import { useDismiss, useUiLayout } from "./ui.jsx";

// The game's Armory (dashboard_page_collection, dashboard_tabs_collection, collection_shared,
// ui_econ_item_animated): the tabs under the top bar; a 300 wide column of heroes or categories on
// the left; a panel of the selected one's items; the model in the game's loadout scene to the right.
// Sizes are the game's, on a 1080 high screen.

const TABS = [
  ["hero", "Hero"],
  ["world", "World"],
  ["treasury", "Treasury"],
  ["all", "All Items"],
];

// World's categories (CollectionTab_Couriers, _Wards, _Roshan) by what the catalog knows of them
const WORLD = [
  ["couriers", "Couriers", (item) => item.kind === "courier"],
  ["wards", "Wards", (item) => item.kind === "ward"],
  ["roshan", "Roshan", (item) => item.kind === "other" && /^models\/creeps\/roshan/.test(item.models[0] ?? "")],
];

const GROUP_BY = [
  ["slot", "Slot"],
  ["rarity", "Rarity"],
  ["none", "None"],
];
const SORT_BY = [
  ["newest", "Recent"],
  ["rarity", "Rarity"],
  ["price", "Price"],
];

// Tile sizes (collection_shared's defines): a hero's set and item, a world item, All Items'
const TILE = {
  set: [230, 346],
  item: [172, 222],
  global: [206, 246],
  all: [148, 199],
};

const heroIcon = (base, id) => `${base}images/heroes/icons/npc_dota_hero_${id}_png.png`;

// The tabs under the top bar (.SecondaryTabSet: 429 in from the left, 20 high capitals 3 apart)
export function SecondaryTabs({ tabs = TABS, tab, onTab }) {
  return (
    <div className="flex h-[52px] items-center bg-gradient-to-b from-black/45 to-black/20 pl-[429px]">
      {tabs.map(([id, label], index) => (
        <Fragment key={id}>
          {index > 0 && (
            <span className="mx-[15px] mt-[4px] mb-px text-[18px] text-[#768e8d]" aria-hidden>
              /
            </span>
          )}
          <button
            role="tab"
            aria-selected={tab === id}
            data-sound="toptab"
            onClick={() => onTab(id)}
            className={`mt-[4px] text-[20px] tracking-[3px] uppercase transition-colors ${tab === id ? "text-white [text-shadow:0_0_12px_#5d7070]" : "text-[#768e8d] hover:text-white"}`}
          >
            {label}
          </button>
        </Fragment>
      ))}
    </div>
  );
}

// .SearchBox: a faint field, rounded 4, the search icon at 20% on its right
export function SearchBox({ value, onChange, placeholder, className = "" }) {
  return (
    <label className={`flex items-center rounded-[4px] bg-[#d2e2ff11] hover:bg-[#d2e2ff22] ${className}`}>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent p-[8px] text-[18px] text-white outline-none placeholder:text-white/40"
      />
      {value ? (
        <button onClick={() => onChange("")} aria-label="Clear" className="mx-[8px] ml-[2px] text-[20px] leading-none text-white/20 hover:text-white/80">
          ×
        </button>
      ) : (
        <svg aria-hidden viewBox="0 0 24 24" className="mx-[8px] ml-[2px] size-[24px] fill-none stroke-white/20 stroke-2">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.5 15.5 21 21" />
        </svg>
      )}
    </label>
  );
}

// The game's DropDown: 41 high, a dark gradient, a 2px edge, 18 labels, the menu below in #3d4448
function DropDown({ value, options, onChange, label }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, setOpen);
  const current = options.find(([id]) => id === value);
  return (
    <div ref={ref} className="relative w-[200px]">
      <button
        onClick={() => setOpen(!open)}
        data-sound="click"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        className="flex h-[41px] w-full items-center border-2 border-[#5e686966] bg-gradient-to-b from-[#292e2e] to-[#191e1e] px-[8px] text-left shadow-[0_0_1px_3px_#00000055] hover:from-[#393e3e] hover:to-[#292e2e]"
      >
        <span className={`mt-[3px] ml-[6px] flex-1 truncate text-[18px] ${open ? "text-white" : "text-[#b0bcc2]"}`}>{current?.[1]}</span>
        <ChevronDown className="size-[20px] text-[#b0bcc2]" aria-hidden />
      </button>
      {open && (
        <ul role="listbox" className="absolute top-full right-0 left-0 z-20 bg-[#3d4448] shadow-[0_0_6px_#00000066]">
          {options.map(([id, name]) => (
            <li key={id}>
              <button
                role="option"
                aria-selected={id === value}
                onClick={() => {
                  onChange(id);
                  setOpen(false);
                }}
                data-sound="click"
                className="w-full border-y border-black/40 bg-[#3d4448] pt-[6px] pb-[2px] pl-[16px] text-left text-[18px] text-white/60 hover:bg-[#585e62] hover:text-white"
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Labeled({ label, children }) {
  return (
    <span className="ml-[16px] flex items-center">
      <span className="mr-[8px] text-[18px] text-[#b0bcc2]">{label}</span>
      {children}
    </span>
  );
}

// DOTAEconItemAnimated: a dark card (.Static.Owned: #111419 to black) with the picture 2:3 of its
// width high over a grey ground, the name (BodySmall) and slot (LabelSmall at 50%) under it, a 3
// high strip of the rarity's color; hovered the picture grows and brightens and a 4px white edge
// shows, previewed a 1px one. A set (.Animated) is its picture whole, the name over its bottom.
function Tile({ size, image, name, detail, look, active, tall, onClick }) {
  const [width, height] = size;
  return (
    <li className="m-[6px]" style={{ width, height }}>
      <button
        onClick={onClick}
        data-sound="click"
        title={name}
        className={`group relative flex size-full flex-col overflow-hidden text-left shadow-[0_6px_24px_-8px_rgb(0_0_0/0.8)] active:scale-[0.985] active:brightness-50 ${
          tall ? "bg-gradient-to-b from-[#1c2332] to-[#2b415a]" : "bg-[linear-gradient(135deg,#111419_25%,#000)] hover:bg-[linear-gradient(135deg,#1b1f27_25%,#0a0b0d)]"
        }`}
      >
        <span className={`relative block w-full shrink-0 overflow-hidden ${tall ? "h-full" : "aspect-[3/2] bg-gradient-to-b from-[#424142] from-50% to-[#9d9d9d]"}`}>
          {image && (
            <img
              src={image}
              alt=""
              loading="lazy"
              className="size-full scale-[1.04] object-cover transition-[transform,filter] duration-400 ease-[cubic-bezier(0,1,0,1)] group-hover:scale-110 group-hover:brightness-200"
              onError={(event) => (event.currentTarget.style.visibility = "hidden")}
            />
          )}
        </span>
        <span className={`flex w-full flex-col items-center px-[12px] pb-[16px] ${tall ? "absolute inset-x-0 bottom-0" : "mt-auto"}`}>
          <span
            className={`w-full truncate text-center text-[16px] leading-[20px] transition-colors group-hover:text-white ${
              tall ? "text-white/60 [text-shadow:0_2px_8px_#000]" : "text-[#b0bcc2]"
            }`}
          >
            {name}
          </span>
          {detail && (
            <span className="h-[16px] w-full truncate text-center text-[13px] leading-[16px] tracking-[1px] text-[#8b989e] uppercase opacity-50 transition-colors group-hover:text-white">
              {detail}
            </span>
          )}
        </span>
        {/* #BottomLayer: the rarity's color at 80%, darker toward the sides */}
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[3px] border-t border-white/5 opacity-80 shadow-[0_-1px_0_rgb(0_0_0/0.6)]"
          style={{ background: `linear-gradient(90deg, #000000aa, #0000 35%, #0000 65%, #000000aa), ${look?.color ?? "transparent"}` }}
        />
        {/* #EquippedBorder */}
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-0 border-white ${
            active ? "border border-b-2 opacity-80 group-hover:border-4 group-hover:opacity-100" : "border-0 opacity-0 group-hover:border-4 group-hover:opacity-100"
          }`}
        />
      </button>
    </li>
  );
}

// A group of tiles under its title (ItemsGroupPanel: LabelLarge name, LabelMedium count)
function Group({ title, count, children }) {
  return (
    <section className="mb-[24px]">
      {title && (
        <h3 className="ml-[6px] flex items-center">
          <span className="text-[19px] leading-[24px] font-semibold tracking-[1.5px] text-[#b0bcc2] uppercase">{title}</span>
          <span className="ml-[6px] text-[16px] leading-[20px] tracking-[1px] text-[#8b989e]">({count})</span>
        </h3>
      )}
      <ul className="flex flex-wrap">{children}</ul>
    </section>
  );
}

// Shows a long list a part at a time, more as its end scrolls into view
function useChunks(total, step = 120) {
  const [shown, setShown] = useState(step);
  const sentinel = useRef(null);
  useEffect(() => {
    setShown(step);
  }, [total, step]);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || shown >= total) {
      return;
    }
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && setShown((value) => value + step), { rootMargin: "400px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [shown, total, step]);
  return [shown, sentinel];
}

function itemTile(item, onOpen, active, size) {
  return (
    <Tile
      key={item.id}
      size={size}
      image={itemIcon(item)}
      name={item.name}
      detail={item.slot ? slotName(item.slot) : formatPrice(item.price)}
      look={rarity(item)}
      active={active}
      onClick={() => onOpen(item)}
    />
  );
}

export default function Armory({ catalog, route, outfit, viewer, backdrop, onOpen }) {
  const { scale, aspect } = useUiLayout();
  const base = catalog.modelsBase;
  const routeItem = route.type === "item" ? catalog.itemsById[route.id] : null;
  const [tab, setTab] = useState(() =>
    route.type === "treasure" ? "treasury" : routeItem && !routeItem.hero ? "world" : "hero"
  );
  const [heroQuery, setHeroQuery] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("items");
  const [groupBy, setGroupBy] = useState("slot");
  const [sortBy, setSortBy] = useState("newest");
  const [world, setWorld] = useState(() => WORLD.find(([, , matches]) => routeItem && matches(routeItem))?.[0] ?? "couriers");
  const [treasure, setTreasure] = useState(route.type === "treasure" ? route.id : null);

  const heroes = useMemo(
    () => catalog.heroes.filter((hero) => hero.id !== "target_dummy").sort((a, b) => a.name.localeCompare(b.name)),
    [catalog]
  );
  const heroId = outfit?.hero ?? routeItem?.hero ?? heroes[0]?.id;
  const hero = catalog.heroesById[heroId];
  // The hero tab shows a hero on the stage: the first one when none is
  useEffect(() => {
    if (tab === "hero" && !outfit?.hero && hero) {
      onOpen({ type: "hero", id: hero.id, slots: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const words = query.trim().toLowerCase();
  const matches = (name) => !words || name.toLowerCase().includes(words);
  const worn = new Set(Object.values(outfit?.slots ?? {}).map((entry) => entry.id));
  if (routeItem) {
    worn.add(routeItem.id);
  }

  // What the panel lists: [title, groups of tiles]
  let title = "";
  let groups = [];
  let size = TILE.global;
  let controls = null;
  if (tab === "hero" && hero) {
    title = hero.name;
    const items = (catalog.itemsByHero[hero.id] ?? []).filter((item) => !item.default && matches(item.name));
    if (kind === "sets") {
      size = TILE.set;
      const sets = sortItems(
        catalog.sets.filter((set) => set.hero === hero.id && matches(set.name)).map((set) => ({ ...set, rarity: catalog.itemsById[set.items[0]]?.rarity, date: catalog.itemsById[set.items[0]]?.date })),
        "newest"
      );
      groups = [[null, sets.map((set) => ({ $set: set }))]];
    } else {
      size = TILE.item;
      const sorted = sortItems(items, "newest");
      if (groupBy === "slot") {
        const personas = [0, ...(hero.personas ?? []).map((_, index) => index + 1)];
        const order = personas.flatMap((persona) => heroSlots(catalog, hero.id, persona).map((slot) => slot.slot));
        groups = order.map((slot) => [slotName(slot) + (personaOf(slot) ? ` (Persona ${personaOf(slot)})` : ""), sorted.filter((item) => item.slot === slot)]).filter(([, list]) => list.length);
      } else if (groupBy === "rarity") {
        const looks = [...new Set(sorted.map((item) => item.rarity ?? "common"))].sort((a, b) => rarity({ rarity: b }).rank - rarity({ rarity: a }).rank);
        groups = looks.map((look) => [rarity({ rarity: look }).name, sorted.filter((item) => (item.rarity ?? "common") === look)]);
      } else {
        groups = [[null, sorted]];
      }
    }
    controls = (
      <>
        {/* The hero's sets or its single items, in the game's pill tab group */}
        <div className="flex rounded-full border border-black/20 bg-black/70 py-[2px]">
          {[
            ["sets", "Sets"],
            ["items", "Items"],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setKind(id)}
              data-sound="toptab"
              className={`mx-[2px] rounded-full border px-[20px] py-[6px] text-[16px] leading-[20px] tracking-[1px] uppercase outline-none ${
                kind === id ? "border-white/[0.07] bg-gradient-to-b from-[#445055] to-[#2f363a] text-white shadow-[0_2px_4px_rgb(0_0_0/0.2)]" : "border-transparent text-[#768e8d] hover:text-[#dae2e5]"
              }`}
            >
              <span className="inline-block translate-y-[1.5px]">{label}</span>
            </button>
          ))}
        </div>
        {kind === "items" && (
          <Labeled label="Group by:">
            <DropDown value={groupBy} options={GROUP_BY} onChange={setGroupBy} label="Group by" />
          </Labeled>
        )}
      </>
    );
  } else if (tab === "world") {
    const [, name, inWorld] = WORLD.find(([id]) => id === world) ?? WORLD[0];
    title = name;
    groups = [[null, sortItems(catalog.items.filter((item) => inWorld(item) && matches(item.name)), sortBy)]];
    controls = (
      <Labeled label="Sort by:">
        <DropDown value={sortBy} options={SORT_BY} onChange={setSortBy} label="Sort by" />
      </Labeled>
    );
  } else if (tab === "treasury") {
    const chest = treasure && catalog.treasures.find((entry) => entry.id === treasure);
    if (chest) {
      title = chest.name;
      groups = chest.tiers.map((tier, index) => [
        chest.tiers.length > 1 ? `Tier ${index + 1}` : null,
        tier.map((id) => catalog.itemsById[id]).filter((item) => item && matches(item.name)),
      ]);
    } else {
      title = "Treasures";
      const list = catalog.treasures.filter((entry) => matches(entry.name));
      groups = [[null, sortItems(list, sortBy === "price" ? "newest" : sortBy).map((chest) => ({ $chest: chest }))]];
      controls = (
        <Labeled label="Sort by:">
          <DropDown value={sortBy === "price" ? "newest" : sortBy} options={SORT_BY.slice(0, 2)} onChange={setSortBy} label="Sort by" />
        </Labeled>
      );
    }
  } else if (tab === "all") {
    size = TILE.all;
    title = "All Items";
    groups = [[null, sortItems(catalog.items.filter((item) => !item.default && matches(item.name)), sortBy)]];
    controls = (
      <Labeled label="Sort by:">
        <DropDown value={sortBy} options={SORT_BY} onChange={setSortBy} label="Sort by" />
      </Labeled>
    );
  }

  const total = groups.reduce((sum, [, list]) => sum + list.length, 0);
  const [shown, sentinel] = useChunks(total);
  const listRef = useRef(null);
  useEffect(() => {
    listRef.current?.scrollTo(0, 0);
  }, [tab, heroId, world, treasure, kind, groupBy]);

  // An item shows on its hero, or alone (a courier, a ward) on the stage
  const openItem = (item) => onOpen({ type: "item", id: item.id });
  const openSet = (set) => {
    const items = set.items.map((id) => catalog.itemsById[id]).filter(Boolean);
    const persona = personaOf(items[0]?.slot);
    onOpen({ type: "hero", id: set.hero, persona, slots: Object.fromEntries(items.map((item) => [item.slot, { id: item.id, style: 0 }])) });
  };

  let left = shown;
  const rendered = groups.map(([name, list], index) => {
    const part = list.slice(0, Math.max(0, left));
    left -= part.length;
    if (!part.length) {
      return null;
    }
    return (
      <Group key={`${name}-${index}`} title={name} count={list.length}>
        {part.map((entry) =>
          entry.$set ? (
            <Tile
              key={entry.$set.id}
              tall
              size={size}
              image={entry.$set.icon ? itemIcon(entry.$set) : null}
              name={entry.$set.name}
              look={rarity(entry.$set)}
              active={entry.$set.items.every((id) => worn.has(id))}
              onClick={() => openSet(entry.$set)}
            />
          ) : entry.$chest ? (
            <Tile
              key={entry.$chest.id}
              size={size}
              image={entry.$chest.icon ? itemIcon(entry.$chest) : null}
              name={entry.$chest.name}
              detail={entry.$chest.date?.slice(0, 4)}
              look={rarity(entry.$chest)}
              onClick={() => setTreasure(entry.$chest.id)}
            />
          ) : (
            itemTile(entry, openItem, worn.has(entry.id), size)
          )
        )}
      </Group>
    );
  });

  // The column on the left: heroes (Hero), categories (World), back to the treasures (Treasury)
  const heroList = heroes.filter((entry) => !heroQuery.trim() || entry.name.toLowerCase().includes(heroQuery.trim().toLowerCase()));
  const row = (active) =>
    `flex w-full items-center text-left [text-shadow:0_1px_4px_#000] ${
      active ? "bg-[linear-gradient(90deg,#b4e1ff14,#fff0_95%)] text-white" : "text-[#b0bcc2] hover:bg-[linear-gradient(90deg,#96d5ff09,#fff0_95%)] hover:text-[#dae2e5]"
    }`;
  const column =
    tab === "hero" ? (
      <>
        <SearchBox value={heroQuery} onChange={setHeroQuery} placeholder="Filter hero list" className="mt-[8px] mb-[4px]" />
        <ul className="min-h-0 flex-1 overflow-y-auto pt-[8px] pb-[144px] scrollbar-thin">
          {heroList.map((entry) => (
            <li key={entry.id}>
              <button onClick={() => onOpen({ type: "hero", id: entry.id, slots: {} })} data-sound="click" className={`${row(entry.id === heroId)} p-[6px]`}>
                <img src={heroIcon(base, entry.id)} alt="" className="size-[28px]" onError={(event) => (event.currentTarget.style.visibility = "hidden")} />
                <span className="-mt-px ml-[12px] h-[24px] truncate text-[19px] leading-[24px] font-semibold tracking-[1.5px] uppercase">
                  {entry.name}{" "}
                  <span className="font-normal text-[#8b989e]">({(catalog.itemsByHero[entry.id] ?? []).filter((item) => !item.default).length})</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </>
    ) : tab === "world" ? (
      <ul className="pt-[8px]">
        {WORLD.map(([id, name]) => (
          <li key={id}>
            <button onClick={() => setWorld(id)} data-sound="click" className={`${row(world === id)} px-[12px] py-[8px]`}>
              <span className="text-[19px] leading-none font-semibold tracking-[1.5px] uppercase">{name}</span>
            </button>
          </li>
        ))}
      </ul>
    ) : tab === "treasury" ? (
      <ul className="pt-[8px]">
        <li>
          <button onClick={() => setTreasure(null)} data-sound="click" className={`${row(!treasure)} px-[12px] py-[8px]`}>
            <span className="text-[19px] leading-none font-semibold tracking-[1.5px] uppercase">Treasures</span>
          </button>
        </li>
      </ul>
    ) : null;

  // The panel is 848 wide beside the scene, 1470 for All Items (1324 on 16:10, 1680 on 21:9)
  const wide = tab === "all";
  const panelWidth = wide ? { "16x10": 1324, "21x9": 1680 }[aspect] ?? 1470 : aspect === "21x9" ? 1054 : 848;
  const sides = aspect === "16x10" ? "0 60px 0 32px" : "0 60px";

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-[#0d0e12]">
      {!wide && backdrop}
      {!wide && <div className="absolute inset-0">{viewer}</div>}
      <div className="pointer-events-none absolute inset-0 flex flex-col" style={{ zoom: scale }}>
        <div className="pointer-events-auto">
          <SecondaryTabs
            tab={tab}
            onTab={(next) => {
              setTab(next);
              setQuery("");
            }}
          />
        </div>
        {/* #CollectionContent: 130 below the screen's top (the top bar's 61 and the tabs' 52 are
            above), 60 in from the sides, at most 2088 wide */}
        <div className="flex min-h-0 flex-1 justify-center" style={{ padding: sides }}>
          <div className="relative flex min-h-0 w-full max-w-[2088px] pt-[17px]">
          {column && <div className="pointer-events-auto mr-[32px] flex w-[300px] shrink-0 flex-col">{column}</div>}
          <div className="pointer-events-auto flex min-h-0 flex-col" style={{ width: panelWidth }}>
            {/* .TitleGroup: the name (TitleMedium) and the panel's controls on the right */}
            <div className="mt-[8px] mb-[12px] flex min-h-[41px] items-center">
              <h2 className="min-w-0 flex-1 truncate font-display text-[26px] leading-[1.2] font-bold tracking-[1.5px] text-white uppercase">{title}</h2>
              <div className="flex items-center">{controls}</div>
            </div>
            {/* .ViewerContainer: a radial dark ground, a faint edge, a deep shadow; 120 above the bottom */}
            <div className="relative mb-[120px] flex min-h-0 flex-1 flex-col bg-[radial-gradient(140%_100%_at_0%_0%,#202833e4,#06080e)] shadow-[0_28px_120px_-8px_rgb(0_0_0/0.4)]">
              {/* .ItemStatusFilters: the bar over the list, here the keyword filter */}
              <div className="flex min-h-[44px] items-center bg-gradient-to-b from-[#434f5e5e] to-[#17191f86] py-[6px] pr-[10px] pl-[12px] shadow-[inset_0_-1px_1px_rgb(0_0_0/0.2)]">
                <SearchBox value={query} onChange={setQuery} placeholder="Filter by keyword" className="w-[360px]" />
                <span className="ml-auto text-[16px] text-[#8b989e]">{total.toLocaleString("en")}</span>
              </div>
              <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pt-[12px] pr-[8px] pb-[12px] pl-[12px] shadow-[inset_0_1px_0_rgb(238_245_255/0.02)] scrollbar-thin">
                {total ? rendered : <p className="py-[32px] text-center text-[18px] text-[#8b989e]/50">Nothing to display</p>}
                {shown < total && <div ref={sentinel} className="h-px" />}
              </div>
              <span aria-hidden className="pointer-events-none absolute inset-0 border border-white/[0.03]" />
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
