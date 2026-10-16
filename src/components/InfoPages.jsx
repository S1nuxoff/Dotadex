import { useMemo } from "react";
import { Box, Coins } from "lucide-react";
import { abilityStats, abilityValue, fillText, imageUrl, useGameData } from "../gamedata.js";
import { RARITIES, itemIcon, treasureScene } from "../catalog.js";
import { ItemCard } from "./ui.jsx";
import { SoundList, soundsBase } from "./Voice.jsx";
import { useEffect, useState } from "react";

function Page({ children }) {
  return (
    <section className="stage-backdrop h-full overflow-y-auto scrollbar-thin" style={{ "--rim": "#c9a45c" }}>
      <div className="mx-auto max-w-3xl px-5 pt-20 pb-12 sm:px-8 lg:pt-12">{children}</div>
    </section>
  );
}

// Components of a shop item, from its recipe: "item_a;item_b"
function componentsOf(items, name) {
  const recipe = items[`item_recipe_${name.replace(/^item_/, "")}`];
  const requirements = Object.values(recipe?.ItemRequirements ?? {})[0];
  if (!requirements) {
    return [];
  }
  const parts = requirements.split(";").map((part) => part.trim().replace(/\*$/, "")).filter(Boolean);
  // A recipe that costs gold is itself a component
  if (Number(recipe.ItemCost) > 0) {
    parts.push(`item_recipe_${name.replace(/^item_/, "")}`);
  }
  return parts;
}

function ShopChip({ base, name, items, texts, onOpen }) {
  const recipe = name.startsWith("item_recipe_");
  const item = items[name];
  const texture = recipe ? "recipe" : (item?.AbilityTextureName ?? name).replace(/^item_/, "");
  const title = recipe ? "Recipe" : texts[`DOTA_Tooltip_ability_${name}`] ?? name;
  return (
    <button
      onClick={() => !recipe && onOpen({ type: "shop", id: name })}
      disabled={recipe}
      className="flex items-center gap-2 rounded-lg border border-line bg-stage/50 py-1.5 pr-3 pl-1.5 text-left text-sm text-bone/90 transition-colors enabled:hover:border-ash/40"
    >
      <img src={imageUrl(base, `items/${texture}`)} alt="" className="h-8 w-11 rounded object-cover" onError={(event) => (event.currentTarget.style.visibility = "hidden")} />
      <span>{title}</span>
      {item?.ItemCost && Number(item.ItemCost) > 0 && <span className="text-xs text-aegis tabular-nums">{item.ItemCost}</span>}
    </button>
  );
}

export function ShopPage({ catalog, id, language, onOpen }) {
  const base = catalog.modelsBase;
  const { data, error } = useGameData(base, ["items.json"], language);
  const item = data?.items[id];
  const usedIn = useMemo(() => {
    if (!data) {
      return [];
    }
    return Object.keys(data.items).filter((name) => !name.startsWith("item_recipe_") && componentsOf(data.items, name).includes(id));
  }, [data, id]);

  if (error) {
    return <Page><p className="text-ash">The item's data did not load. {error}</p></Page>;
  }
  if (!data) {
    return <Page><p className="text-ash">Loading the item</p></Page>;
  }
  if (!item) {
    return <Page><p className="text-ash">No data for this item.</p></Page>;
  }

  const { texts, items } = data;
  const shop = catalog.shopById[id];
  const title = texts[`DOTA_Tooltip_ability_${id}`] ?? id;
  const description = fillText(texts[`DOTA_Tooltip_ability_${id}_Description`], item);
  const lore = texts[`DOTA_Tooltip_ability_${id}_Lore`];
  const notes = [0, 1, 2, 3, 4, 5]
    .map((index) => fillText(texts[`DOTA_Tooltip_ability_${id}_Note${index}`], item))
    .filter(Boolean);
  const stats = abilityStats(item, id, texts);
  const cooldown = abilityValue(item, "AbilityCooldown");
  const mana = abilityValue(item, "AbilityManaCost");
  const components = componentsOf(items, id);

  return (
    <Page>
      <div className="flex items-start gap-5">
        <img
          src={imageUrl(base, `items/${shop?.texture ?? id.replace(/^item_/, "")}`)}
          alt=""
          className="h-[88px] w-[121px] shrink-0 rounded-lg border border-line object-cover"
          onError={(event) => (event.currentTarget.style.visibility = "hidden")}
        />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-3 text-sm text-ash">
            <span>{shop?.neutral ? "Neutral item" : "Item"}</span>
            {Number(item.ItemCost) > 0 && (
              <span className="inline-flex items-center gap-1 text-aegis tabular-nums">
                <Coins className="size-3.5" /> {item.ItemCost}
              </span>
            )}
            {cooldown && cooldown !== "0" && <span className="tabular-nums">Cooldown {cooldown}</span>}
            {mana && mana !== "0" && <span className="text-[#6fa8dc] tabular-nums">Mana {mana}</span>}
          </p>
          <h2 className="mt-1 font-display text-4xl leading-tight text-bone sm:text-5xl">{title}</h2>
        </div>
      </div>

      {stats.length > 0 && (
        <dl className="mt-8 grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
          {stats.map((stat) => (
            <div key={stat.label} className="flex justify-between gap-4 border-b border-line/60 py-1">
              <dt className="text-ash">{stat.label}</dt>
              <dd className="text-bone tabular-nums">{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {description && <p className="mt-8 max-w-prose whitespace-pre-line text-bone/90">{description}</p>}
      {notes.length > 0 && (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-ash">
          {notes.map((note) => (
            <li key={note} className="whitespace-pre-line">{note}</li>
          ))}
        </ul>
      )}
      {lore && <p className="mt-6 max-w-prose font-display leading-relaxed text-ash italic">{lore}</p>}

      {components.length > 0 && (
        <section className="mt-10">
          <h3 className="mb-3 text-sm text-bone">Built from</h3>
          <div className="flex flex-wrap gap-2">
            {components.map((name, index) => (
              <ShopChip key={`${name}-${index}`} base={base} name={name} items={items} texts={texts} onOpen={onOpen} />
            ))}
          </div>
        </section>
      )}
      {usedIn.length > 0 && (
        <section className="mt-8">
          <h3 className="mb-3 text-sm text-bone">Builds into</h3>
          <div className="flex flex-wrap gap-2">
            {usedIn.map((name) => (
              <ShopChip key={name} base={base} name={name} items={items} texts={texts} onOpen={onOpen} />
            ))}
          </div>
        </section>
      )}
    </Page>
  );
}

export function TreasurePage({ catalog, id, onOpen }) {
  const treasure = catalog.treasuresById[id];
  const rarity = RARITIES[treasure.rarity] ?? RARITIES.common;
  const total = treasure.tiers.reduce((sum, tier) => sum + tier.length, 0);
  const scene = treasureScene(catalog, treasure);

  return (
    <Page>
      <div className="flex items-start gap-5">
        <img src={itemIcon(treasure)} alt="" className="h-[106px] w-[160px] shrink-0 rounded-lg object-contain" onError={(event) => (event.currentTarget.style.visibility = "hidden")} />
        <div className="min-w-0">
          <p className="flex flex-wrap gap-x-3 text-sm">
            <span style={{ color: rarity.color }}>{rarity.name} treasure</span>
            {treasure.date && <span className="text-ash">{treasure.date.slice(0, 4)}</span>}
            {treasure.retired && <span className="text-ash">No longer available</span>}
          </p>
          <h2 className="mt-1 font-display text-4xl leading-tight text-bone sm:text-5xl">{treasure.name}</h2>
          <p className="mt-2 text-sm text-ash">{total} items can drop from it.</p>
          {scene && (
            <button
              onClick={() => onOpen({ type: "scene", id: scene.id })}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm text-bone transition-colors hover:border-ash/50"
            >
              <Box className="size-4 text-ash" aria-hidden /> Open the chest in its scene
            </button>
          )}
        </div>
      </div>

      {treasure.tiers.map((tier, index) => {
        const ready = tier.map((itemId) => catalog.itemsById[itemId]).filter(Boolean);
        return (
          <section key={index} className="mt-10">
            <h3 className="mb-3 text-sm text-bone">
              {treasure.tiers.length > 1 ? `Tier ${index + 1}` : "Contents"}
              <span className="ml-2 text-xs text-ash tabular-nums">{tier.length}</span>
            </h3>
            {ready.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {ready.map((item) => (
                  <ItemCard key={item.id} item={item} caption={catalog.heroNames[item.hero] ?? undefined} onClick={() => onOpen({ type: "item", id: item.id })} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-ash">These items have no models to show.</p>
            )}
            {ready.length > 0 && ready.length < tier.length && (
              <p className="mt-2 text-xs text-ash">{tier.length - ready.length} more have no models to show.</p>
            )}
          </section>
        );
      })}
    </Page>
  );
}

export function AudioPage({ catalog, id }) {
  const pack = catalog.audioById[id];
  const [files, setFiles] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setFiles(null);
    fetch(`${catalog.modelsBase}data/audio-library.json`)
      .then((res) => res.json())
      .then((library) => {
        const [kind, folder] = id.split("/");
        if (!cancelled) {
          setFiles(library[kind]?.[folder] ?? []);
        }
      })
      .catch(() => !cancelled && setFiles([]));
    return () => {
      cancelled = true;
    };
  }, [catalog, id]);

  return (
    <Page>
      <p className="text-sm text-ash">{pack.kind === "announcers" ? "Announcer pack" : "Music pack"}</p>
      <h2 className="mt-1 font-display text-4xl leading-tight text-bone sm:text-5xl">{pack.name}</h2>
      <p className="mt-2 text-sm text-ash">{pack.count} sounds.</p>
      <div className="mt-8">{files ? <SoundList base={soundsBase(catalog.modelsBase)} files={files} /> : <p className="text-sm text-ash">Loading the list</p>}</div>
    </Page>
  );
}
