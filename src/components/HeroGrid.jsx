import { useEffect, useMemo, useRef, useState } from "react";
import { imageUrl, useGameData } from "../gamedata.js";
import { useDismiss, useUiScale } from "./ui.jsx";

// The game's hero grid as the dashboard has it now: four columns of tall portraits by primary
// attribute, the animated portrait and name of the hero under the pointer, typing to find a hero, and the
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
  ["attributes", "Attributes"],
  ["name", "Name"],
];
const COMPLEXITY = ["Low Complexity", "Moderate Complexity", "High Complexity"];

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

function HeroCard({ hero, name, portrait, video, facts, state, onOpen, onPrefetch }) {
  const [hovered, setHovered] = useState(false);
  return (
    <li className="relative h-[83px] w-[51px] hover:z-20">
      <button
        onClick={() => onOpen({ type: "hero", id: hero.id })}
        onPointerEnter={() => {
          setHovered(true);
          onPrefetch?.({ type: "hero", id: hero.id });
        }}
        onPointerLeave={() => setHovered(false)}
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
        {/* The card the game shows under the pointer: the hero's animated portrait and name, over its neighbours */}
        <span className="pointer-events-none absolute top-1/2 left-1/2 h-[204px] w-[155px] -translate-x-1/2 -translate-y-1/2 scale-[0.4] border-2 border-black bg-black opacity-0 shadow-[0_8px_32px_rgb(0_0_0/0.85)] transition-[transform,opacity] duration-150 ease-out group-hover:scale-100 group-hover:opacity-100">
          <img src={portrait} alt="" className="absolute inset-0 size-full object-cover" />
          {hovered && <HeroMovie src={video} />}
          <span className="absolute inset-x-0 bottom-0 bg-black/80 px-[4px] pt-[5px] pb-[2px] text-center text-[16px] leading-[20px] tracking-[2px] text-white uppercase">{name}</span>
          {/* Where the game puts its event tokens, what does not change: attribute, attack, complexity */}
          <span className="absolute top-full left-1/2 mt-[4px] flex -translate-x-1/2 gap-[4px]">
            {facts.map((fact) => (
              <span key={fact.key} className="hero-card-fact grid h-[30px] w-[26px] place-items-center">
                {fact.icon}
              </span>
            ))}
          </span>
        </span>
      </button>
    </li>
  );
}

// The three tiles under the hover card
function factsOf({ attribute, info }) {
  const ranged = (info?.AttackCapabilities ?? "").includes("RANGED");
  const level = Number(info?.Complexity) || 1;
  const mask = (icon) => ({ mask: `url(${ICONS}${icon}.png) center / contain no-repeat`, WebkitMask: `url(${ICONS}${icon}.png) center / contain no-repeat` });
  return [
    { key: "attribute", icon: <img src={`${ICONS}${attribute}.png`} alt="" className="size-[18px]" /> },
    { key: "attack", icon: <span className="size-[20px] bg-[#d6e2f0]" style={mask(ranged ? "ranges" : "melee")} /> },
    {
      key: "complexity",
      icon: (
        <span className="flex flex-col items-center gap-[2px]">
          {[3, 2, 1].map((step) => (
            <span key={step} className={`size-[5px] rotate-45 ${step <= level ? "bg-[#d6e2f0]" : "border border-[#d6e2f0]/40"}`} />
          ))}
        </span>
      ),
    },
  ];
}

// Plays once it can, over the still portrait, so a slow or missing video leaves the portrait.
// The game keeps these 256x256, squeezed; drawn stretched to the card, as the game does, they
// come out in the portrait's proportions
function HeroMovie({ src }) {
  const [ready, setReady] = useState(false);
  return (
    <video
      src={src}
      autoPlay
      loop
      muted
      playsInline
      onCanPlay={() => setReady(true)}
      className={`absolute inset-0 size-full object-fill transition-opacity duration-150 ${ready ? "opacity-100" : "opacity-0"}`}
    />
  );
}

export default function HeroGrid({ catalog, onOpen, onPrefetch }) {
  const { data } = useGameData(catalog.modelsBase, ["heroes.json"]);
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
            name: hero.name,
            roles: (info?.Role ?? "").split(","),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [catalog, data]
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
          name: GROUP_NAMES[name],
          heroes: heroes.filter((entry) => entry.group === key),
          width: key === "DOTA_ATTRIBUTE_ALL" ? "20%" : undefined,
        }))
      : [{ key: "all", name: "Heroes", heroes }];

  const card = (entry) => (
    <HeroCard
      key={entry.hero.id}
      hero={entry.hero}
      name={entry.name}
      portrait={imageUrl(catalog.modelsBase, `heroes/selection/npc_dota_hero_${entry.hero.id}`)}
      facts={factsOf(entry)}
      video={`${catalog.modelsBase}videos/heroes/npc_dota_hero_${entry.hero.id}.webm`}
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
              label="Sort"
              value={sort}
              onChange={setSort}
              options={SORTS.map(([value, label]) => ({ value, label }))}
            />
            <div className="flex-1" />
            <div className="-mb-[4px] flex pb-[4px]">
              <FilterCategory title={"Type"}>
                {FARM.map(([role, icon]) => (
                  <FilterButton key={role} icon={icon} label={role} selected={roles.includes(role)} onClick={() => toggle(roles, setRoles, role)} />
                ))}
              </FilterCategory>
              <FilterCategory title={"Complexity"}>
                {[1, 2, 3].map((level) => (
                  <FilterButton
                    key={level}
                    icon="complexity"
                    label={COMPLEXITY[level - 1]}
                    selected={complexity.includes(level)}
                    onClick={() => toggle(complexity, setComplexity, level)}
                  />
                ))}
              </FilterCategory>
              <FilterCategory title={"Tags"}>
                {TAGS.map(([tag, icon, kind]) =>
                  kind === "attack" ? (
                    <FilterButton
                      key={tag}
                      icon={icon}
                      label={tag}
                      selected={attack.includes(tag)}
                      onClick={() => toggle(attack, setAttack, tag)}
                    />
                  ) : (
                    <FilterButton key={tag} icon={icon} label={tag} selected={roles.includes(tag)} onClick={() => toggle(roles, setRoles, tag)} />
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
