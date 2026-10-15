// Rarity colors as the game shows them, in the game's order
export const RARITIES = {
  default: { name: "Default", color: "#b0c3d9", rank: 0 },
  common: { name: "Common", color: "#b0c3d9", rank: 1 },
  uncommon: { name: "Uncommon", color: "#5e98d9", rank: 2 },
  rare: { name: "Rare", color: "#4b69ff", rank: 3 },
  mythical: { name: "Mythical", color: "#8847ff", rank: 4 },
  legendary: { name: "Legendary", color: "#d32ce6", rank: 5 },
  immortal: { name: "Immortal", color: "#e4ae39", rank: 6 },
  arcana: { name: "Arcana", color: "#ade55c", rank: 7 },
  ancient: { name: "Ancient", color: "#eb4b4b", rank: 8 },
  seasonal: { name: "Seasonal", color: "#fff34f", rank: 2 },
};

export const HERO_COLOR = "#c9a45c";

export const TABS = [
  { id: "heroes", name: "Heroes" },
  { id: "wearable", name: "Cosmetics" },
  { id: "sets", name: "Sets" },
  { id: "treasures", name: "Treasures" },
  { id: "shop", name: "Items" },
  { id: "audio", name: "Audio" },
  { id: "scenes", name: "Scenes" },
  { id: "courier", name: "Couriers" },
  { id: "ward", name: "Wards" },
  { id: "other", name: "Other" },
];

export const SORTS = [
  { id: "newest", name: "Newest" },
  { id: "name", name: "Name" },
  { id: "rarity", name: "Rarity" },
  { id: "price", name: "Price" },
];

// The order slots are listed in, as in the game's loadout
const SLOT_ORDER = [
  "weapon",
  "offhand_weapon",
  "head",
  "shoulder",
  "arms",
  "gloves",
  "armor",
  "back",
  "belt",
  "legs",
  "neck",
  "tail",
  "mount",
  "misc",
  "summon",
  "ability1",
  "ability2",
  "ability3",
  "ability4",
  "ability_ultimate",
];

const SLOT_NAMES = {
  offhand_weapon: "Off-hand",
  ability_ultimate: "Ultimate",
  ability1: "Ability 1",
  ability2: "Ability 2",
  ability3: "Ability 3",
  ability4: "Ability 4",
  body_head: "Body",
};

export function rarity(item) {
  return RARITIES[item.rarity] ?? RARITIES.common;
}

export function slotName(slot) {
  if (!slot) {
    return null;
  }
  if (SLOT_NAMES[slot]) {
    return SLOT_NAMES[slot];
  }
  const words = slot.replace(/_/g, " ");
  return words[0].toUpperCase() + words.slice(1);
}

function slotRank(slot) {
  const rank = SLOT_ORDER.indexOf(slot);
  return rank < 0 ? SLOT_ORDER.length : rank;
}

// The image tracker keeps the game's file names, which are lowercase
export function itemIcon(item) {
  return item.icon
    ? `https://raw.githubusercontent.com/S1nuxoff/dota2-image-tracker/main/static/panorama/images/${item.icon.toLowerCase()}_png.png`
    : null;
}

export function heroPortrait(hero) {
  return `https://cdn.steamstatic.com/apps/dota2/images/dota_react/heroes/${hero.id}.png`;
}

export function formatPrice(price) {
  return price === undefined ? null : `$${price < 10 ? price.toFixed(2) : Math.round(price).toLocaleString("en")}`;
}

export function sortItems(items, sort) {
  const sorted = [...items];
  if (sort === "newest") {
    sorted.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || Number(b.id) - Number(a.id));
  } else if (sort === "rarity") {
    sorted.sort((a, b) => rarity(b).rank - rarity(a).rank || a.name.localeCompare(b.name));
  } else if (sort === "price") {
    sorted.sort((a, b) => (b.price ?? -1) - (a.price ?? -1) || a.name.localeCompare(b.name));
  } else {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  }
  return sorted;
}

// The models an item shows in a style; a style without its own models keeps the item's
export function itemModels(item, style = 0) {
  const chosen = item.styles?.[style];
  const own = chosen && !chosen.missing ? chosen.models : null;
  return [...new Set(own?.length ? own : item.models)];
}

// The material variant (skin) an item shows its models with, 0 for the default
export function itemSkin(item, style = 0) {
  return item.styles?.[style]?.skin ?? item.skin ?? 0;
}

// Model paths of an item as urls, with #skin=N when it uses a material variant
function itemUrls(catalog, item, style) {
  const skin = itemSkin(item, style);
  return itemModels(item, style).map((model) => catalog.modelsBase + model + (skin ? `#skin=${skin}` : ""));
}

// The slots of a hero, from its default items and its cosmetics:
// [{ slot, defaultItem, count }] in the game's order
export function heroSlots(catalog, heroId) {
  const slots = new Map();
  const hero = catalog.heroesById[heroId];
  for (const entry of hero?.defaults ?? []) {
    slots.set(entry.slot, { slot: entry.slot, defaultItem: catalog.itemsById[entry.id] ?? null, count: 0 });
  }
  for (const item of catalog.itemsByHero[heroId] ?? []) {
    if (!slots.has(item.slot)) {
      slots.set(item.slot, { slot: item.slot, defaultItem: null, count: 0 });
    }
    if (!item.default) {
      slots.get(item.slot).count += 1;
    }
  }
  return [...slots.values()].sort((a, b) => slotRank(a.slot) - slotRank(b.slot) || a.slot.localeCompare(b.slot));
}

export function itemsForSlot(catalog, heroId, slot) {
  return (catalog.itemsByHero[heroId] ?? []).filter((item) => item.slot === slot && !item.default);
}

// What is on screen, worked out from the route:
// { hero, slots: { slot: { id, style } }, focus, style, variant }
export function outfitFor(catalog, route) {
  if (route.type === "scene") {
    return { scene: route.id, hero: null, slots: {}, focus: null };
  }
  if (route.type === "hero") {
    return { hero: route.id, slots: route.slots ?? {}, focus: null, bare: Boolean(route.bare) };
  }
  const item = catalog.itemsById[route.id];
  const style = route.style ?? 0;
  if (item.hero && catalog.heroesById[item.hero] && !route.alone) {
    return { hero: item.hero, slots: { [item.slot]: { id: item.id, style } }, focus: item.id, style };
  }
  return { hero: null, slots: {}, focus: item.id, style, variant: route.variant ?? 0 };
}

// The models to load: the hero's body, then in each slot the chosen item or the default
export function outfitUrls(catalog, outfit) {
  if (outfit.scene) {
    return [`${catalog.scenesBase}scenes/${outfit.scene}.glb`];
  }
  if (!outfit.hero) {
    const item = catalog.itemsById[outfit.focus];
    const urls = itemUrls(catalog, item, outfit.style);
    // A courier's models are its ground and flying forms, shown one at a time
    if (item.kind === "courier" && urls.length > 1) {
      return [urls[(outfit.variant ?? 0) % urls.length]];
    }
    return urls;
  }

  const hero = catalog.heroesById[outfit.hero];
  const urls = [catalog.modelsBase + hero.model];
  // The hero's own model alone, without anything worn on it
  if (outfit.bare) {
    return urls;
  }
  const slots = new Set([...hero.defaults.map((entry) => entry.slot), ...Object.keys(outfit.slots)]);
  for (const slot of slots) {
    const chosen = outfit.slots[slot] && catalog.itemsById[outfit.slots[slot].id];
    if (chosen) {
      urls.push(...itemUrls(catalog, chosen, outfit.slots[slot].style));
    } else {
      urls.push(...hero.defaults.filter((entry) => entry.slot === slot).flatMap((entry) => entry.models).map((model) => catalog.modelsBase + model));
    }
  }
  return [...new Set(urls)];
}

export async function loadCatalog() {
  const res = await fetch(`${import.meta.env.BASE_URL}catalog.json`);
  if (!res.ok) {
    throw new Error(`The model list did not load (HTTP ${res.status}).`);
  }
  return res.json();
}

// Paths of the models exported so far, read live from the dataset
export async function loadExported(modelsBase) {
  // exported.json is just the list; older datasets only have the whole index
  const small = await fetch(`${modelsBase}exported.json?t=${Date.now()}`, { cache: "no-store" }).catch(() => null);
  if (small?.ok) {
    return new Set(await small.json());
  }
  const res = await fetch(`${modelsBase}index.json?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`The list of exported models did not load (HTTP ${res.status}).`);
  }
  const index = await res.json();
  // Older indexes listed only what was exported
  return new Set(
    index.exported ?? [...Object.values(index.heroes), ...Object.values(index.items).flatMap((item) => item.models)]
  );
}

// The part of the catalog that can be shown: heroes whose model is exported, wearing
// the default items that are, and items whose default models are
export function withExported(catalog, exported) {
  // ?preview=all on the dev server treats everything as exported, to try the lists
  const all = import.meta.env.DEV && new URLSearchParams(window.location.search).get("preview") === "all";
  const ready = (models) => all || models.every((model) => exported.has(model));
  const heroes = catalog.heroes
    .filter((hero) => ready([hero.model]))
    .map((hero) => ({ ...hero, defaults: hero.defaults.filter((entry) => ready(entry.models)) }));
  const items = catalog.items
    .filter((item) => ready(item.models))
    // Styles whose models are not exported yet are left out
    .map((item) =>
      item.styles ? { ...item, styles: item.styles.map((style) => (ready(style.models) ? style : { ...style, missing: true })) } : item
    );

  const itemsById = Object.fromEntries(items.map((item) => [item.id, item]));
  const itemsByHero = {};
  for (const item of items) {
    if (item.hero) {
      (itemsByHero[item.hero] ??= []).push(item);
    }
  }
  const sets = (catalog.sets ?? [])
    .map((set) => ({ ...set, items: set.items.filter((id) => itemsById[id]) }))
    .filter((set) => set.items.length > 1);

  return {
    ...catalog,
    heroes,
    items,
    sets,
    heroesById: Object.fromEntries(heroes.map((hero) => [hero.id, hero])),
    itemsById,
    itemsByHero,
    setsById: Object.fromEntries(sets.map((set) => [set.id, set])),
    shop: catalog.shop ?? [],
    shopById: Object.fromEntries((catalog.shop ?? []).map((item) => [item.id, item])),
    treasures: catalog.treasures ?? [],
    treasuresById: Object.fromEntries((catalog.treasures ?? []).map((treasure) => [treasure.id, treasure])),
    audio: catalog.audio ?? [],
    audioById: Object.fromEntries((catalog.audio ?? []).map((pack) => [pack.id, pack])),
    scenes: catalog.scenes ?? [],
    scenesById: Object.fromEntries((catalog.scenes ?? []).map((scene) => [scene.id, scene])),
    scenesBase: catalog.modelsBase.replace("dota2-models", "dota2-scenes"),
    total: catalog.heroes.length + catalog.items.length,
  };
}

// #/hero/pudge?head=4007.1&weapon=7247  (slot=item.style)
// #/item/4517?style=2&alone=1&variant=1
export function parseRoute(hash) {
  const [, type, id, query] = hash.match(/^#\/(hero|item|shop|treasure|audio|scene)\/([^?]+)(?:\?(.*))?$/) ?? [];
  if (!type) {
    return null;
  }
  const params = new URLSearchParams(query ?? "");
  if (["shop", "treasure", "audio", "scene"].includes(type)) {
    return { type, id: decodeURIComponent(id) };
  }
  if (type === "hero") {
    const slots = {};
    const bare = params.get("bare") === "1";
    params.delete("bare");
    for (const [slot, value] of params) {
      const [itemId, style] = value.split(".");
      slots[slot] = { id: itemId, style: Number(style) || 0 };
    }
    return { type, id: decodeURIComponent(id), slots, bare };
  }
  return {
    type,
    id: decodeURIComponent(id),
    style: Number(params.get("style")) || 0,
    alone: params.get("alone") === "1",
    variant: Number(params.get("variant")) || 0,
  };
}

export function routeHash(route) {
  const params = new URLSearchParams();
  if (route.type === "hero") {
    for (const [slot, { id, style }] of Object.entries(route.slots ?? {})) {
      params.set(slot, style ? `${id}.${style}` : id);
    }
    route.bare && params.set("bare", "1");
  } else {
    route.style && params.set("style", route.style);
    route.alone && params.set("alone", "1");
    route.variant && params.set("variant", route.variant);
  }
  const query = params.toString();
  return `#/${route.type}/${encodeURIComponent(route.id)}${query ? `?${query}` : ""}`;
}

export function isKnown(catalog, route) {
  const lists = {
    hero: catalog.heroesById,
    item: catalog.itemsById,
    shop: catalog.shopById,
    treasure: catalog.treasuresById,
    audio: catalog.audioById,
    scene: catalog.scenesById,
  };
  return Boolean(route && lists[route.type]?.[route.id]);
}

// The scene a treasure opens in. The game picks it in code, not in its data, so it is
// matched by the treasure's picture and year; the rest open in the common one.
const TREASURE_SCENES = [
  [(treasure) => treasure.icon?.includes("new_bloom_2024"), "scenes/treasure/newbloom_2024_chest"],
  [(treasure) => treasure.icon?.includes("frostivus_chest") && treasure.date?.startsWith("2023"), "scenes/treasure/frostivus2023_chest"],
  [(treasure) => /calavera/.test(treasure.icon ?? ""), "scenes/treasure/calavera_chest"],
];

export function treasureScene(catalog, treasure) {
  const id = TREASURE_SCENES.find(([matches]) => matches(treasure))?.[1] ?? "scenes/treasure/generic_chest";
  return catalog.scenesById[id] ?? null;
}
