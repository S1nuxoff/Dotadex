import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { abilityIcon, useGameData } from "../gamedata.js";
import { useUiScale } from "./ui.jsx";
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
    keys[name] = /ULTIMATE/.test(known[name]?.AbilityType ?? "") ? "R" : basic[next++];
  }
  return keys;
}

// The abilities cast from the keyboard: not the innate, not hidden ones
function castable(info, known) {
  return Array.from({ length: 9 }, (_, index) => info[`Ability${index + 1}`]).filter(
    (name) => name && name !== "generic_hidden" && !name.startsWith("special_bonus") && known[name] && known[name].Innate !== "1" && !/HIDDEN/.test(known[name].AbilityBehavior ?? "")
  );
}

// A hero's page as the game has it now (dashboard_page_hero_new_v2): the hero's backdrop, the
// model in the middle; on the left its name, attribute, complexity, attack type and tags, its
// abilities and stats; on the right what it wears. Sizes are the game's, on a 1920 wide screen.

const TABS = [
  ["loadout", "Loadout"],
  ["voice", "Voice"],
  ["stats", "Stats"],
  ["about", "About"],
];

// The game's numbers for what each point of an attribute gives
const HEALTH_PER_STRENGTH = 22;
const HEALTH_REGEN_PER_STRENGTH = 0.1;
const MANA_PER_INTELLIGENCE = 12;
const MANA_REGEN_PER_INTELLIGENCE = 0.05;
const ARMOR_PER_AGILITY = 1 / 6;
const UNIVERSAL_DAMAGE = 0.45;

const ATTRIBUTES = {
  DOTA_ATTRIBUTE_STRENGTH: "strength",
  DOTA_ATTRIBUTE_AGILITY: "agility",
  DOTA_ATTRIBUTE_INTELLECT: "intelligence",
  DOTA_ATTRIBUTE_ALL: "all",
};
const image = (base, path) => `${base}images/${path}.png`;
const mask = (url) => ({ mask: `url(${url}) center / contain no-repeat`, WebkitMask: `url(${url}) center / contain no-repeat` });

// Which backdrop each hero has, loaded once
let backgrounds = null;
function loadBackgrounds(base) {
  backgrounds ??= fetch(`${base}data/loadout_backgrounds.json`)
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  return backgrounds;
}

// The picture behind the hero: the game's backdrop for it, blurred, faded and washed in its
// color over a gradient of its own, the edges sinking into the dark
function Backdrop({ base, heroId }) {
  const [all, setAll] = useState(null);
  useEffect(() => {
    loadBackgrounds(base).then(setAll);
  }, [base]);
  const look = all?.heroes[heroId];
  const maskUrl = all?.mask && `url(${base}${all.mask})`;
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: look?.from ? `linear-gradient(${look.from}, ${look.to})` : "linear-gradient(#1b1f2a, #0d0e12)" }}>
      {look?.image && (
        <div
          className="absolute inset-0 mx-auto max-w-[1920px]"
          style={{
            backgroundImage: `url(${base}${look.image})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(6px) saturate(0.52)",
            maskImage: maskUrl,
            WebkitMaskImage: maskUrl,
            maskSize: "100% 100%",
            WebkitMaskSize: "100% 100%",
            maskMode: "luminance",
          }}
        >
          {look.wash && <div className="absolute inset-0 mix-blend-color" style={{ background: look.wash }} />}
        </div>
      )}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_75%_70%_at_50%_45%,transparent_55%,rgb(0_0_0/0.65))]" />
    </div>
  );
}

// The name on one line, made smaller when it is too long for the column, as the game shrinks it
const NAME_SIZE = 68;
function HeroName({ name }) {
  const ref = useRef(null);
  const [size, setSize] = useState(NAME_SIZE);
  useLayoutEffect(() => {
    let current = true;
    const measure = () => {
      const element = ref.current;
      if (!current || !element) {
        return;
      }
      // Both widths as drawn, so the page's zoom falls out of the ratio
      element.style.fontSize = `${NAME_SIZE}px`;
      const text = element.getBoundingClientRect().width;
      const room = element.parentElement.getBoundingClientRect().width;
      element.style.fontSize = "";
      setSize(text > room ? Math.floor((NAME_SIZE * room) / text) : NAME_SIZE);
    };
    measure();
    // Measured again once the title font is in, as it is wider than the one standing in for it
    document.fonts?.ready.then(measure);
    return () => {
      current = false;
    };
  }, [name]);
  return (
    <h1 className="flex h-[75px] w-[660px] items-center">
      <span ref={ref} className="shrink-0 font-display leading-none font-bold tracking-normal whitespace-nowrap text-white" style={{ fontSize: size }}>
        {name}
      </span>
    </h1>
  );
}

function Label({ children }) {
  return <span className="text-[16px] tracking-[2px] text-[#e6ebef]/50 uppercase">{children}</span>;
}

function HeroSummary({ catalog, hero, info, data, onAbout, onCast }) {
  const base = catalog.modelsBase;
  const roles = (info?.Role ?? "").split(",").filter(Boolean);
  const ranged = (info?.AttackCapabilities ?? "").includes("RANGED");
  const complexity = Number(info?.Complexity ?? 1);
  const known = data?.abilities ?? {};
  const texts = data?.texts ?? {};
  const innate = info
    ? Array.from({ length: 9 }, (_, index) => info[`Ability${index + 1}`]).filter((name) => name && known[name]?.Innate === "1")
    : [];
  const abilities = info ? castable(info, known) : [];
  const keys = castKeys(abilities, known);
  const attribute = ATTRIBUTES[info?.AttributePrimary] ?? "all";
  const ability = (name, round) => {
    const title = texts[`DOTA_Tooltip_ability_${name}`] ?? name.replace(/_/g, " ");
    const key = keys[name];
    return (
      <button key={name} onClick={() => !round && onCast(name)} title={`${title}${key ? ` (${key})` : ""}`} className="group mr-[8px] mb-[8px] size-[52px]">
        <img
          src={abilityIcon(base, name, known[name])}
          alt=""
          className={`size-full object-cover shadow-[0_4px_8px_#000] transition group-hover:brightness-125 group-active:scale-95 ${round ? "rounded-full border-2 border-[#5c6470]" : ""}`}
          onError={(event) => (event.currentTarget.style.visibility = "hidden")}
        />
      </button>
    );
  };

  return (
    <div>
      <HeroName name={hero.name} />
      {/* Attribute, complexity, attack type and tags in one row */}
      <div className="mt-[4px] mb-[2px] flex items-center">
        <img src={image(base, `primary_attribute_icons/primary_attribute_icon_${attribute}_psd`)} alt="" title={attribute} className="mr-[12px] size-[32px]" />
        <span className="mr-[14px] flex items-center gap-[9px]" title={`Complexity ${complexity}`}>
          {[1, 2, 3].map((level) => (
            <span key={level} className={`size-[11px] rotate-45 ${level <= complexity ? "bg-[#dedede]" : "border-2 border-[#dedede]"}`} />
          ))}
        </span>
        <span className="mr-[16px] flex items-center gap-[6px]">
          <Label>Attack type:</Label>
          <span title={ranged ? "Ranged" : "Melee"} className="size-[30px] bg-[#c4c9cf]" style={mask(image(base, `control_icons/filter_${ranged ? "ranges" : "melee"}_png`))} />
        </span>
        <span className="flex items-center gap-[6px]">
          <Label>Tags:</Label>
          <span className="flex">
            {roles.map((role) => (
              <span key={role} title={role} className="-mr-[2px] size-[30px] bg-[#c4c9cf] hover:bg-[#dfe3e7]" style={mask(image(base, `control_icons/filter_${role.toLowerCase()}_png`))} />
            ))}
          </span>
        </span>
      </div>
      {/* The talent tree, the innate, the abilities, then Aghanim's */}
      <div className="mt-[12px] flex flex-wrap items-center">
        <button onClick={onAbout} data-sound="click" title="Talents" className="mr-[8px] mb-[8px] size-[52px]">
          <img src={`${import.meta.env.BASE_URL}ui/talents.svg`} alt="" className="size-full object-contain opacity-80 hover:opacity-100" />
        </button>
        {innate.map((name) => ability(name, true))}
        {abilities.map((name) => ability(name, false))}
        <button onClick={onAbout} data-sound="click" title="Aghanim's Scepter and Shard" className="mr-[8px] mb-[8px] size-[52px]">
          <img src={`${import.meta.env.BASE_URL}ui/aghs_off_large.png`} alt="" className="size-full object-contain p-[4px] opacity-80 hover:opacity-100" />
        </button>
        <ChatWheel modelsBase={base} heroId={hero.id} />
      </div>
      {info && <StatsSummary base={base} info={info} />}
    </div>
  );
}

// Attributes on the left; damage, armor, speed, attack time and speed, range, then health and
// mana at level 1, as the game works them out from the attributes
function StatsSummary({ base, info }) {
  const number = (key, fallback = 0) => Number(info[key] ?? fallback);
  const strength = number("AttributeBaseStrength");
  const agility = number("AttributeBaseAgility");
  const intelligence = number("AttributeBaseIntelligence");
  const bonus = {
    DOTA_ATTRIBUTE_STRENGTH: strength,
    DOTA_ATTRIBUTE_AGILITY: agility,
    DOTA_ATTRIBUTE_INTELLECT: intelligence,
  }[info.AttributePrimary] ?? Math.floor((strength + agility + intelligence) * UNIVERSAL_DAMAGE);
  const round = (value) => Math.round(value * 10) / 10;
  const derived = [
    ["icon_damage_psd", "Damage", `${number("AttackDamageMin") + bonus} - ${number("AttackDamageMax") + bonus}`],
    ["icon_armor_psd", "Armor", round(number("ArmorPhysical") + agility * ARMOR_PER_AGILITY)],
    ["icon_speed_psd", "Movement speed", number("MovementSpeed")],
    ["icon_attack_speed_psd", "Base attack time", number("AttackRate")],
    ["icon_attack_speed2_psd", "Attack speed", number("BaseAttackSpeed", 100) + agility],
    ["icon_attack_range_psd", "Attack range", number("AttackRange")],
  ];
  const attributes = [
    ["Strength", "strength", strength, number("AttributeStrengthGain")],
    ["Agility", "agility", agility, number("AttributeAgilityGain")],
    ["Intelligence", "intelligence", intelligence, number("AttributeIntelligenceGain")],
  ];
  const pools = [
    ["Health", number("StatusHealth", 120) + strength * HEALTH_PER_STRENGTH, round(number("StatusHealthRegen") + strength * HEALTH_REGEN_PER_STRENGTH), "from-[#2f8a3c] to-[#57c043]"],
    ["Mana", number("StatusMana", 75) + intelligence * MANA_PER_INTELLIGENCE, round(number("StatusManaRegen") + intelligence * MANA_REGEN_PER_INTELLIGENCE), "from-[#1a5ca8] to-[#3a8fe0]"],
  ];
  const line = "linear-gradient(90deg, #ffffff10, #ffffff00)";
  return (
    <div className="relative my-[8px] flex w-[500px]">
      <span aria-hidden className="absolute inset-x-0 top-0 h-px" style={{ background: line }} />
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-px" style={{ background: line }} />
      <div className="w-[128px] border-r border-white/[0.02] py-[16px]">
        {attributes.map(([label, icon, value, gain]) => (
          <div key={label} className="mb-[8px]">
            <p className="mb-[2px] text-[13px] tracking-[1.5px] text-[#e6ebef]/40 uppercase">{label}</p>
            <p className="flex items-center text-[20px] tracking-[0.8px] text-[#e6ebef]">
              <img src={image(base, `primary_attribute_icons/primary_attribute_icon_${icon}_psd`)} alt="" className="mr-[8px] size-[20px]" />
              {value} + {round(gain)}
            </p>
          </div>
        ))}
      </div>
      <div className="flex-1">
        <div className="mt-[16px] ml-[16px] flex pr-[24px]">
          {derived.map(([icon, label, value]) => (
            <div key={label} title={label} className="flex flex-1 flex-col items-center">
              <span className="size-[20px] bg-[#e6ebef]" style={mask(image(base, `hud/reborn/${icon}`))} />
              <span className="mt-[2px] h-[18px] text-[16px] text-[#e6ebef]/80 tabular-nums">{value}</span>
            </div>
          ))}
        </div>
        <div className="mt-[8px] mr-[24px] ml-[16px]">
          {pools.map(([label, value, regen, colors]) => (
            <div key={label}>
              <p className="text-[13px] tracking-[1.5px] text-[#aab4c0] uppercase">{label}</p>
              <div className={`relative mt-[2px] mb-[4px] flex h-[24px] items-center rounded-[3px] bg-gradient-to-r ${colors}`}>
                <span className="absolute inset-x-0 text-center text-[20px] font-semibold text-white [text-shadow:0_2px_5px_#000]">{value}</span>
                <span className="mr-[8px] ml-auto text-[15px] font-semibold text-white/80 [text-shadow:0_1px_5px_#000]">+{regen}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
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
    <dl className="grid grid-cols-2 gap-x-10 gap-y-0 text-[16px]">
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

// The row under the top bar: the previous hero, the page's tabs, the next hero
function HeroNav({ hero, base, tab, onTab, previous, next, onOpen }) {
  const side = (other, forward) =>
    other && (
      <button
        onClick={() => onOpen({ type: "hero", id: other.id })}
        data-sound="toptab"
        className={`flex items-center gap-[10px] text-[16px] tracking-[2px] text-[#808fa6] uppercase hover:text-[#e6ebef] ${forward ? "flex-row-reverse" : ""}`}
      >
        {forward ? <ArrowRight className="size-[22px]" /> : <ArrowLeft className="size-[22px]" />}
        {other.name}
      </button>
    );
  return (
    <div className="flex h-[52px] items-center bg-gradient-to-b from-black/45 to-black/20 px-[60px]">
      <div className="w-[300px]">{side(previous, false)}</div>
      <div className="flex flex-1 items-center justify-center gap-[22px]">
        <img src={image(base, `heroes/icons/npc_dota_hero_${hero.id}_png`)} alt="" className="size-[28px]" onError={(event) => (event.currentTarget.style.display = "none")} />
        {TABS.map(([id, label], index) => (
          <Fragment key={id}>
            {index > 0 && (
              <span className="text-[20px] text-[#808fa6]/50" aria-hidden>
                /
              </span>
            )}
            <button
              role="tab"
              aria-selected={tab === id}
              data-sound="toptab"
              onClick={() => onTab(id)}
              className={`text-[20px] tracking-[4px] uppercase transition-colors ${tab === id ? "text-white [text-shadow:0_0_12px_rgb(255_255_255/0.35)]" : "text-[#808fa6] hover:text-[#e6ebef]"}`}
            >
              {label}
            </button>
          </Fragment>
        ))}
      </div>
      <div className="flex w-[300px] justify-end">{side(next, true)}</div>
    </div>
  );
}

export default function HeroPage({ catalog, hero, language, viewer, summary, wardrobe, wardrobeOpen, onCloseWardrobe, previous, next, onOpen }) {
  const [tab, setTab] = useState("loadout");
  const scale = useUiScale();
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
    const abilities = castable(info, data.abilities);
    const keys = castKeys(abilities, data.abilities);
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

  // Escape closes the outfit picker, or a tab's panel back to the loadout
  useEffect(() => {
    if (!wardrobeOpen && tab === "loadout") {
      return;
    }
    const onKey = (event) => {
      if (event.key === "Escape") {
        wardrobeOpen ? onCloseWardrobe() : setTab("loadout");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wardrobeOpen, onCloseWardrobe, tab]);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <Backdrop base={catalog.modelsBase} heroId={hero.id} />
      {/* The model fills the page under the columns */}
      <div className="absolute inset-0">{viewer}</div>
      <div className="pointer-events-none absolute inset-0 flex flex-col" style={{ zoom: scale }}>
        {wardrobeOpen && tab === "loadout" ? (
          // CHANGE OUTFIT takes the page; the model steps to the left meanwhile
          <div className="relative min-h-0 flex-1">{wardrobe}</div>
        ) : (
          <>
            <div className="pointer-events-auto">
              <HeroNav hero={hero} base={catalog.modelsBase} tab={tab} onTab={setTab} previous={previous} next={next} onOpen={onOpen} />
            </div>
            <div className="relative min-h-0 flex-1">
              <div className="pointer-events-auto absolute top-[90px] left-[90px] w-[540px]">
                <HeroSummary catalog={catalog} hero={hero} info={info} data={data} onAbout={() => setTab(tab === "about" ? "loadout" : "about")} onCast={cast} />
              </div>
              {tab !== "loadout" ? (
                <div className="pointer-events-auto absolute top-[90px] right-[90px] bottom-[40px] w-[620px] shadow-[0_8px_32px_rgb(0_0_0/0.5)]">
                  <div className="h-full overflow-y-auto bg-black/55 p-[24px] pr-[48px] scrollbar-thin">
                    {tab === "voice" && <Voice modelsBase={catalog.modelsBase} heroKey={`npc_dota_hero_${hero.id}`} />}
                    {tab === "stats" && <Stats info={info} />}
                    {tab === "about" && <HeroInfo base={catalog.modelsBase} heroKey={`npc_dota_hero_${hero.id}`} language={language} />}
                  </div>
                  <button
                    onClick={() => setTab("loadout")}
                    data-sound="back"
                    aria-label="Back to the loadout"
                    title="Back to the loadout"
                    className="absolute top-[10px] right-[10px] grid size-[32px] place-items-center rounded-[2px] bg-gradient-to-b from-[#3b434e] to-[#262c34] text-[#e6ebef] shadow-[0_2px_8px_rgb(0_0_0/0.5)] hover:brightness-150"
                  >
                    <X className="size-[20px]" strokeWidth={2.5} />
                  </button>
                </div>
              ) : (
                <div className="pointer-events-auto absolute top-[90px] right-[90px] w-[422px]">{summary}</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
