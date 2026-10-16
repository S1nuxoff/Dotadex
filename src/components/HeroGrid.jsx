import { useEffect, useMemo, useRef, useState } from "react";
import { imageUrl, useGameData } from "../gamedata.js";
import { useDismiss, useUiScale } from "./ui.jsx";

// The game's hero grid as the dashboard has it now: four columns of tall portraits by primary
// attribute, a portrait growing with the hero's name on hover, typing to find a hero, and the
// sort and filters along the bottom. Sizes are the game's own, from hero_grid_new.css, in its
// units: the grid is 1204 wide and drawn at 115% of a 1920 wide screen.
const GROUPS = [
  ["DOTA_ATTRIBUTE_STRENGTH", "Strength", "hero_strength", "strength"],
  ["DOTA_ATTRIBUTE_AGILITY", "Agility", "hero_agility", "agility"],
  ["DOTA_ATTRIBUTE_INTELLECT", "Intelligence", "hero_intelligence", "intelligence"],
  ["DOTA_ATTRIBUTE_ALL", "All", "hero_universal", "universal"],
];
const GROUP_NAMES = { Strength: "Strength", Agility: "Agility", Intelligence: "Intelligence", All: "Universal" };
export const ATTRIBUTE_ICON = (icon) => `https://cdn.steamstatic.com/apps/dota2/images/dota_react/icons/${icon}.png`;

export function attributeIcon(primary) {
  return ATTRIBUTE_ICON((GROUPS.find(([key]) => key === primary) ?? GROUPS[3])[2]);
}

const ICONS = "/Dotadex/ui/herogrid/";
const GRID_WIDTH = 1204;
const GRID_HEIGHT = 678;
const GRID_SCALE = 1.15;

// The game's filters: farm priority and tags are roles a hero must all have, complexity and
// attack type are any of those picked
const FARM = [
  ["Carry", "carry"],
  ["Support", "support"],
];
const TAGS = [
  ["Melee", "melee", "attack"],
  ["Ranged", "ranges", "attack"],
  ["Disabler", "disabler"],
  ["Durable", "durable"],
  ["Escape", "escape"],
  ["Initiator", "initiator"],
  ["Nuker", "nuker"],
  ["Pusher", "pusher"],
];
const SORTS = [
  ["attributes", "DOTA_HeroGrid_OptionCategory_Attributes", "Attributes"],
  ["name", "DOTA_HeroGrid_Sort_Name", "Name"],
];

function text(texts, key, fallback) {
  return (texts?.[key] ?? fallback).replace(/:$/, "");
}

function FilterButton({ icon, label, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      data-sound="toggle"
      title={label}
      aria-label={label}
      aria-pressed={selected}
      className={`relative -mr-[4px] size-[32px] transition-transform duration-100 hover:z-10 hover:scale-[1.35] hover:brightness-200 active:brightness-150 ${
        selected ? "bg-[#c5dcff]" : "bg-[#616d7e]"
      }`}
      style={{ mask: `url(${ICONS}${icon}.png) center / contain no-repeat`, WebkitMask: `url(${ICONS}${icon}.png) center / contain no-repeat` }}
    />
  );
}

function FilterCategory({ title, children }) {
  return (
    <div className="mr-[16px] flex flex-col items-center">
      <span className="-ml-[8px] h-[17px] text-[15px] leading-[17px] tracking-[1px] text-[#808fa6c3] uppercase [text-shadow:0_2px_6px_rgb(0_0_0/0.4)]">{title}</span>
      <div className="-mt-[1px] flex">{children}</div>
    </div>
  );
}

function SortPicker({ value, options, onChange, label }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, setOpen);
  const current = options.find((option) => option.value === value);
  return (
    <div ref={ref} className="mt-[8px] mr-[20px] flex w-[320px] items-center self-center">
      <span className="h-[17px] max-w-[80px] text-[15px] leading-[17px] tracking-[1px] text-[#808fa6c3] uppercase [text-shadow:0_2px_6px_rgb(0_0_0/0.4)]">{label}</span>
      <div className="relative ml-[8px] flex-1">
        <button
          onClick={() => setOpen(!open)}
          data-sound="click"
          aria-expanded={open}
          className="flex h-[34px] w-full items-center rounded-[3px] border border-white/15 bg-gradient-to-b from-[#2b3139] to-[#1a1e24] pl-[6px] shadow-[0_2px_8px_rgb(0_0_0/0.3)] hover:brightness-200 active:brightness-150"
        >
          <span className="ml-[4px] flex-1 truncate text-left text-[16px] text-[#e6ebef]">{current?.label}</span>
          <span
            aria-hidden
            className="mr-[8px] size-[16px] bg-[#b1ccec]"
            style={{ mask: `url(${ICONS}arrow_down.png) center / contain no-repeat`, WebkitMask: `url(${ICONS}arrow_down.png) center / contain no-repeat` }}
          />
        </button>
        {open && (
          <ul className="absolute bottom-[38px] left-0 z-30 w-full rounded-[3px] border border-white/15 bg-[#1a1e24] py-[4px] shadow-[0_4px_16px_rgb(0_0_0/0.6)]">
            {options.map((option) => (
              <li key={option.value}>
                <button
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  data-sound="click"
                  className={`w-full px-[10px] py-[5px] text-left text-[16px] hover:bg-white/10 ${option.value === value ? "text-white" : "text-[#9aa6b6]"}`}
                >
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function HeroCard({ hero, name, portrait, attribute, state, onOpen, onPrefetch }) {
  return (
    <li className="relative h-[83px] w-[51px] hover:z-20">
      <button
        onClick={() => onOpen({ type: "hero", id: hero.id })}
        onPointerEnter={() => onPrefetch?.({ type: "hero", id: hero.id })}
        data-hover
        aria-label={name}
        className="group absolute inset-0"
      >
        <img
          src={portrait}
          alt=""
          loading="lazy"
          className={`absolute top-[4px] left-[4px] h-[75px] w-[43px] object-cover shadow-[0_2px_12px_-1px_rgb(0_0_0/0.3)] transition-[filter,opacity] duration-200 ${
            state === "dim" ? "opacity-50 brightness-[0.25] saturate-0" : state === "found" ? "hero-card-found" : "saturate-[0.7]"
          }`}
        />
        {/* The portrait grown over its neighbours, with the name, as the game shows the card under the pointer */}
        <span className="pointer-events-none absolute top-1/2 left-1/2 h-[175px] w-[129px] -translate-x-1/2 -translate-y-1/2 scale-[0.4] opacity-0 shadow-[0_8px_32px_rgb(0_0_0/0.85)] transition-[transform,opacity] duration-150 ease-out group-hover:scale-100 group-hover:opacity-100">
          <img src={portrait} alt="" className="absolute inset-0 size-full border border-white/20 object-cover" />
          <span className="absolute inset-x-0 bottom-0 flex flex-col items-center bg-gradient-to-t from-black/90 via-black/60 to-transparent px-[6px] pt-[28px] pb-[8px]">
            <span className="text-center text-[12px] leading-[14px] font-semibold tracking-[2px] text-white uppercase [text-shadow:0_1px_3px_#000]">{name}</span>
            <img src={`${ICONS}${attribute}.png`} alt="" className="mt-[5px] size-[16px]" />
          </span>
        </span>
      </button>
    </li>
  );
}

export default function HeroGrid({ catalog, language, onOpen, onPrefetch }) {
  const { data } = useGameData(catalog.modelsBase, ["heroes.json"], language);
  const texts = data?.texts;
  const scale = useUiScale();
  const [sort, setSort] = useState("attributes");
  const [roles, setRoles] = useState([]);
  const [complexity, setComplexity] = useState([]);
  const [attack, setAttack] = useState([]);
  const search = useQuickSearch();
  const words = search.query.trim().toLowerCase();

  const toggle = (list, setList, value) => setList(list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]);

  const heroes = useMemo(
    () =>
      catalog.heroes
        // The training dummy of the demo mode is listed with the heroes but is none
        .filter((hero) => hero.id !== "target_dummy")
        .map((hero) => {
          const info = data?.heroes[`npc_dota_hero_${hero.id}`];
          const group = GROUPS.find(([key]) => key === (info?.AttributePrimary ?? "DOTA_ATTRIBUTE_ALL")) ?? GROUPS[3];
          return {
            hero,
            info,
            group: group[0],
            attribute: group[3],
            name: texts?.[`npc_dota_hero_${hero.id}`] ?? hero.name,
            roles: (info?.Role ?? "").split(","),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [catalog, data, texts]
  );

  const passes = ({ info, roles: own }) =>
    roles.every((role) => own.includes(role)) &&
    (complexity.length === 0 || complexity.includes(Number(info?.Complexity))) &&
    (attack.length === 0 || attack.some((type) => (info?.AttackCapabilities ?? "").includes(type.toUpperCase())));
  const filtering = roles.length > 0 || complexity.length > 0 || attack.length > 0;
  const stateOf = (entry) => {
    if (filtering && !passes(entry)) {
      return "dim";
    }
    if (words) {
      return entry.name.toLowerCase().includes(words) ? "found" : "dim";
    }
    return "";
  };

  // Enter opens the first hero found, as in the game
  search.onEnter.current = () => {
    const first = heroes.find((entry) => stateOf(entry) === "found");
    first && onOpen({ type: "hero", id: first.hero.id });
  };

  const categories =
    sort === "attributes"
      ? GROUPS.map(([key, name, , icon]) => ({
          key,
          icon,
          name: text(texts, `DOTA_HeroSelectorCategory_PrimaryAttribute_${name}`, GROUP_NAMES[name]),
          heroes: heroes.filter((entry) => entry.group === key),
          width: key === "DOTA_ATTRIBUTE_ALL" ? "20%" : undefined,
        }))
      : [{ key: "all", name: text(texts, "DOTA_TabName_Heroes", "Heroes"), heroes }];

  const card = (entry) => (
    <HeroCard
      key={entry.hero.id}
      hero={entry.hero}
      name={entry.name}
      attribute={entry.attribute}
      portrait={imageUrl(catalog.modelsBase, `heroes/selection/npc_dota_hero_${entry.hero.id}`)}
      state={stateOf(entry)}
      onOpen={onOpen}
      onPrefetch={onPrefetch}
    />
  );

  return (
    <section className="relative min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(ellipse_70%_60%_at_50%_30%,#1b2530,#0b0f14_75%)] scrollbar-thin">
      <div className="mx-auto pt-[60px]" style={{ width: GRID_WIDTH, zoom: scale * GRID_SCALE }}>
        <div className="flex flex-col" style={{ height: GRID_HEIGHT }}>
          <div className="relative flex min-h-0 flex-1">
            {categories.map((category) => (
              <div key={category.key} className="mb-[8px] flex min-w-0 flex-col" style={category.width ? { width: category.width } : { flex: 1 }}>
                <h2 className="flex h-[20px] items-center">
                  {category.icon && <img src={`${ICONS}${category.icon}.png`} alt="" className="ml-[4px] size-[18px]" />}
                  <span className="pl-[4px] text-[16px] font-semibold tracking-[2px] text-[#808fa6] uppercase [text-shadow:2px_2px_4px_#00000044]">{category.name}</span>
                </h2>
                <ul className="flex flex-wrap content-start p-[4px]">{category.heroes.map(card)}</ul>
              </div>
            ))}
            <span
              aria-hidden
              className={`pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[100px] text-white uppercase transition-[opacity,transform,filter] duration-200 [text-shadow:2px_2px_20px_#000] ${
                search.shown ? "scale-100 opacity-100" : "scale-[2] opacity-0 blur-[4px]"
              }`}
            >
              {search.query}
            </span>
          </div>

          <footer className="hero-grid-footer flex h-[66px] shrink-0 items-center">
            <SortPicker
              label={text(texts, "DOTA_HeroGrid_Sort_By", "Sort")}
              value={sort}
              onChange={setSort}
              options={SORTS.map(([value, key, fallback]) => ({ value, label: text(texts, key, fallback) }))}
            />
            <div className="flex-1" />
            <div className="-mb-[4px] flex pb-[4px]">
              <FilterCategory title={text(texts, "DOTA_HeroGrid_FarmPriority", "Type")}>
                {FARM.map(([role, icon]) => (
                  <FilterButton key={role} icon={icon} label={text(texts, `DOTA_HeroRole_${role}`, role)} selected={roles.includes(role)} onClick={() => toggle(roles, setRoles, role)} />
                ))}
              </FilterCategory>
              <FilterCategory title={text(texts, "DOTA_HeroComplexity", "Complexity")}>
                {[1, 2, 3].map((level) => (
                  <FilterButton
                    key={level}
                    icon="complexity"
                    label={text(texts, `DOTA_HeroComplexity_Title_${level}`, ["Low", "Moderate", "High"][level - 1] + " Complexity")}
                    selected={complexity.includes(level)}
                    onClick={() => toggle(complexity, setComplexity, level)}
                  />
                ))}
              </FilterCategory>
              <FilterCategory title={text(texts, "DOTA_HeroTags", "Tags")}>
                {TAGS.map(([tag, icon, kind]) =>
                  kind === "attack" ? (
                    <FilterButton
                      key={tag}
                      icon={icon}
                      label={text(texts, `DOTA_HeroSelectorCategory_AttackRange_${tag}`, tag)}
                      selected={attack.includes(tag)}
                      onClick={() => toggle(attack, setAttack, tag)}
                    />
                  ) : (
                    <FilterButton key={tag} icon={icon} label={text(texts, `DOTA_HeroRole_${tag}`, tag)} selected={roles.includes(tag)} onClick={() => toggle(roles, setRoles, tag)} />
                  )
                )}
              </FilterCategory>
            </div>
          </footer>
        </div>
      </div>
    </section>
  );
}

// Typing anywhere finds heroes by name, the letters shown large over the grid for a moment;
// Backspace takes one back, Escape clears, Enter opens the first one found
function useQuickSearch() {
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(false);
  const onEnter = useRef(null);
  useEffect(() => {
    let timer;
    const show = () => {
      setShown(true);
      clearTimeout(timer);
      timer = setTimeout(() => setShown(false), 900);
    };
    const key = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.target.closest?.("input, textarea, [contenteditable]")) {
        return;
      }
      if (event.key === "Escape") {
        setQuery("");
        setShown(false);
      } else if (event.key === "Backspace") {
        setQuery((current) => current.slice(0, -1));
        show();
      } else if (event.key === "Enter") {
        onEnter.current?.();
      } else if (event.key.length === 1 && /[\p{L}\p{N} '-]/u.test(event.key)) {
        event.preventDefault();
        setQuery((current) => current + event.key);
        show();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      clearTimeout(timer);
    };
  }, []);
  return { query, shown, onEnter };
}
