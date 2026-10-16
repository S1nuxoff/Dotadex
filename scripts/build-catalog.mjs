// Builds public/catalog.json: every hero and item that has a model, with what the
// viewer needs to list, filter and show them. Which models are exported so far is read
// from the dataset's index.json in the browser, so new ones show up without a rebuild.
import fs from "node:fs";

const DATASET = process.env.HF_DATASET || "Sqls1/dota2-models";
const MODELS_BASE = `https://huggingface.co/datasets/${DATASET}/resolve/main/`;
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
// (the dataset has each as particles/<path>.json). Modifiers of a style other than the first
// are left out.
function particlesOf(item) {
  const add = [];
  const swap = [];
  for (const visual of Object.values(item?.visuals ?? {})) {
    if (!visual || typeof visual !== "object" || (visual.style !== undefined && String(visual.style) !== "0")) {
      continue;
    }
    const system = (value) => (typeof value === "string" && value.toLowerCase().endsWith(".vpcf") ? value.toLowerCase() : null);
    if (visual.type === "particle_create" && system(visual.modifier)) {
      add.push(system(visual.modifier));
    } else if (visual.type === "particle" && system(visual.asset) && system(visual.modifier)) {
      swap.push([system(visual.asset), system(visual.modifier)]);
    }
  }
  return add.length || swap.length ? { ...(add.length && { add }), ...(swap.length && { swap }) } : null;
}

// A hero's own effects: those of its default items that have no model (its ambient effects)
for (const [id, item] of Object.entries(gameItems)) {
  if (item.prefab !== "default_item" || index.items[id]) {
    continue;
  }
  const particles = particlesOf(item);
  for (const key of particles ? Object.keys(item.used_by_heroes ?? {}) : []) {
    const hero = heroes[heroIdOf(key)];
    if (hero) {
      hero.particles = [...new Set([...(hero.particles ?? []), ...(particles.add ?? [])])];
    }
  }
}

for (const [id, entry] of Object.entries(index.items)) {
  const item = gameItems[id];
  const heroKeys = Object.keys(item.used_by_heroes ?? {});
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
  const particles = particlesOf(item);
  if (particles) {
    record.particles = particles;
  }
  const price = priceOf(entry.name);
  if (price) {
    record.price = price;
  }

  items.push(record);
  idByName.set(entry.name, id);
}

// What a hero wears by default, so a hero shows up complete; a persona's are in its own slots
for (const [id, item] of Object.entries(gameItems)) {
  if (item.prefab !== "default_item" || item.item_slot === "persona_selector" || !index.items[id]) {
    continue;
  }
  for (const key of Object.keys(item.used_by_heroes ?? {})) {
    heroes[heroIdOf(key)]?.defaults.push({ id, slot: item.item_slot ?? "weapon", models: index.items[id].models });
  }
}

const itemById = new Map(items.map((item) => [item.id, item]));

// Sets of a hero's items, worn together
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
const [shopData, treasureData, englishTexts, library] = await Promise.all([
  gameData("items.json"),
  gameData("treasures.json"),
  gameData("i18n/english.json"),
  gameData("audio-library.json"),
]);

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
  points: scene.points,
}));

const audio = Object.entries(library ?? {}).flatMap(([kind, packs]) =>
  Object.entries(packs).map(([folder, files]) => ({ id: `${kind}/${folder}`, kind, name: packName(folder), count: files.length }))
);
audio.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
// The game spells some keys DOTA_Tooltip_Ability_ and others DOTA_Tooltip_ability_
const texts = Object.fromEntries(Object.entries(englishTexts ?? {}).map(([key, value]) => [key.toLowerCase(), value]));

const shop = [];
for (const [name, item] of Object.entries(shopData ?? {})) {
  const title = texts[`dota_tooltip_ability_${name}`.toLowerCase()];
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
