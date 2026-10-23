import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { abilityValue, shopItemIcon, useGameData } from "../gamedata.js";
import { useUiLayout } from "./ui.jsx";

// The game's Items page (Learn > Items: dashboard_page_game_items, made by client.dll from
// ui_game_item_table, ui_game_neutral_item_table, ability_details and shop_item_combines): the
// shop's basics and upgrades, the neutral items by tier, and the selected item's details with its
// recipe. No scene: the game shows the items as their icons only. Sizes are the game's, on a 1080
// high screen.

// The item table's columns and their categories from scripts/shops.txt, in client.dll's order
// (0x182186d03): each a section named #DOTA_SUBSHOP_<category>
const COLUMNS = [
  ["Basics", "BasicItems", ["consumables", "attributes", "weapons_armor", "misc", "secretshop"]],
  ["Upgrades", "UpgradeItems", ["basics", "support", "magics", "defense", "weapons", "artifacts"]],
];
const SUBSHOP = {
  consumables: "Consumables",
  attributes: "Attributes",
  weapons_armor: "Equipment",
  misc: "Miscellaneous",
  secretshop: "Secret Shop",
  basics: "Accessories",
  support: "Support",
  magics: "Magical",
  defense: "Armor",
  weapons: "Weapons",
  artifacts: "Armaments",
};
const MAIN_SHOP = COLUMNS.flatMap(([, , categories]) => categories).filter((category) => category !== "secretshop");

// @define NeutralTier1..5 (dotastyles)
const TIER_COLORS = ["#BEBEBE", "#92E47E", "#7F93FC", "#D57BFF", "#FFE195"];

// .ColumnTitle and bluegreyTextReg
const COLUMN_TITLE = "mb-[2px] text-center text-[18px] font-semibold tracking-[2px] text-[#748B8B] uppercase [text-shadow:1px_1px_4px_#00000044]";
const SECTION_NAME = "mb-[2px] text-[14px] tracking-[1px] text-[#748B8B] uppercase";

const panorama = (base, path) => `${base}images/${path}.png`;

// Panorama's wash-color: the picture's shape filled with one color
function Washed({ src, color, className }) {
  const mask = { maskImage: `url(${src})`, WebkitMaskImage: `url(${src})`, maskSize: "contain", WebkitMaskSize: "contain", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat", maskPosition: "center", WebkitMaskPosition: "center" };
  return <span aria-hidden className={className} style={{ ...mask, backgroundColor: color }} />;
}
// An item's name; the newer neutral items keep theirs under a ":n" key
const textOf = (texts, name) => texts[`DOTA_Tooltip_ability_${name}`] ?? texts[`DOTA_Tooltip_ability_${name}:n`];

// A value by key regardless of case (the texts write %abilitycastrange% for AbilityCastRange)
function valueOf(item, key) {
  const direct = abilityValue(item, key);
  if (direct !== null || !item) {
    return direct;
  }
  const lower = key.toLowerCase();
  const keys = [...Object.keys(item.AbilityValues ?? {}), ...Object.values(item.AbilitySpecial ?? {}).flatMap(Object.keys), ...Object.keys(item)];
  const found = keys.find((entry) => entry.toLowerCase() === lower);
  return found ? abilityValue(item, found) : null;
}

// An item's components, from its recipe ("item_a;item_b"); a recipe that costs gold is one too
function componentsOf(items, name) {
  const recipeName = `item_recipe_${name.replace(/^item_/, "")}`;
  const recipe = items[recipeName];
  const requirements = Object.values(recipe?.ItemRequirements ?? {})[0];
  if (!requirements) {
    return [];
  }
  const parts = requirements
    .split(";")
    .map((part) => part.trim().replace(/\*$/, ""))
    .filter(Boolean);
  if (Number(recipe.ItemCost) > 0) {
    parts.push(recipeName);
  }
  return parts;
}

// A text's %value% placeholders as the game fills them: <span class="GameplayValues
// GameplayVariable"> (semibold, #e1e1e1); <br> and \n as new lines, other markup dropped
function filled(text, item) {
  const clean = String(text ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\\n/g, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
  // %name% a value, %name%%% a value and a percent sign, %% a percent sign
  const parts = clean.split(/(%\w+%(?:%%)?)/g);
  return parts.map((part, index) => {
    const match = part.match(/^%(\w+)%(%%)?$/);
    if (!match) {
      return part.replace(/%%/g, "%");
    }
    const value = valueOf(item, match[1]) ?? valueOf(item, match[1].replace(/^d/, ""));
    if (value === null) {
      return part;
    }
    return (
      <span key={index} className="font-semibold text-[#e1e1e1]">
        {value}
        {match[2] ? "%" : ""}
      </span>
    );
  });
}

// The description's parts: each <h1> header with the text after it, and text before any header
function descriptionParts(text) {
  const parts = [];
  for (const [index, chunk] of String(text ?? "").split(/<h1>/i).entries()) {
    if (index === 0) {
      if (chunk.replace(/<br\s*\/?>|\\n|\s/gi, "")) {
        parts.push({ body: chunk });
      }
      continue;
    }
    const [header, body = ""] = chunk.split(/<\/h1>/i);
    parts.push({ header: header.trim(), body });
  }
  return parts;
}

// The bonus lines over the description: values whose label is "+$var" or "%+$var" (a percent)
function bonusLines(item, name, texts) {
  const lines = [];
  for (const key of Object.keys(item?.AbilityValues ?? {})) {
    const label = texts[`DOTA_Tooltip_ability_${name}_${key}`];
    const match = typeof label === "string" && label.match(/^(%?)([+-]?)\$(\w+)/);
    const value = abilityValue(item, key);
    if (!match || value === null || value === "0") {
      continue;
    }
    const variable = texts[`dota_ability_variable_${match[3]}`] ?? match[3].replace(/_/g, " ");
    const sign = String(value).startsWith("-") ? "" : match[2];
    lines.push({ key, value: `${sign}${value}${match[1]}`, label: variable.replace(/<[^>]+>/g, "") });
  }
  return lines;
}

// DOTAShopItem in a table: 72.7% as high as wide, a black shadow, a little dim until hovered;
// the selected one glows gold, a search dims the others and rings the matches aqua
function ShopTile({ base, name, item, width, selected, search, secret, onPick }) {
  const highlighted = search && search.has(name);
  return (
    <button
      onClick={() => onPick(name)}
      aria-label={name}
      aria-pressed={selected}
      className={`relative mr-[6px] mb-[6px] shrink-0 bg-black transition-[box-shadow,filter] duration-200 ${
        selected
          ? "shadow-[0_0_8px_gold]"
          : highlighted
          ? "shadow-[0_0_8px_aqua]"
          : "shadow-[0_0_4px_black]"
      } ${search && !highlighted ? "brightness-[0.1] saturate-[0.1]" : "brightness-[0.93] saturate-[0.9] hover:brightness-150 hover:saturate-100 active:brightness-200"}`}
      style={{ width, height: width * 0.727 }}
    >
      <img src={shopItemIcon(base, name, item)} alt="" className="size-full object-cover" onError={(event) => (event.currentTarget.style.visibility = "hidden")} />
      {/* .SecretShopItem:not(.MainShopItem) #SecretShop */}
      {secret && <img src={panorama(base, "hud/secret_psd")} alt="" className="absolute right-px bottom-[2px] size-[13px]" />}
    </button>
  );
}

// DOTAGameItemTable: the basics and upgrades columns, each 749 high on #000c, sections of 50 wide
// items wrapping in at most 600; the Secret Shop keeper under the basics
function ItemTable({ base, items, shops, mainShop, selected, search, onPick }) {
  return (
    <div className="ml-[12px] flex">
      {COLUMNS.map(([title, id, categories]) => (
        <div key={id} className="relative mr-[12px] self-start">
          <div className="flex flex-col">
            <h3 className={COLUMN_TITLE}>{title}</h3>
            <div className="flex h-[749px] max-w-[600px] flex-wrap content-start items-start bg-black/80 pt-[12px]">
              {categories.map((category) =>
                shops[category]?.length ? (
                  <div key={category} className="mb-[16px] flex max-w-[280px] flex-col px-[16px]">
                    <span className={SECTION_NAME}>{SUBSHOP[category]}</span>
                    <div className="flex flex-wrap">
                      {shops[category].map((name) => (
                        <ShopTile
                          key={name}
                          base={base}
                          name={name}
                          item={items[name]}
                          width={50}
                          selected={selected === name}
                          search={search}
                          secret={category === "secretshop" && !mainShop.has(name)}
                          onPick={onPick}
                        />
                      ))}
                    </div>
                  </div>
                ) : null
              )}
            </div>
          </div>
          {/* #ShopKeeperArt: 280 wide, the lower half, behind the sections */}
          {id === "BasicItems" && (
            <div
              aria-hidden
              className="pointer-events-none absolute right-px bottom-px -z-10 h-[50%] w-[280px] bg-cover"
              style={{ backgroundImage: `url(${panorama(base, "textures/secret_shop_psd")})` }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// "0:00" -> "0:00+" (client.dll's "%d:%02d+")
function tierTime(start) {
  const [minutes = 0, seconds = 0] = String(start ?? "0:00").split(":").map(Number);
  return `${minutes}:${String(seconds).padStart(2, "0")}+`;
}

// DOTAGameNeutralItemTable: the neutral items by tier on #000c (330 wide, 44 wide items), then the
// enchantments by tier on #111c
function NeutralTable({ base, items, tiers, selected, search, onPick }) {
  const tier = ([number, entry], list) => (
    <div key={number} className="mb-[16px] flex flex-col">
      <div className="flex w-full items-center">
        <span className={SECTION_NAME}>Tier {number}</span>
        <span className="flex-1" />
        <span className="flex items-center" title="Game time at which items of this tier are available to drop.">
          <Washed src={panorama(base, "status_icons/clock_psd")} color="#333" className="mr-[4px] mb-px size-[10px]" />
          <span className="pr-[6px] text-[16px] tracking-[1px] text-[#666] uppercase">{tierTime(entry.start_time)}</span>
        </span>
      </div>
      <div className="flex max-w-[380px] flex-wrap">
        {list.map((name) => (
          <ShopTile key={name} base={base} name={name} item={items[name]} width={44} selected={selected === name} search={search} onPick={onPick} />
        ))}
      </div>
    </div>
  );
  const enchantments = (entry) => [...new Set(Object.values(entry.enhancements ?? {}).flatMap((group) => Object.keys(group ?? {})))];
  return (
    <div className="flex flex-col">
      <h3 className={COLUMN_TITLE}>Neutral Items</h3>
      <div className="flex w-[330px] flex-col bg-black/80 pt-[12px] pr-[10px] pl-[16px]">
        {tiers.map((entry) => tier(entry, Object.keys(entry[1].items ?? {}).filter((name) => items[name])))}
      </div>
      <span className="mb-[2px] ml-[16px] text-[14px] tracking-[1px] text-[#748B8B] uppercase">Neutral Enchantments</span>
      <div className="flex w-[330px] flex-wrap bg-[#111c] pt-px pr-[10px] pl-[16px]">
        {tiers.map((entry) => tier(entry, enchantments(entry[1]).filter((name) => items[name])))}
      </div>
    </div>
  );
}

// DOTAShopItemCombines: what the item builds into above it, its components below, joined by the
// faint connectors (.Connector.NothingtoNothing); 66 wide items on a recessed ground
function Combines({ base, items, name, upgrades, components, onPick }) {
  const WIDTH = 66;
  const HEIGHT = Math.round(WIDTH * 0.727);
  const AREA = [346, 196];
  const rows = [upgrades, [name], components];
  const tops = [6, (AREA[1] - HEIGHT) / 2, AREA[1] - HEIGHT - 6];
  const place = (list, row) =>
    list.map((entry, index) => {
      const gap = Math.min(12, (AREA[0] - list.length * WIDTH) / (list.length + 1));
      const span = list.length * WIDTH + (list.length - 1) * gap;
      return { name: entry, x: (AREA[0] - span) / 2 + index * (WIDTH + gap), y: tops[row] };
    });
  const placed = rows.map(place);
  const middle = placed[1][0];
  const lines = [...placed[0], ...placed[2]].map((entry) => {
    const above = entry.y < middle.y;
    return {
      key: `${entry.name}-${entry.x}`,
      x1: entry.x + WIDTH / 2,
      y1: above ? entry.y + HEIGHT : entry.y,
      x2: middle.x + WIDTH / 2,
      y2: above ? middle.y : middle.y + HEIGHT,
    };
  });
  return (
    <div className="relative h-[200px] w-full shrink-0 overflow-hidden border-2 border-black bg-cover" style={{ backgroundImage: `url(${panorama(base, "hud/reborn/bg_item_breakdown_recessed_psd")})` }}>
      <svg aria-hidden className="absolute inset-0 size-full" viewBox={`0 0 ${AREA[0]} ${AREA[1]}`} preserveAspectRatio="none">
        {/* from Middle (white 0.05) to Nothing (white 0.2) at the item made */}
        <defs>
          {lines.map((line, index) => (
            <linearGradient key={line.key} id={`connector-${index}`} gradientUnits="userSpaceOnUse" x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}>
              <stop offset="0" stopColor="#fff" stopOpacity="0.05" />
              <stop offset="0.55" stopColor="#fff" stopOpacity="0.05" />
              <stop offset="1" stopColor="#fff" stopOpacity="0.2" />
            </linearGradient>
          ))}
        </defs>
        {lines.map(({ key, ...line }, index) => (
          <line key={key} {...line} stroke={`url(#connector-${index})`} strokeWidth="3" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 3px black)" }} />
        ))}
      </svg>
      {placed.flat().map((entry, index) => {
        const recipe = entry.name.startsWith("item_recipe_");
        return (
          <button
            key={`${entry.name}-${index}`}
            onClick={() => !recipe && entry.name !== name && onPick(entry.name)}
            aria-label={entry.name}
            className="absolute bg-black shadow-[1px_1px_24px_#000a] transition-[filter] duration-200 hover:brightness-200 active:brightness-150"
            style={{ left: entry.x, top: entry.y, width: WIDTH, height: HEIGHT }}
          >
            <img
              src={recipe ? shopItemIcon(base, "item_recipe") : shopItemIcon(base, entry.name, items[entry.name])}
              alt=""
              className="size-full object-cover"
              onError={(event) => (event.currentTarget.style.visibility = "hidden")}
            />
          </button>
        );
      })}
    </div>
  );
}

// DOTAAbilityDetails as the Items page shows it (.IsItem .ShowExtraDescription)
function ItemDetails({ base, items, texts, name, neutralTier, shopsOf, onPick, upgrades, components }) {
  const item = items[name];
  if (!item) {
    return null;
  }
  const title = textOf(texts, name) ?? name;
  const cost = Number(item.ItemCost) || 0;
  const consumable = item.ItemQuality === "consumable";
  const parts = descriptionParts(texts[`DOTA_Tooltip_ability_${name}_Description`]);
  const bonuses = bonusLines(item, name, texts);
  const notes = [0, 1, 2, 3, 4, 5, 6, 7].map((index) => texts[`DOTA_Tooltip_ability_${name}_Note${index}`]).filter(Boolean);
  const lore = texts[`DOTA_Tooltip_ability_${name}_Lore`];
  const costs = [
    ["ability_cooldown_icon_psd", abilityValue(item, "AbilityCooldown")],
    ["ability_manacost_icon_psd", abilityValue(item, "AbilityManaCost")],
    ["ability_healthcost_icon_psd", abilityValue(item, "AbilityHealthCost")],
  ].filter(([, value]) => value && !/^0(\.0+)?$/.test(value));
  const shops = [
    ["main", "shop_icon_main_psd", "Available at Home Shop"],
    ["side", "shop_icon_side_psd", "Available at Side Shop"],
    ["secret", "shop_icon_secret_psd", "Available at Secret Shop"],
  ].filter(([id]) => shopsOf.has(id));

  return (
    <>
      <div
        className="mr-[-8px] ml-[2px] flex min-h-0 flex-col bg-no-repeat p-[8px]"
        style={{ backgroundImage: `url(${panorama(base, "hud/ability_tooltip_psd")})`, backgroundPosition: "0 -44px" }}
      >
        {/* #Header: the picture, the name, the cost or the neutral tier, the shops' icons */}
        <div className="flex">
          <img
            src={shopItemIcon(base, name, item)}
            alt=""
            className="mt-[4px] mr-[8px] mb-[6px] ml-[4px] h-[48px] w-[66px] shrink-0 object-cover shadow-[0_0_4px_black]"
            onError={(event) => (event.currentTarget.style.visibility = "hidden")}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="mt-[2px] truncate pl-[4px] text-[18px] font-semibold tracking-[0.5px] text-[#e1e1e1] uppercase [text-shadow:2px_2px_0_#00000090]">{title}</h2>
            <div className="-mt-[4px] flex w-full items-center">
              {shops.map(([id, icon]) => (
                <Washed key={id} src={panorama(base, `control_icons/${icon}`)} color="#748090" className="mr-[-2px] size-[30px] shrink-0" />
              ))}
              <div className="flex flex-col">
                {neutralTier && (
                  <span className="mt-[2px] pl-[4px] text-[16px] text-[#666]">
                    <span className="font-semibold" style={{ color: TIER_COLORS[neutralTier - 1] }}>
                      Tier {neutralTier}
                    </span>{" "}
                    Neutral Item
                  </span>
                )}
                {cost > 0 && (
                  <span className="flex items-center">
                    <span aria-hidden className="mr-[5px] ml-[4px] size-[23px] bg-[length:100%]" style={{ backgroundImage: `url(${panorama(base, "hud/icon_gold_psd")})` }} />
                    <span className="mt-[3px] text-[16px] font-bold text-[#FFCC33] tabular-nums [text-shadow:2px_2px_0_#00000088]">{cost.toLocaleString("en")}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* #AbilityCoreDetails: 16 below, at most 440 high, scrolling */}
        <div className="mt-[16px] max-h-[440px] overflow-y-auto pr-[10px] scrollbar-thin">
          {bonuses.length > 0 && (
            <div className="mb-[10px] ml-[4px] text-[17px] text-[#748090] [text-shadow:2px_2px_0_#00000088]">
              {bonuses.map((line) => (
                <div key={line.key}>
                  <span className="font-semibold text-[#e1e1e1]">{line.value}</span> {line.label}
                </div>
              ))}
            </div>
          )}
          {/* #AbilityDescriptionOuterContainer: the costs over the description's top right */}
          <div className="relative ml-[2px]">
            {costs.length > 0 && (
              <div className="absolute top-[4px] right-[8px] z-10 flex flex-row-reverse">
                {costs.map(([icon, value]) => (
                  <span
                    key={icon}
                    className="ml-[10px] bg-[length:20px] bg-[0%_50%] bg-no-repeat pt-[2px] pl-[25px] text-[16px] font-semibold text-[#e1e1e1] [text-shadow:2px_2px_0_#00000088]"
                    style={{ backgroundImage: `url(${panorama(base, `status_icons/${icon}`)})` }}
                  >
                    {value}
                  </span>
                ))}
              </div>
            )}
            <div className="flex w-[330px] flex-col">
              {parts.map((part, index) => {
                const active = /^(active|use|toggle)\b/i.test(part.header ?? "");
                const look = active
                  ? consumable
                    ? { header: "item_tooltip_use_psd", ground: "from-[#15221f] to-[#1a2926]", text: "text-[#7b8a72]", h1: "text-[#95c07a]" }
                    : { header: "item_tooltip_active_psd", ground: "from-[#171d2f] to-[#1b2437]", text: "text-[#7a80a7]", h1: "text-[#b0b0ff]" }
                  : { header: "item_tooltip_passive_psd", ground: "from-[#1c262f] to-[#1b262f]", text: "text-[#626d7b]", h1: "text-[#91a0b4]" };
                const label = `w-[330px] bg-gradient-to-b px-[8px] text-[16px] [text-shadow:2px_2px_0_#00000090] ${look.ground} ${look.text}`;
                return (
                  <Fragment key={index}>
                    {part.header && (
                      <div className={`${label} h-[28px] bg-no-repeat pt-[4px] [background-position:top]`} style={{ backgroundImage: `url(${panorama(base, `hud/${look.header}`)})` }}>
                        <span className={`font-semibold ${look.h1}`}>{part.header}</span>
                      </div>
                    )}
                    <p className={`${label} mb-[8px] whitespace-pre-line pt-[6px] pb-[8px]`}>{filled(part.body, item)}</p>
                  </Fragment>
                );
              })}
            </div>
          </div>
          {notes.length > 0 && (
            <div className="bg-[rgb(37,56,68)] px-[12px] pt-[4px] pb-[8px] text-[16px] text-[rgb(158,182,197)]">
              {notes.map((note, index) => (
                <p key={index} className="whitespace-pre-line">
                  {filled(note, item)}
                </p>
              ))}
            </div>
          )}
          {lore && <p className="mt-[12px] ml-px w-[330px] bg-[#0b1215] px-[10px] py-[5px] text-[14px] text-[#3d4e5b] italic">{lore}</p>}
        </div>
      </div>
      <div className="flex-1" />
      {/* #ItemAvailability */}
      <div className="flex w-full flex-col">
        {shops.map(([id, icon, label]) => (
          <div key={id} className="flex">
            <Washed src={panorama(base, `control_icons/${icon}`)} color="#ccc" className="size-[30px] shrink-0" />
            <span className="mt-[4px] ml-[3px] self-center text-[18px] text-[#ccc]">{label}</span>
          </div>
        ))}
      </div>
      {!neutralTier && <Combines base={base} items={items} name={name} upgrades={upgrades} components={components} onPick={onPick} />}
    </>
  );
}

// DOTAQuickSearch: typing on the page writes the letters across it in 100 high capitals that fade
// out in a second, and lights the items whose names match; Escape clears it
function useQuickSearch() {
  const [query, setQuery] = useState("");
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    const onKey = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.target.closest?.("input, textarea, select, [contenteditable]")) {
        return;
      }
      if (event.key === "Escape") {
        setQuery("");
      } else if (event.key === "Backspace") {
        setQuery((current) => current.slice(0, -1));
        setFlash((value) => value + 1);
      } else if (event.key.length === 1 && /\S| /.test(event.key)) {
        setQuery((current) => (current + event.key).replace(/^\s+/, ""));
        setFlash((value) => value + 1);
      } else {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return [query, flash];
}

export default function ItemsPage({ catalog, id, language, onOpen }) {
  const { scale } = useUiLayout();
  const base = catalog.modelsBase;
  const { data, error } = useGameData(base, ["items.json", "neutral_items.json"], language);
  // shops.json came with data version 19; until it is in the dataset the tables wait for it
  const { data: shopData, error: shopError } = useGameData(base, ["shops.json"], language);
  const [query, flash] = useQuickSearch();

  const items = data?.items ?? {};
  const texts = data?.texts;
  const shops = shopData?.shops ?? {};
  const mainShop = useMemo(() => new Set(MAIN_SHOP.flatMap((category) => shops[category] ?? [])), [shops]);
  const tiers = useMemo(() => Object.entries(data?.neutral_items?.neutral_items?.neutral_tiers ?? {}).sort((a, b) => Number(a[0]) - Number(b[0])), [data]);
  const tierOf = useMemo(() => {
    const result = {};
    for (const [number, entry] of tiers) {
      for (const name of Object.keys(entry.items ?? {})) result[name] ??= Number(number);
      for (const group of Object.values(entry.enhancements ?? {})) for (const name of Object.keys(group ?? {})) result[name] ??= Number(number);
    }
    return result;
  }, [tiers]);

  const selected = id && items[id] ? id : shops.consumables?.[0] ?? null;
  const pick = (name) => onOpen({ type: "shop", id: name });

  const search = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle || !texts) {
      return null;
    }
    const found = new Set();
    for (const name of Object.keys(items)) {
      const title = String(textOf(texts, name) ?? "").toLowerCase();
      const alias = String(texts[`DOTA_SearchAlias_Ability_${name}`] ?? "").toLowerCase();
      if (title.includes(needle) || alias.split(";").some((entry) => entry.trim().startsWith(needle))) {
        found.add(name);
      }
    }
    return found;
  }, [query, items, texts]);

  // The recipe both ways, among the items the shop sells
  const components = selected ? componentsOf(items, selected) : [];
  const upgrades = useMemo(() => {
    if (!selected) {
      return [];
    }
    const sold = mainShop.size ? [...new Set([...mainShop, ...(shops.secretshop ?? [])])] : Object.keys(items);
    return sold.filter((name) => componentsOf(items, name).includes(selected));
  }, [selected, items, mainShop, shops]);
  const shopsOf = useMemo(() => {
    const result = new Set();
    if (!selected || tierOf[selected]) {
      return result;
    }
    if (mainShop.has(selected)) result.add("main");
    if (items[selected]?.SideShop === "1") result.add("side");
    if (items[selected]?.SecretShop === "1") result.add("secret");
    return result;
  }, [selected, items, mainShop, tierOf]);

  const message = error ? `The items' data did not load. ${error}` : !data ? "Loading the items" : null;

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-[#0d0e12]">
      <div className="absolute inset-0" style={{ zoom: scale }}>
        {/* The neutral items and their enchantments run past 1080 at the game's sizes: the page scrolls */}
        <div className="absolute inset-0 flex flex-col overflow-y-auto pb-[24px] scrollbar-thin">
        {message ? (
          <p className="mt-[160px] text-center text-[18px] text-[#8b989e]">{message}</p>
        ) : (
          // #PageContents: centred, the tables and the details side by side
          <div className="isolate mx-auto mt-[69px] flex shrink-0">
            {shopError ? (
              <p className="ml-[12px] w-[600px] pt-[40px] text-[16px] text-[#8b989e]">The shop's categories are not in the dataset yet.</p>
            ) : shopData ? (
              <ItemTable base={base} items={items} shops={shops} mainShop={mainShop} selected={selected} search={search} onPick={pick} />
            ) : null}
            <NeutralTable base={base} items={items} tiers={tiers} selected={selected} search={search} onPick={pick} />
            {/* #ItemDetails: 350 wide, its contents 749 high on the tooltip's ground */}
            <div className="ml-[12px] flex w-[350px] flex-col">
              <h3 className={COLUMN_TITLE}>Item Details</h3>
              <div
                className="flex h-[749px] w-full flex-col border border-[#141919] bg-[#10171D] bg-no-repeat [background-position:left_top]"
                style={{ backgroundImage: `url(${panorama(base, "hud/reborn/bg_tooltip_no_bevel_psd")})` }}
              >
                {selected && texts && (
                  <ItemDetails
                    base={base}
                    items={items}
                    texts={texts}
                    name={selected}
                    neutralTier={tierOf[selected]}
                    shopsOf={shopsOf}
                    upgrades={upgrades}
                    components={components}
                    onPick={pick}
                  />
                )}
              </div>
            </div>
          </div>
        )}
        </div>
        {/* #ItemQuickSearch: the letters typed, fading out; middle of the page less its 200 margin below */}
        {query && (
          <div aria-live="polite" className="pointer-events-none absolute inset-x-0 top-[calc(50%-100px)] -translate-y-1/2 text-center">
            <span key={flash} className="animate-[quick-search_1s_forwards] text-[100px] text-white uppercase">
              {query}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
