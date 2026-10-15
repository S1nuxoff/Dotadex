// Rarity colors as the game shows them
export const RARITIES = {
  default: { name: "Default", color: "#b0c3d9" },
  common: { name: "Common", color: "#b0c3d9" },
  uncommon: { name: "Uncommon", color: "#5e98d9" },
  rare: { name: "Rare", color: "#4b69ff" },
  mythical: { name: "Mythical", color: "#8847ff" },
  legendary: { name: "Legendary", color: "#d32ce6" },
  immortal: { name: "Immortal", color: "#e4ae39" },
  arcana: { name: "Arcana", color: "#ade55c" },
  ancient: { name: "Ancient", color: "#eb4b4b" },
  seasonal: { name: "Seasonal", color: "#fff34f" },
};

export const HERO_COLOR = "#c9a45c";

export const TABS = [
  { id: "heroes", name: "Heroes" },
  { id: "wearable", name: "Cosmetics" },
  { id: "courier", name: "Couriers" },
  { id: "ward", name: "Wards" },
  { id: "other", name: "Other" },
];

export function rarity(item) {
  return RARITIES[item.rarity] ?? RARITIES.common;
}

export function slotName(slot) {
  if (!slot) {
    return null;
  }
  const words = slot.replace(/_/g, " ");
  return words[0].toUpperCase() + words.slice(1);
}

export function itemIcon(item) {
  return item.icon
    ? `https://raw.githubusercontent.com/S1nuxoff/dota2-image-tracker/main/static/panorama/images/${item.icon}_png.png`
    : null;
}

export function heroPortrait(hero) {
  return `https://cdn.steamstatic.com/apps/dota2/images/dota_react/heroes/${hero.id}.png`;
}

// Which models to load for a selection: a hero wears its default items,
// a cosmetic is worn by its hero in place of the default item of the same slot
export function composition(catalog, selection, { onHero, variant }) {
  const heroes = catalog.heroesById;
  const base = (url) => catalog.modelsBase + url;

  if (selection.type === "hero") {
    const hero = heroes[selection.id];
    return [hero.model, ...hero.defaults.flatMap((item) => item.models)].map(base);
  }

  const item = catalog.itemsById[selection.id];
  const models = [...new Set(item.models)];
  if (item.kind === "courier" && models.length > 1) {
    return [base(models[variant % models.length])];
  }

  const hero = item.hero && heroes[item.hero];
  if (onHero && hero) {
    const slot = item.slot ?? "weapon";
    const defaults = hero.defaults.filter((entry) => entry.slot !== slot).flatMap((entry) => entry.models);
    return [hero.model, ...defaults, ...models].map(base);
  }
  return models.map(base);
}

export async function loadCatalog() {
  const res = await fetch(`${import.meta.env.BASE_URL}catalog.json`);
  if (!res.ok) {
    throw new Error(`The model list did not load (HTTP ${res.status}).`);
  }
  const catalog = await res.json();
  catalog.heroesById = Object.fromEntries(catalog.heroes.map((hero) => [hero.id, hero]));
  catalog.itemsById = Object.fromEntries(catalog.items.map((item) => [item.id, item]));
  return catalog;
}

// #/hero/pudge, #/item/4007
export function parseHash(hash) {
  const [, type, id] = hash.match(/^#\/(hero|item)\/(.+)$/) ?? [];
  return type ? { type, id: decodeURIComponent(id) } : null;
}
