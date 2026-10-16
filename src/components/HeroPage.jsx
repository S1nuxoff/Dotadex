import { Fragment, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { abilityIcon, useGameData } from "../gamedata.js";
import { attributeIcon } from "./HeroGrid.jsx";
import HeroInfo from "./HeroInfo.jsx";
import Voice from "./Voice.jsx";
import ChatWheel from "./ChatWheel.jsx";

// Which sound and voice lines go with each ability (abilitysounds.json), loaded once
let abilitySounds = null;
function loadAbilitySounds(modelsBase) {
  abilitySounds ??= fetch(`${modelsBase}data/abilitysounds.json`)
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}));
  return abilitySounds;
}

// The keys the game casts with: the ultimate on R, the others on Q W E, then D F
function castKeys(abilities, known) {
  const keys = {};
  const basic = ["Q", "W", "E", "D", "F"];
  let next = 0;
  for (const name of abilities) {
    keys[name] = known[name]?.AbilityType === "DOTA_ABILITY_TYPE_ULTIMATE" ? "R" : basic[next++];
  }
  return keys;
}

// A hero's page as the game shows it: the model on the left; on the right its name, attribute,
// complexity, attack type and roles, its abilities, then LOADOUT / VOICE / STATS / ABOUT

const TABS = [
  ["loadout", "Loadout"],
  ["voice", "Voice"],
  ["stats", "Stats"],
  ["about", "About"],
];

function HeroHeader({ catalog, hero, info, data, onAbout, onCast }) {
  const roles = (info?.Role ?? "").split(",").filter(Boolean);
  const ranged = (info?.AttackCapabilities ?? "").includes("RANGED");
  const complexity = Number(info?.Complexity ?? 1);
  const known = data?.abilities ?? {};
  const texts = data?.texts ?? {};
  const abilities = info
    ? Array.from({ length: 9 }, (_, index) => info[`Ability${index + 1}`]).filter(
        (name) => name && name !== "generic_hidden" && !name.startsWith("special_bonus") && known[name] && !/HIDDEN/.test(known[name].AbilityBehavior ?? "")
      )
    : [];
  const keys = castKeys(abilities, known);
  return (
    <div>
      <h1 className="font-display text-5xl leading-none tracking-[0.04em] text-bone 2xl:text-6xl">{hero.name}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        {info && <img src={attributeIcon(info.AttributePrimary)} alt="" className="size-8" />}
        <span className="flex gap-1" title={`Complexity ${complexity}`}>
          {[1, 2, 3].map((level) => (
            <span key={level} className={`size-3 rotate-45 border ${level <= complexity ? "border-bone bg-bone" : "border-ash/60"}`} />
          ))}
        </span>
        <span className="flex flex-wrap gap-x-5 font-sans text-[17px] font-semibold uppercase tracking-[0.2em] text-ash">
          {[ranged ? "Ranged" : "Melee", ...roles].map((word) => (
            <span key={word}>{word}</span>
          ))}
        </span>
      </div>
      {abilities.length > 0 && (
        <div className="mt-4 flex flex-wrap items-start gap-2">
          {abilities.map((name) => {
            const title = texts[`DOTA_Tooltip_ability_${name}`] ?? name.replace(/_/g, " ");
            const key = keys[name];
            return (
              <button key={name} onClick={() => onCast(name)} className="group w-[60px]" title={`${title}${key ? ` (${key})` : ""}`}>
                <span className="relative mx-auto block size-[52px]">
                  <img
                    src={abilityIcon(catalog.modelsBase, name, known[name])}
                    alt=""
                    className="size-full border border-black/80 object-cover shadow-[0_2px_8px_rgb(0_0_0/0.6)] transition group-hover:brightness-125 group-active:scale-95"
                    onError={(event) => (event.currentTarget.style.visibility = "hidden")}
                  />
                  {key && (
                    <span className="absolute -top-1.5 -left-1.5 grid size-5 place-items-center border border-black/80 bg-[#1a1f25] font-sans text-[11px] font-semibold text-bone">
                      {key}
                    </span>
                  )}
                </span>
                <span className="mt-1 line-clamp-2 block text-center text-[11px] leading-tight text-bone/75">{title}</span>
              </button>
            );
          })}
          {/* The talent tree and Aghanim's Scepter and Shard, as the game puts them after the abilities */}
          {[
            ["talents.svg", "Talents"],
            ["aghs_off_large.png", "Aghanim's"],
          ].map(([file, label]) => (
            <button key={file} onClick={onAbout} data-sound="click" data-hover className="w-[60px] text-center" title={label}>
              <img src={`${import.meta.env.BASE_URL}ui/${file}`} alt="" className="mx-auto size-[52px] object-contain p-0.5 opacity-80 transition-opacity hover:opacity-100" />
              <span className="mt-1 block text-[11px] leading-tight text-bone/75">{label}</span>
            </button>
          ))}
          <ChatWheel modelsBase={catalog.modelsBase} heroId={hero.id} />
        </div>
      )}
    </div>
  );
}

function Stats({ info }) {
  if (!info) {
    return null;
  }
  const number = (key) => Number(info[key] ?? 0);
  const rows = [
    ["Strength", `${number("AttributeBaseStrength")} +${number("AttributeStrengthGain")}`, "#e0533e"],
    ["Agility", `${number("AttributeBaseAgility")} +${number("AttributeAgilityGain")}`, "#3fc364"],
    ["Intelligence", `${number("AttributeBaseIntelligence")} +${number("AttributeIntelligenceGain")}`, "#3f9fe0"],
    ["Damage", `${number("AttackDamageMin")}–${number("AttackDamageMax")}`],
    ["Attack time", number("AttackRate")],
    ["Attack range", number("AttackRange")],
    ["Projectile speed", number("ProjectileSpeed") || "Instant"],
    ["Armor", number("ArmorPhysical")],
    ["Magic resistance", `${number("MagicalResistance") || 25}%`],
    ["Move speed", number("MovementSpeed")],
    ["Turn rate", number("MovementTurnRate")],
    ["Vision", `${number("VisionDaytimeRange")} / ${number("VisionNighttimeRange")}`],
    ["Health regen", number("StatusHealthRegen")],
    ["Mana regen", number("StatusManaRegen")],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-10 gap-y-0 text-base">
      {rows.map(([label, value, color]) => (
        <div key={label} className="flex justify-between gap-4 border-b border-black/50 py-2.5">
          <dt className="text-ash" style={color ? { color } : undefined}>
            {label}
          </dt>
          <dd className="text-bone tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function HeroPage({ catalog, hero, language, viewer, loadout, previous, next, onOpen }) {
  const [tab, setTab] = useState("loadout");
  const { data } = useGameData(catalog.modelsBase, ["heroes.json", "abilities.json"], language);
  const info = data?.heroes[`npc_dota_hero_${hero.id}`];

  // Casting: a click on an ability or its key sends its animation, sound and voice lines to the stage
  const cast = (ability) => {
    const known = data?.abilities ?? {};
    const list = info ? Array.from({ length: 9 }, (_, index) => info[`Ability${index + 1}`]).filter((name) => name && known[name]) : [];
    loadAbilitySounds(catalog.modelsBase).then((all) => {
      const entry = all[`npc_dota_hero_${hero.id}`]?.[ability] ?? {};
      window.dispatchEvent(
        new CustomEvent("dotadex:cast", { detail: { ability, index: Math.max(0, list.indexOf(ability)), sounds: entry.sounds ?? [], lines: entry.lines ?? [] } })
      );
    });
  };
  useEffect(() => {
    if (!info || !data?.abilities) {
      return;
    }
    const known = data.abilities;
    const abilities = Array.from({ length: 9 }, (_, index) => info[`Ability${index + 1}`]).filter(
      (name) => name && name !== "generic_hidden" && !name.startsWith("special_bonus") && known[name] && !/HIDDEN/.test(known[name].AbilityBehavior ?? "")
    );
    const keys = castKeys(abilities, known);
    const onKey = (event) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target.closest?.("input, textarea")) {
        return;
      }
      // The key's place on the keyboard, so it works in any layout, as in the game
      const ability = abilities.find((name) => `Key${keys[name]}` === event.code);
      if (ability) {
        cast(ability);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="relative min-h-0 flex-1">
      {/* The stage fills the page; the text lies over it on the right, as in the game */}
      <div className="absolute inset-0">{viewer}</div>
      {[
        [previous, "left-0", ChevronLeft],
        [next, "right-0", ChevronRight],
      ].map(
        ([other, side, Icon]) =>
          other && (
            <button
              key={side}
              onClick={() => onOpen({ type: "hero", id: other.id })}
              data-hover
              data-sound="toptab"
              className={`group absolute top-6 ${side} z-20 flex items-center gap-2 px-1 ${side === "right-0" ? "flex-row-reverse" : ""}`}
            >
              <span className="grid h-12 w-8 place-items-center border border-black/70 bg-black/40 text-ash transition-colors group-hover:text-bone">
                <Icon className="size-6" />
              </span>
              <span className={`max-w-28 font-display text-xs tracking-[0.14em] text-ash/70 transition-colors group-hover:text-bone ${side === "right-0" ? "text-right" : ""}`}>
                {other.name}
              </span>
            </button>
          )
      )}
      <div className="pointer-events-none absolute inset-y-0 right-0 flex w-[45%] flex-col bg-gradient-to-l from-black/40 via-black/15 to-transparent">
        <div className="pointer-events-auto shrink-0 pt-8 pr-28 pl-2">
          <HeroHeader catalog={catalog} hero={hero} info={info} data={data} onAbout={() => setTab("about")} onCast={cast} />
          <div className="mt-6 flex items-center gap-4 pb-3" role="tablist">
            {TABS.map(([id, label], index) => (
              <Fragment key={id}>
                {index > 0 && (
                  <span className="text-ash/35" aria-hidden>
                    /
                  </span>
                )}
                <button
                  role="tab"
                  aria-selected={tab === id}
                  data-sound="toptab"
                  onClick={() => setTab(id)}
                  className={`font-sans text-[19px] uppercase tracking-[0.12em] transition-colors ${
                    tab === id ? "text-bone [text-shadow:0_0_14px_rgb(255_255_255/0.3)]" : "text-ash/70 hover:text-bone"
                  }`}
                >
                  {label}
                </button>
              </Fragment>
            ))}
          </div>
        </div>
        <div className={`pointer-events-auto min-h-0 flex-1 overflow-y-auto pr-6 scrollbar-thin ${tab === "loadout" ? "[&>div]:pl-4" : "py-5 pl-4"}`}>
          {tab === "loadout" && loadout}
          {tab === "voice" && <Voice modelsBase={catalog.modelsBase} heroKey={`npc_dota_hero_${hero.id}`} />}
          {tab === "stats" && <Stats info={info} />}
          {tab === "about" && <HeroInfo base={catalog.modelsBase} heroKey={`npc_dota_hero_${hero.id}`} language={language} />}
        </div>
      </div>
    </div>
  );
}
