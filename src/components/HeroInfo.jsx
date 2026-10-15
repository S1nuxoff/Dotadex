import { useState } from "react";
import { ChevronDown, Clock, Droplet } from "lucide-react";
import { ATTRIBUTES, abilityIcon, abilityStats, abilityValue, fillText, useGameData } from "../gamedata.js";

const TALENT_LEVELS = [25, 20, 15, 10];

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-lg bg-stage/60 px-2.5 py-2">
      <p className="text-[11px] text-ash">{label}</p>
      <p className="text-sm text-bone tabular-nums">
        {value}
        {hint && <span className="ml-1 text-xs text-ash">{hint}</span>}
      </p>
    </div>
  );
}

function Ability({ base, name, ability, texts }) {
  const [open, setOpen] = useState(false);
  const title = texts[`DOTA_Tooltip_ability_${name}`] ?? name;
  const description = fillText(texts[`DOTA_Tooltip_ability_${name}_Description`], ability);
  const lore = texts[`DOTA_Tooltip_ability_${name}_Lore`];
  const notes = [0, 1, 2, 3, 4, 5, 6, 7]
    .map((index) => fillText(texts[`DOTA_Tooltip_ability_${name}_Note${index}`], ability))
    .filter(Boolean);
  const cooldown = abilityValue(ability, "AbilityCooldown");
  const mana = abilityValue(ability, "AbilityManaCost");
  const stats = abilityStats(ability, name, texts);
  const passive = /PASSIVE/.test(ability?.AbilityBehavior ?? "");

  return (
    <li className="rounded-lg border border-line bg-stage/40">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-start gap-3 p-2.5 text-left">
        <img
          src={abilityIcon(base, name, ability)}
          alt=""
          loading="lazy"
          className="size-11 shrink-0 rounded"
          onError={(event) => (event.currentTarget.style.visibility = "hidden")}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm text-bone">{title}</span>
            {passive && <span className="shrink-0 text-[11px] text-ash">Passive</span>}
          </span>
          <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ash tabular-nums">
            {cooldown && cooldown !== "0" && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" /> {cooldown}
              </span>
            )}
            {mana && mana !== "0" && (
              <span className="inline-flex items-center gap-1 text-[#6fa8dc]">
                <Droplet className="size-3" /> {mana}
              </span>
            )}
          </span>
        </span>
        <ChevronDown className={`mt-1 size-4 shrink-0 text-ash transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-3 px-3 pb-3 text-sm">
          {description && <p className="whitespace-pre-line text-bone/90">{description}</p>}
          {stats.length > 0 && (
            <dl className="space-y-1 text-xs">
              {stats.map((stat) => (
                <div key={stat.label} className="flex justify-between gap-3">
                  <dt className="text-ash">{stat.label}</dt>
                  <dd className="text-right text-bone tabular-nums">{stat.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {notes.length > 0 && (
            <ul className="list-disc space-y-1 pl-4 text-xs text-ash">
              {notes.map((note) => (
                <li key={note} className="whitespace-pre-line">
                  {note}
                </li>
              ))}
            </ul>
          )}
          {lore && <p className="font-display text-xs leading-relaxed text-ash/90 italic">{lore}</p>}
        </div>
      )}
    </li>
  );
}

// A talent's text with its value filled from the ability it improves
function talentText(name, texts, abilities, heroAbilities) {
  const text = texts[`DOTA_Tooltip_ability_${name}`] ?? name;
  let value = abilityValue(abilities[name], "value");
  if (value === null) {
    for (const ability of heroAbilities) {
      const entry = ability && Object.values(ability.AbilityValues ?? {}).find((field) => typeof field === "object" && name in field);
      if (entry) {
        value = String(entry[name]).replace(/^[+=]/, "");
        break;
      }
    }
  }
  return text.replace(/\{s:[^}]+\}/g, value ?? "?").replace(/<[^>]+>/g, "");
}

export default function HeroInfo({ base, heroKey, language }) {
  const { data, error } = useGameData(base, ["heroes.json", "abilities.json"], language);

  if (error) {
    return <p className="p-4 text-sm text-ash">The hero's data did not load. {error}</p>;
  }
  if (!data) {
    return <p className="p-4 text-sm text-ash">Loading the hero's data</p>;
  }

  const { heroes, abilities, texts } = data;
  const hero = heroes[heroKey];
  if (!hero) {
    return <p className="p-4 text-sm text-ash">No data for this hero yet.</p>;
  }

  const attribute = ATTRIBUTES[hero.AttributePrimary] ?? ATTRIBUTES.DOTA_ATTRIBUTE_ALL;
  const roles = (hero.Role ?? "").split(",").filter(Boolean);
  const abilityNames = Array.from({ length: 9 }, (_, index) => hero[`Ability${index + 1}`]).filter(
    (name) => name && name !== "generic_hidden" && !name.startsWith("special_bonus") && abilities[name]
  );
  const heroAbilities = abilityNames.map((name) => abilities[name]);
  const talents = Array.from({ length: 8 }, (_, index) => hero[`Ability${index + 10}`]).filter(Boolean);
  const facets = Object.keys(hero.Facets ?? {});
  const bio = texts[`${heroKey}_bio`];
  const hype = texts[`${heroKey}_hype`];
  const number = (key) => Number(hero[key] ?? 0);

  return (
    <div className="space-y-5 px-4 pt-2 pb-6">
      <div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span style={{ color: attribute.color }}>{attribute.name}</span>
          {roles.map((role) => (
            <span key={role} className="text-ash">
              {role}
            </span>
          ))}
        </p>
        {hype && <p className="mt-2 text-sm text-bone/80">{fillText(hype)}</p>}
      </div>

      <section>
        <h3 className="mb-2 text-sm text-bone">Attributes</h3>
        <div className="grid grid-cols-3 gap-1.5">
          <Stat label="Strength" value={number("AttributeBaseStrength")} hint={`+${number("AttributeStrengthGain")}`} />
          <Stat label="Agility" value={number("AttributeBaseAgility")} hint={`+${number("AttributeAgilityGain")}`} />
          <Stat label="Intelligence" value={number("AttributeBaseIntelligence")} hint={`+${number("AttributeIntelligenceGain")}`} />
          <Stat label="Damage" value={`${number("AttackDamageMin")}–${number("AttackDamageMax")}`} />
          <Stat label="Attack range" value={number("AttackRange")} />
          <Stat label="Attack time" value={number("AttackRate")} />
          <Stat label="Armor" value={number("ArmorPhysical")} />
          <Stat label="Move speed" value={number("MovementSpeed")} />
          <Stat label="Vision" value={`${number("VisionDaytimeRange")} / ${number("VisionNighttimeRange")}`} />
        </div>
      </section>

      {facets.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm text-bone">Facets</h3>
          <ul className="space-y-1.5">
            {facets.map((facet) => (
              <li key={facet} className="rounded-lg bg-stage/60 px-3 py-2">
                <p className="text-sm text-bone">{texts[`DOTA_Tooltip_Facet_${facet}`] ?? facet.replace(/_/g, " ")}</p>
                {texts[`DOTA_Tooltip_Facet_${facet}_Description`] && (
                  <p className="mt-0.5 text-xs text-ash">{fillText(texts[`DOTA_Tooltip_Facet_${facet}_Description`])}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm text-bone">Abilities</h3>
        <ul className="space-y-1.5">
          {abilityNames.map((name) => (
            <Ability key={name} base={base} name={name} ability={abilities[name]} texts={texts} />
          ))}
        </ul>
      </section>

      {talents.length === 8 && (
        <section>
          <h3 className="mb-2 text-sm text-bone">Talents</h3>
          <ul className="space-y-1">
            {TALENT_LEVELS.map((level, row) => {
              const right = talents[6 - row * 2];
              const left = talents[7 - row * 2];
              return (
                <li key={level} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs">
                  <span className="rounded bg-stage/60 px-2 py-1.5 text-bone/90">{talentText(right, texts, abilities, heroAbilities)}</span>
                  <span className="w-6 text-center text-aegis tabular-nums">{level}</span>
                  <span className="rounded bg-stage/60 px-2 py-1.5 text-bone/90">{talentText(left, texts, abilities, heroAbilities)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {bio && (
        <section>
          <h3 className="mb-2 text-sm text-bone">Lore</h3>
          <p className="font-display text-sm leading-relaxed whitespace-pre-line text-bone/80">{fillText(bio)}</p>
        </section>
      )}
    </div>
  );
}
