// Builds public/catalog.json: every hero and item that has a model, with what the
// viewer needs to list, filter and show them. Which models are exported so far is read
// from the dataset's index.json in the browser, so new ones show up without a rebuild.
import fs from "node:fs";
import { MODELS_BASE } from "./dataset.mjs";
import { armoryCategory } from "../src/armory.js";

const FILES = "https://raw.githubusercontent.com/S1nuxoff/dota2-file-tracker/main/static";
const PRICES_URL = "https://raw.githubusercontent.com/S1nuxoff/dota2-price-tacker/main/static/prices/latest.json";
const OUT = "public/catalog.json";

// Internal hero names that differ from the ones players know
const HERO_NAMES = {
  abyssal_underlord: "Underlord",
  antimage: "Anti-Mage",
  centaur: "Centaur Warrunner",
  doom_bringer: "Doom",
  furion: "Nature's Prophet",
  life_stealer: "Lifestealer",
  magnataur: "Magnus",
  necrolyte: "Necrophos",
  nevermore: "Shadow Fiend",
  obsidian_destroyer: "Outworld Destroyer",
  queenofpain: "Queen of Pain",
  rattletrap: "Clockwerk",
  shredder: "Timbersaw",
  skeleton_king: "Wraith King",
  treant: "Treant Protector",
  vengefulspirit: "Vengeful Spirit",
  windrunner: "Windranger",
  wisp: "Io",
  zuus: "Zeus",
};

async function getJson(url, fallback) {
  const res = await fetch(url);
  if (!res.ok) {
    if (fallback !== undefined) {
      console.warn(`${url}: HTTP ${res.status}, going on without it`);
      return fallback;
    }
    throw new Error(`${url}: HTTP ${res.status}`);
  }
  return res.json();
}

function heroName(id) {
  return HERO_NAMES[id] ?? id.split("_").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

const heroIdOf = (key) => key.replace("npc_dota_hero_", "");
// The heroes an item is for; some say used_by_heroes "1" (couriers, music packs), which names none
const heroKeysOf = (item) => (item.used_by_heroes && typeof item.used_by_heroes === "object" ? Object.keys(item.used_by_heroes) : []);

// INDEX_FILE: a local index.json, to try the site with a full catalog before an export
const [index, itemsGame, english, prices] = await Promise.all([
  process.env.INDEX_FILE ? JSON.parse(fs.readFileSync(process.env.INDEX_FILE, "utf8")) : getJson(`${MODELS_BASE}index.json`),
  getJson(`${FILES}/items_game.json`).then((data) => data.items_game),
  getJson(`${FILES}/items_english.json`, { lang: { Tokens: {} } }).then((data) => data.lang.Tokens),
  getJson(PRICES_URL, {}),
]);
const gameItems = itemsGame.items;
const localize = (token) => (token?.startsWith("#") ? english[token.slice(1)] : null);

// A market price: the average of the last month, or the last sale for items rarely sold
function priceOf(name) {
  const steam = prices[name]?.steam;
  const value = steam && (steam.last_30d ?? steam.last_7d ?? steam.last_90d ?? steam.last_ever);
  return value ? Math.round(value * 100) / 100 : undefined;
}

// Whether the store sells an item now: it has a store price, is not kept out of the store and
// has not expired (the Armory's Purchasable / Unavailable filters)
const now = new Date().toISOString().slice(0, 10);
function inStore(item) {
  return Boolean(item.price_info) && item.hide_in_store !== "1" && !(item.expiration_date && item.expiration_date.slice(0, 10) < now);
}

// An item's place in the Armory's World or Interface tab, and what its preview plays: a music
// pack's events (<pack>.music.*), an announcer's sound folder
function armoryFields(item, id) {
  const place = armoryCategory(item, itemsGame.prefabs, id);
  if (!place) return null;
  const fields = { category: place.category };
  if (place.row) fields.row = place.row;
  for (const visual of Object.values(item.visuals ?? {})) {
    if (visual?.type === "sound" && typeof visual.modifier === "string" && visual.modifier.endsWith(".music.")) {
      fields.music = visual.modifier.slice(0, -".music.".length);
    } else if (visual?.type === "portrait_background_map" && typeof visual.asset === "string" && String(visual.style ?? "0") === "0") {
      // A terrain's preview map (maps/terrain_previews/<name>.vmap), a scene of the scenes dataset
      fields.scene = visual.asset.toLowerCase().replace(/^maps\//, "").replace(/\.vmap$/, "");
    } else if (visual?.type === "cursor_pack" && typeof visual.asset === "string") {
      // resource/cursor/valve/<pack>
      fields.cursor = visual.asset.toLowerCase().split("/").pop();
    } else if (visual?.type === "announcer" && typeof visual.asset === "string") {
      fields.announcer = visual.asset.replace(/^npc_dota_hero_/, "");
    }
  }
  // An emoticon pack unlocks a range of emoticons (scripts/emoticons.txt ids)
  const usage = item.tool?.type === "emoticon_unlock" ? item.tool.usage : null;
  if (usage?.emoticon_id_start) {
    fields.emoticons = [Number(usage.emoticon_id_start), Number(usage.emoticon_id_end ?? usage.emoticon_id_start)];
  }
  return fields;
}

const heroes = {};
for (const [key, model] of Object.entries(index.heroes)) {
  const id = heroIdOf(key);
  heroes[id] = { id, name: heroName(id), model, defaults: [] };
  // Personas: the hero's other bodies, worn with the items of their own slots (*_persona_1)
  if (index.personas?.[key]?.length) {
    heroes[id].personas = index.personas[key];
  }
}

const items = [];
const idByName = new Map();

// The particle systems an item shows: those it creates, and those it puts in place of others
// (the dataset has each as particles/<path>.json), and the snapshots it puts in place of others
// (a weapon's own points for the default weapon's glow, particles/<path>.vsnap.json). Modifiers of a style other than the first
// are left out, and so are those the game shows only in its alternate loadout view. A courier's
// effects of one of its forms are kept apart (flying, ground).
function particlesOf(item) {
  const add = [];
  const flying = [];
  const ground = [];
  const swap = [];
  const snapshots = [];
  for (const visual of Object.values(item?.visuals ?? {})) {
    if (!visual || typeof visual !== "object" || (visual.style !== undefined && String(visual.style) !== "0")) {
      continue;
    }
    // Shown only in the game's other loadout view (a hero's alternate form, as Terrorblade's
    // demon), not on the hero as it stands
    if (String(visual.spawn_in_alternate_loadout_only ?? "0") === "1") {
      continue;
    }
    const system = (value) => (typeof value === "string" && value.toLowerCase().endsWith(".vpcf") ? value.toLowerCase() : null);
    if (visual.type === "particle_create" && system(visual.modifier)) {
      // A courier's effect of one form only (a flying courier's rockets)
      const form = String(visual.flying_courier_only ?? "0") === "1" ? flying : String(visual.ground_courier_only ?? "0") === "1" ? ground : add;
      form.push(system(visual.modifier));
    } else if (visual.type === "particle" && system(visual.asset) && system(visual.modifier)) {
      swap.push([system(visual.asset), system(visual.modifier)]);
    } else if (visual.type === "particle_snapshot" && typeof visual.asset === "string" && typeof visual.modifier === "string") {
      snapshots.push([visual.asset.toLowerCase(), visual.modifier.toLowerCase()]);
    }
  }
  return add.length || flying.length || ground.length || swap.length || snapshots.length
    ? { ...(add.length && { add }), ...(flying.length && { flying }), ...(ground.length && { ground }), ...(swap.length && { swap }), ...(snapshots.length && { snapshots }) }
    : null;
}

// The activity modifiers an item gives the hero's animations ([activity or "ALL", modifier, style]),
// by which the game picks among the sequences of an activity: Sven's TI7 sword makes his loadout
// spawn `loadout_ti7_spawn` (ACT_DOTA_SPAWN + ti7 + loadout). The style is given where the item
// gives it, for the site to keep those of the style worn; alternate-loadout-only ones are left out
function activitiesOf(item) {
  const list = [];
  for (const visual of Object.values(item?.visuals ?? {})) {
    if (!visual || typeof visual !== "object" || visual.type !== "activity" || typeof visual.modifier !== "string") {
      continue;
    }
    if (String(visual.spawn_in_alternate_loadout_only ?? "0") === "1") {
      continue;
    }
    const entry = [typeof visual.asset === "string" ? visual.asset : "ALL", visual.modifier];
    list.push(visual.style !== undefined ? [...entry, Number(visual.style)] : entry);
  }
  return list.length ? list : null;
}

// The skins an item puts on its hero's own model (asset modifier model_skin: Legion Commander's
// Arcana, Lina's Fiery Soul): [{ skin, style? }], style when only one of the item's styles does
function heroSkinsOf(item) {
  const list = [];
  for (const [key, visual] of Object.entries(item?.visuals ?? {})) {
    if (!key.startsWith("asset_modifier") || visual?.type !== "model_skin" || !Number(visual.skin)) continue;
    list.push(visual.style !== undefined ? { skin: Number(visual.skin), style: Number(visual.style) } : { skin: Number(visual.skin) });
  }
  return list.length ? list : null;
}

// A hero's own effects: those of its default items that have no model (its ambient effects)
for (const [id, item] of Object.entries(gameItems)) {
  if (item.prefab !== "default_item" || index.items[id]) {
    continue;
  }
  const particles = particlesOf(item);
  for (const key of particles ? heroKeysOf(item) : []) {
    const hero = heroes[heroIdOf(key)];
    if (hero) {
      hero.particles = [...new Set([...(hero.particles ?? []), ...(particles.add ?? [])])];
    }
  }
  // And its activity modifiers, which such an item gives too
  const activities = activitiesOf(item);
  for (const key of activities ? heroKeysOf(item) : []) {
    const hero = heroes[heroIdOf(key)];
    if (hero) {
      hero.activities = [...(hero.activities ?? []), ...activities];
    }
  }
}

for (const [id, entry] of Object.entries(index.items)) {
  const item = gameItems[id];
  const heroKeys = heroKeysOf(item);
  const hero = heroKeys.length === 1 ? heroIdOf(heroKeys[0]) : null;
  const kind = item.prefab === "courier" ? "courier" : item.prefab === "ward" ? "ward" : hero ? "wearable" : "other";

  const record = {
    id,
    name: entry.name,
    kind,
    rarity: item.item_rarity ?? (item.prefab === "default_item" ? "default" : "common"),
    models: entry.models,
  };
  if (hero) {
    record.hero = hero;
    // Wearables without a slot are weapons, as in the game
    record.slot = item.item_slot ?? "weapon";
  }
  if (item.prefab === "default_item") {
    record.default = 1;
  }
  if (item.image_inventory) {
    record.icon = item.image_inventory;
  }
  if (item.creation_date) {
    record.date = item.creation_date;
  }
  if (entry.styles) {
    record.styles = entry.styles;
  }
  if (entry.skin) {
    record.skin = entry.skin;
  }
  const units = unitsOf(item);
  if (units) {
    record.units = units;
  }
  const particles = particlesOf(item);
  if (particles) {
    record.particles = particles;
  }
  const activities = activitiesOf(item);
  if (activities) {
    record.activities = activities;
  }
  const heroSkins = heroSkinsOf(item);
  if (heroSkins) {
    record.heroSkins = heroSkins;
  }
  const price = priceOf(entry.name);
  if (price) {
    record.price = price;
  }
  if (inStore(item)) {
    record.store = 1;
  }
  Object.assign(record, hero ? null : armoryFields(item, id));

  items.push(record);
  idByName.set(entry.name, id);
}

// The Armory's other items, which have no model: loading screens, HUDs, music packs, stickers,
// bundles... (those of the World and Interface tabs), with their picture. Hidden ones and those
// without a picture (league passes, event tools) are left out
for (const [id, item] of Object.entries(gameItems)) {
  if (index.items[id] || id === "default" || item.hidden === "1" || !item.image_inventory) {
    continue;
  }
  const fields = armoryFields(item, id);
  if (!fields) {
    continue;
  }
  const name = localize(item.item_name) ?? item.name;
  const record = { id, name, kind: "other", rarity: item.item_rarity ?? "common", models: [], icon: item.image_inventory, ...fields };
  if (item.creation_date) record.date = item.creation_date;
  const particles = particlesOf(item);
  if (particles) record.particles = particles;
  const price = priceOf(item.name);
  if (price) record.price = price;
  if (inStore(item)) record.store = 1;
  items.push(record);
  idByName.set(item.name, id);
}

// A hero's base items with no model of their own (the Arcanas that change the hero itself:
// Legion Commander's Blades of Voth Domosh, a skin of her model and effects): in the game's
// hero_base slot, worn like any other item, so their sets are complete
for (const [id, item] of Object.entries(gameItems)) {
  const heroKeys = heroKeysOf(item);
  // And the taunts (an activity modifier on ACT_DOTA_TAUNT), in the hero's taunt slot
  const taunt = item.prefab === "taunt";
  if (index.items[id] || !((item.prefab === "wearable" && item.item_slot === "hero_base") || taunt) || heroKeys.length !== 1 || !item.image_inventory) {
    continue;
  }
  const name = localize(item.item_name) ?? item.name;
  const record = {
    id,
    name,
    kind: "wearable",
    rarity: item.item_rarity ?? "common",
    models: [],
    hero: heroIdOf(heroKeys[0]),
    slot: taunt ? "taunt" : "hero_base",
    icon: item.image_inventory,
  };
  if (item.creation_date) record.date = item.creation_date;
  const particles = particlesOf(item);
  if (particles) record.particles = particles;
  const activities = activitiesOf(item);
  if (activities) record.activities = activities;
  const heroSkins = heroSkinsOf(item);
  if (heroSkins) record.heroSkins = heroSkins;
  const price = priceOf(item.name);
  if (price) record.price = price;
  if (inStore(item)) record.store = 1;
  items.push(record);
  idByName.set(item.name, id);
}

// What a hero wears by default, so a hero shows up complete; a persona's are in its own slots.
// A default without a model of its own (Anti-Mage's shoulders, part of his body; ambient effects)
// still fills its slot's tile in the game, so it comes with its name and icon.
for (const [id, item] of Object.entries(gameItems)) {
  if (item.prefab !== "default_item" || item.item_slot === "persona_selector") {
    continue;
  }
  const entry = index.items[id]
    ? { id, slot: item.item_slot ?? "weapon", models: index.items[id].models }
    : item.image_inventory
    ? { id, slot: item.item_slot ?? "weapon", models: [], name: localize(item.item_name) ?? item.name, icon: item.image_inventory }
    : null;
  for (const key of entry ? heroKeysOf(item) : []) {
    heroes[heroIdOf(key)]?.defaults.push(entry);
  }
}

const itemById = new Map(items.map((item) => [item.id, item]));

// Sets of a hero's items, worn together. A set's rarity is its store bundle's (the game's card
// takes the bundle item's: Hell's Legion is Immortal though most of its items are Mythical)
const rarityByName = new Map(Object.values(itemsGame.items ?? {}).map((item) => [item.name, item.item_rarity]));
const sets = [];
for (const [key, set] of Object.entries(itemsGame.item_sets ?? {})) {
  const ids = Object.keys(set.items ?? {})
    .map((name) => idByName.get(name))
    .filter(Boolean);
  const heroesOfSet = new Set(ids.map((id) => itemById.get(id).hero).filter(Boolean));
  if (ids.length < 2 || heroesOfSet.size !== 1) {
    continue;
  }
  const record = { id: key, name: localize(set.name) ?? set.store_bundle ?? key, hero: [...heroesOfSet][0], items: ids };
  if (set.portrait_image) {
    record.icon = set.portrait_image;
  }
  const bundleRarity = rarityByName.get(set.store_bundle);
  if (bundleRarity) {
    record.rarity = bundleRarity;
  }
  sets.push(record);
  for (const id of ids) {
    itemById.get(id).set ??= key;
  }
}

items.sort((a, b) => a.name.localeCompare(b.name));
sets.sort((a, b) => a.name.localeCompare(b.name));

// Names of every hero an item belongs to, also heroes without a model of their own
const heroNames = {};
for (const item of items) {
  if (item.hero) {
    heroNames[item.hero] = heroName(item.hero);
  }
}

// Shop items and treasure chests from the dataset's game data, when it is there
const gameData = async (file) => getJson(`${MODELS_BASE}data/${file}`, null);
const [shopData, treasureData, englishTexts, library, heroData] = await Promise.all([
  gameData("items.json"),
  gameData("treasures.json"),
  gameData("i18n/english.json"),
  gameData("audio-library.json"),
  gameData("heroes.json"),
]);

// The models an item gives a unit instead of wearing them: its entity_model modifiers on a unit that
// is not a hero (Warlock's Golem, Beastmaster's boar): { "<model>.glb": "npc_dota_warlock_golem" }
function unitsOf(item) {
  const units = {};
  for (const [key, value] of Object.entries(item.visuals ?? {})) {
    if (!key.startsWith("asset_modifier") || value?.type !== "entity_model") continue;
    const unit = String(value.asset ?? "").toLowerCase();
    const model = String(value.modifier ?? "").toLowerCase();
    // npc_dota_loadout_generic is no unit of the hero's: a model the loadout shows on the hero
    if (!unit.startsWith("npc_dota_") || unit.startsWith("npc_dota_hero") || unit === "npc_dota_loadout_generic" || !model.endsWith(".vmdl")) continue;
    units[model.replace(/\.vmdl$/, ".glb")] = unit;
  }
  return Object.keys(units).length ? units : null;
}

// The slots a hero's loadout shows, in the game's order: its ItemSlots by SlotIndex, but those
// with DisplayInLoadout 0 (ability effects) and the persona switch
for (const hero of Object.values(heroes)) {
  const slots = Object.values(heroData?.[`npc_dota_hero_${hero.id}`]?.ItemSlots ?? {})
    .filter((slot) => slot?.SlotName && slot.DisplayInLoadout !== "0" && slot.SlotName !== "persona_selector")
    .sort((a, b) => Number(a.SlotIndex) - Number(b.SlotIndex))
    .map((slot) => slot.SlotName);
  if (slots.length) {
    hero.slots = slots;
  }
}

// The effects the game's hero page shows on the hero (its RenderablePortrait Particles:
// Broodmother's web): [{ system, config }] by the name of the effect's control point
// configuration, or [{ system, points }] where the hero gives its control points instead
// ({ "0": { type: "follow_origin" | "follow_attachment", location, position } })
for (const hero of Object.values(heroes)) {
  const particles = heroData?.[`npc_dota_hero_${hero.id}`]?.RenderablePortrait?.Particles ?? {};
  const portrait = Object.entries(particles)
    .filter(([system]) => system.toLowerCase().endsWith(".vpcf"))
    .map(([system, how]) => (typeof how === "string" ? { system: system.toLowerCase(), config: how } : { system: system.toLowerCase(), points: how }));
  if (portrait.length) {
    hero.portrait = portrait;
  }
}

// Announcer and music packs: "announcer_dlc_bastion" -> "Bastion"
const packName = (folder) =>
  folder
    .replace(/^announcer(_dlc)?_?/, "")
    .replace(/_/g, " ")
    .replace(/\w/g, (letter) => letter.toUpperCase()) || "Default";
// Scenes and maps, from the scenes dataset
const scenes = (await getJson(MODELS_BASE.replace("dota2-models", "dota2-scenes") + "scenes.json", [])).map((scene) => ({
  id: scene.id,
  name: scene.name,
  size: scene.size,
  light: scene.light,
  camera: scene.camera,
  // Every named camera of the scene; camera is the one the game's interface looks through
  cameras: scene.cameras,
  points: scene.points,
  // What the map is for ("background", "game", ...) and whether the game's interface shows it
  usage: scene.usage,
  shown: scene.shown,
}));

const audio = Object.entries(library ?? {}).flatMap(([kind, packs]) =>
  Object.entries(packs).map(([folder, files]) => ({ id: `${kind}/${folder}`, kind, name: packName(folder), count: files.length }))
);
audio.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
// The game spells some keys DOTA_Tooltip_Ability_ and others DOTA_Tooltip_ability_
const texts = Object.fromEntries(Object.entries(englishTexts ?? {}).map(([key, value]) => [key.toLowerCase(), value]));

const shop = [];
for (const [name, item] of Object.entries(shopData ?? {})) {
  // The newer neutral items keep their names under a ":n" key
  const title = texts[`dota_tooltip_ability_${name}`.toLowerCase()] ?? texts[`dota_tooltip_ability_${name}:n`.toLowerCase()];
  // Recipes and hidden or event items have no shop name
  if (name.startsWith("item_recipe_") || !title || item.IsObsolete === "1") {
    continue;
  }
  shop.push({
    id: name,
    name: title,
    cost: Number(item.ItemCost) || 0,
    texture: (item.AbilityTextureName ?? name).replace(/^item_/, ""),
    neutral: item.ItemIsNeutralActiveDrop === "1" || item.ItemIsNeutralPassiveDrop === "1" || undefined,
  });
}
shop.sort((a, b) => a.name.localeCompare(b.name));

const treasures = (treasureData ?? [])
  .map((treasure) => ({
    id: treasure.id,
    name: treasure.name,
    icon: treasure.icon,
    rarity: treasure.rarity,
    date: treasure.date,
    retired: treasure.retired || undefined,
    tiers: treasure.tiers.map((tier) => tier.items),
  }))
  .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

const catalog = {
  manifest: index.manifest,
  modelsBase: MODELS_BASE,
  heroNames,
  shop,
  treasures,
  audio,
  scenes,
  heroes: Object.values(heroes).sort((a, b) => a.name.localeCompare(b.name)),
  items,
  sets,
};

fs.mkdirSync("public", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(catalog));
console.log(`${catalog.heroes.length} heroes, ${items.length} items, ${sets.length} sets, ${shop.length} shop items, ${treasures.length} treasures -> ${OUT}`);
