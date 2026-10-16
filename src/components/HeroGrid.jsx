import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { heroPortrait } from "../catalog.js";
import { useGameData } from "../gamedata.js";

// The game's hero grid: portraits by primary attribute, with search and the game's filters
const GROUPS = [
  ["DOTA_ATTRIBUTE_STRENGTH", "Strength", "hero_strength"],
  ["DOTA_ATTRIBUTE_AGILITY", "Agility", "hero_agility"],
  ["DOTA_ATTRIBUTE_INTELLECT", "Intelligence", "hero_intelligence"],
  ["DOTA_ATTRIBUTE_ALL", "Universal", "hero_universal"],
];
export const ATTRIBUTE_ICON = (icon) => `https://cdn.steamstatic.com/apps/dota2/images/dota_react/icons/${icon}.png`;

export function attributeIcon(primary) {
  return ATTRIBUTE_ICON((GROUPS.find(([key]) => key === primary) ?? GROUPS[3])[2]);
}

function Diamonds({ value, active, onPick }) {
  return (
    <span className="flex gap-1">
      {[1, 2, 3].map((level) => (
        <button
          key={level}
          onClick={() => onPick(active === level ? 0 : level)}
          data-sound="toggle"
          aria-label={`Complexity ${level}`}
          aria-pressed={active === level}
          className={`size-3 rotate-45 border ${level <= (active || value) ? "border-bone bg-bone" : "border-ash/60"}`}
        />
      ))}
    </span>
  );
}

export default function HeroGrid({ catalog, language, onOpen, onPrefetch }) {
  const { data } = useGameData(catalog.modelsBase, ["heroes.json"], language);
  const [query, setQuery] = useState("");
  const [complexity, setComplexity] = useState(0);
  const [attack, setAttack] = useState("");
  const words = query.trim().toLowerCase();

  const groups = useMemo(
    () =>
      GROUPS.map(([key, name, icon]) => ({
        key,
        name,
        icon,
        heroes: catalog.heroes
          .filter((hero) => {
            // The training dummy of the demo mode is listed with the heroes but is none
            if (hero.id === "target_dummy") {
              return false;
            }
            const info = data?.heroes[`npc_dota_hero_${hero.id}`];
            if ((info?.AttributePrimary ?? "DOTA_ATTRIBUTE_ALL") !== key) {
              return false;
            }
            if (complexity && Number(info?.Complexity) !== complexity) {
              return false;
            }
            if (attack && !(info?.AttackCapabilities ?? "").includes(attack)) {
              return false;
            }
            return true;
          })
          .sort((a, b) => a.name.localeCompare(b.name)),
      })),
    [catalog, data, complexity, attack]
  );

  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(ellipse_at_top,#1d2733,transparent_60%)] px-8 pt-6 pb-12 scrollbar-thin">
      <div className="mx-auto max-w-[110rem]">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <h1 className="font-display text-3xl tracking-[0.12em] text-bone">Choose a hero</h1>
          <label className="flex w-64 items-center gap-2 border px-2.5">
            <Search className="size-4 shrink-0 text-ash" aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search heroes"
              aria-label="Search heroes"
              className="h-8 w-full bg-transparent text-sm text-bone placeholder:text-ash/70 focus:outline-none"
            />
          </label>
          <span className="ml-auto flex items-center gap-6 text-xs tracking-[0.14em] text-ash uppercase">
            <span className="flex items-center gap-2">
              Attack
              {[
                ["MELEE", "Melee"],
                ["RANGED", "Ranged"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setAttack(attack === id ? "" : id)}
                  data-sound="toggle"
                  className={`px-1.5 py-0.5 ${attack === id ? "text-bone" : "text-ash/60 hover:text-bone"}`}
                >
                  {label}
                </button>
              ))}
            </span>
            <span className="flex items-center gap-3">
              Complexity <Diamonds value={0} active={complexity} onPick={setComplexity} />
            </span>
          </span>
        </div>

        {groups.map((group) => (
          <div key={group.key} className="mt-7">
            <h2 className="flex items-center gap-2.5 font-display text-base tracking-[0.16em] text-bone/90">
              <img src={ATTRIBUTE_ICON(group.icon)} alt="" className="size-6" />
              {group.name}
            </h2>
            <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-1.5">
              {group.heroes.map((hero) => {
                const dim = words && !hero.name.toLowerCase().includes(words);
                return (
                  <li key={hero.id}>
                    <button
                      onClick={() => onOpen({ type: "hero", id: hero.id })}
                      onPointerEnter={() => onPrefetch?.({ type: "hero", id: hero.id })}
                      data-hover
                      title={hero.name}
                      className={`group relative block aspect-[16/9] w-full overflow-hidden border border-black/80 bg-stage transition duration-200 hover:z-10 hover:scale-[1.12] hover:border-bone/70 hover:shadow-[0_6px_24px_rgb(0_0_0/0.7)] ${
                        dim ? "opacity-25 grayscale" : ""
                      }`}
                    >
                      <img src={heroPortrait(hero)} alt="" loading="lazy" className="size-full object-cover" />
                      <span className="absolute inset-x-0 bottom-0 translate-y-full bg-gradient-to-t from-black/90 to-transparent px-1.5 pt-3 pb-1 text-left text-[11px] text-bone transition-transform group-hover:translate-y-0">
                        {hero.name}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
