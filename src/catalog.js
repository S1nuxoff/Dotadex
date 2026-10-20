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
  { id: "music", name: "Music" },
  { id: "announcers", name: "Announcers" },
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
  // A persona's slots are named like the hero's own: "weapon_persona_1" is a weapon
  slot = slot.replace(/_persona_\d+$/, "");
  if (SLOT_NAMES[slot]) {
    return SLOT_NAMES[slot];
  }
  const words = slot.replace(/_/g, " ");
  return words[0].toUpperCase() + words.slice(1);
}

function slotRank(slot) {
  const rank = SLOT_ORDER.indexOf(slot.replace(/_persona_\d+$/, ""));
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

// The persona a slot belongs to: "weapon_persona_1" -> 1, plain slots 0
export function personaOf(slot) {
  return Number(slot?.match(/_persona_(\d+)$/)?.[1] ?? 0);
}

// Slots whose items are another unit, not something the hero wears: an ability's or ultimate's
// form (Lycan's wolf, Dragon Knight's dragon, Lone Druid's true form), a summon (Visage's familiar,
// Witch Doctor's ward). Put on the hero's skeleton they stretch over it, so they are shown alone
export function wornOnHero(slot) {
  return !/^(ability|shapeshift|summon)/.test(slot ?? "");
}

// The slots dressed on a hero: those of its defaults and of what is chosen, of the persona shown
function dressedSlots(hero, outfit, persona) {
  return new Set(
    [...hero.defaults.map((entry) => entry.slot), ...Object.keys(outfit.slots)].filter((slot) => personaOf(slot) === persona && wornOnHero(slot))
  );
}

// The slots of a hero, from its default items and its cosmetics:
// [{ slot, defaultItem, count }] in the game's order, those of the persona shown
export function heroSlots(catalog, heroId, persona = 0) {
  const slots = new Map();
  const hero = catalog.heroesById[heroId];
  // The game's slots of the hero first (ItemSlots, in order), then any other an item or default is in
  for (const slot of hero?.slots ?? []) {
    slots.set(slot, { slot, defaultItem: null, count: 0 });
  }
  for (const entry of hero?.defaults ?? []) {
    // A default with no model of its own is not among the items: its name and icon stand in
    const item = catalog.itemsById[entry.id] ?? (entry.icon ? { id: entry.id, name: entry.name, icon: entry.icon, slot: entry.slot, rarity: "default", models: [] } : null);
    slots.set(entry.slot, { ...(slots.get(entry.slot) ?? { slot: entry.slot, count: 0 }), defaultItem: item });
  }
  for (const item of catalog.itemsByHero[heroId] ?? []) {
    if (!slots.has(item.slot)) {
      slots.set(item.slot, { slot: item.slot, defaultItem: null, count: 0 });
    }
    if (!item.default) {
      slots.get(item.slot).count += 1;
    }
  }
  const order = hero?.slots ?? [];
  const rank = (slot) => (order.includes(slot) ? order.indexOf(slot) : order.length + slotRank(slot));
  return [...slots.values()]
    .filter((entry) => personaOf(entry.slot) === persona)
    .sort((a, b) => rank(a.slot) - rank(b.slot) || a.slot.localeCompare(b.slot));
}

// What an empty slot's tile shows, as the game's loadout does: the effigy's stand, else the
// crossed out figure of "no item"
export function emptySlotIcon(slot) {
  return itemIcon({ icon: /^hero_effigy/.test(slot) ? "econ/default_hero_effigy" : "econ/default_no_item" });
}

export function itemsForSlot(catalog, heroId, slot) {
  return (catalog.itemsByHero[heroId] ?? []).filter((item) => item.slot === slot && !item.default);
}

// What is on screen, worked out from the route:
// { hero, slots: { slot: { id, style } }, focus, style, variant }
export function outfitFor(catalog, route) {
  if (route.type === "scene") {
    return { scene: route.id, camera: route.camera, hero: null, slots: {}, focus: null };
  }
  if (route.type === "hero") {
    const slots = route.slots ?? {};
    // A persona is shown when the link says so or when its items are worn
    const persona = route.persona || Math.max(0, ...Object.keys(slots).map(personaOf));
    return { hero: route.id, slots, focus: null, bare: Boolean(route.bare), persona };
  }
  const item = catalog.itemsById[route.id];
  const style = route.style ?? 0;
  if (item.hero && catalog.heroesById[item.hero] && !route.alone && wornOnHero(item.slot)) {
    return { hero: item.hero, slots: { [item.slot]: { id: item.id, style } }, focus: item.id, style, persona: personaOf(item.slot) };
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
  const persona = (outfit.persona && hero.personas?.[outfit.persona - 1]) ? outfit.persona : 0;
  const urls = [catalog.modelsBase + (persona ? hero.personas[persona - 1] : hero.model)];
  // The hero's own model alone, without anything worn on it
  if (outfit.bare) {
    return urls;
  }
  for (const slot of dressedSlots(hero, outfit, persona)) {
    const chosen = outfit.slots[slot] && catalog.itemsById[outfit.slots[slot].id];
    if (chosen) {
      urls.push(...itemUrls(catalog, chosen, outfit.slots[slot].style));
    } else {
      urls.push(...hero.defaults.filter((entry) => entry.slot === slot).flatMap((entry) => entry.models).map((model) => catalog.modelsBase + model));
    }
  }
  return [...new Set(urls)];
}

// What a hero wears, chosen or by default: [{ item, models, style }]
function wornItems(catalog, outfit, hero, persona) {
  const worn = [];
  if (outfit.bare) {
    return worn;
  }
  for (const slot of dressedSlots(hero, outfit, persona)) {
    const chosen = outfit.slots[slot] && catalog.itemsById[outfit.slots[slot].id];
    if (chosen) {
      worn.push({ item: chosen, models: itemUrls(catalog, chosen, outfit.slots[slot].style), style: outfit.slots[slot].style ?? 0 });
    } else {
      for (const entry of hero.defaults.filter((entry) => entry.slot === slot)) {
        const item = catalog.itemsById[entry.id];
        if (item) worn.push({ item, models: entry.models.map((model) => catalog.modelsBase + model), style: 0 });
      }
    }
  }
  return worn;
}

// The activity modifiers on the hero's animations, as the game sets them from what it wears (and
// the hero's own default items without a model): [[activity or "ALL", modifier]], those of the
// style worn. The game picks each activity's sequence by them (Sven's TI7 sword: his loadout spawn
// with the sword's burst)
export function outfitActivities(catalog, outfit) {
  if (outfit.scene || !outfit.hero) {
    return [];
  }
  const hero = catalog.heroesById[outfit.hero];
  const persona = outfit.persona && hero.personas?.[outfit.persona - 1] ? outfit.persona : 0;
  const list = persona ? [] : [...(hero.activities ?? [])];
  for (const { item, style } of wornItems(catalog, outfit, hero, persona)) {
    list.push(...(item.activities ?? []).filter((entry) => entry[2] === undefined || entry[2] === style));
  }
  return list.map(([activity, modifier]) => [activity, modifier]);
}

// The particle systems on screen, as the game puts them: the hero's own effects, those of what it
// wears (or wears by default) added, and those an item puts in place of others swapped.
// [{ system, models, snapshots }]: the models whose surface an effect's particles rise from, its
// item's (the hero's for the hero's own effects), and the snapshots what is worn puts in place of
// others ({ default: its own }, a weapon's points for the default weapon's glow)
export function outfitParticles(catalog, outfit) {
  if (outfit.scene) {
    return [];
  }
  if (!outfit.hero) {
    const item = catalog.itemsById[outfit.focus];
    let models = itemUrls(catalog, item, outfit.style).map((url) => url.split("#")[0]);
    let systems = item?.particles?.add ?? [];
    // A courier shows one form at a time, with that form's own effects
    if (item?.kind === "courier" && models.length > 1) {
      models = [models[(outfit.variant ?? 0) % models.length]];
      const flying = /flying/.test(models[0]);
      systems = [...systems, ...((flying ? item.particles?.flying : item.particles?.ground) ?? [])];
    }
    return systems.map((system) => ({ system, models }));
  }
  const hero = catalog.heroesById[outfit.hero];
  const persona = outfit.persona && hero.personas?.[outfit.persona - 1] ? outfit.persona : 0;
  const worn = wornItems(catalog, outfit, hero, persona);
  const heroModel = catalog.modelsBase + (persona ? hero.personas[persona - 1] : hero.model);
  let effects = persona ? [] : (hero.particles ?? []).map((system) => ({ system, models: [heroModel] }));
  // And those the game's hero page shows on it (Broodmother's web), by their configuration or
  // the control points the hero gives
  if (!persona) {
    for (const { system, config, points } of hero.portrait ?? []) {
      effects.push({ system, models: [heroModel], ...(config && { config }), ...(points && { points }) });
    }
  }
  for (const { item, models } of worn) {
    for (const [from, to] of item.particles?.swap ?? []) {
      effects = effects.map((effect) => (effect.system === from ? { ...effect, system: to, models: models.map((url) => url.split("#")[0]) } : effect));
    }
  }
  for (const { item, models } of worn) {
    for (const system of item.particles?.add ?? []) {
      effects.push({ system, models: models.map((url) => url.split("#")[0]) });
    }
  }
  const snapshots = {};
  for (const { item } of worn) {
    for (const [from, to] of item.particles?.snapshots ?? []) snapshots[from] = to;
  }
  const seen = new Set();
  return effects
    .filter((effect) => !seen.has(effect.system) && seen.add(effect.system))
    .map((effect) => (Object.keys(snapshots).length ? { ...effect, snapshots } : effect));
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
    .map((hero) => ({
      ...hero,
      defaults: hero.defaults.filter((entry) => ready(entry.models)),
      personas: hero.personas?.filter((model) => ready([model])),
    }));
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
// #/scene/backgrounds/hero_showcase_antimage_persona?camera=herocamera
export function parseRoute(hash) {
  const [, type, id, query] = hash.match(/^#\/(hero|item|shop|treasure|audio|scene)\/([^?]+)(?:\?(.*))?$/) ?? [];
  if (!type) {
    return null;
  }
  const params = new URLSearchParams(query ?? "");
  if (type === "scene") {
    return { type, id: decodeURIComponent(id), camera: params.get("camera") || undefined };
  }
  if (["shop", "treasure", "audio"].includes(type)) {
    return { type, id: decodeURIComponent(id) };
  }
  if (type === "hero") {
    const slots = {};
    const bare = params.get("bare") === "1";
    const persona = Number(params.get("persona")) || 0;
    params.delete("bare");
    params.delete("persona");
    for (const [slot, value] of params) {
      const [itemId, style] = value.split(".");
      slots[slot] = { id: itemId, style: Number(style) || 0 };
    }
    return { type, id: decodeURIComponent(id), slots, bare, persona };
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
    route.persona && params.set("persona", route.persona);
  } else if (route.type === "scene") {
    route.camera && params.set("camera", route.camera);
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
