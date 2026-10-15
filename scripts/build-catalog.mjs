// Builds public/catalog.json: the heroes and items whose models are on Hugging Face,
// with what the viewer needs to list and show them.
import fs from "node:fs";

const DATASET = process.env.HF_DATASET || "Sqls1/dota2-models";
const MODELS_BASE = `https://huggingface.co/datasets/${DATASET}/resolve/main/`;
const ITEMS_URL =
  "https://raw.githubusercontent.com/S1nuxoff/dota2-file-tracker/main/static/items_game.json";
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

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${url}: HTTP ${res.status}`);
  }
  return res.json();
}

function heroName(id) {
  return HERO_NAMES[id] ?? id.split("_").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

const index = await getJson(`${MODELS_BASE}index.json`);
const itemsGame = (await getJson(ITEMS_URL)).items_game.items;

const heroes = {};
for (const [key, model] of Object.entries(index.heroes)) {
  const id = key.replace("npc_dota_hero_", "");
  heroes[id] = { id, name: heroName(id), model, defaults: [] };
}

const exported = new Set(Object.values(index.items).flatMap((item) => item.models));
const items = [];

for (const [id, entry] of Object.entries(index.items)) {
  const item = itemsGame[id];
  const heroKeys = Object.keys(item.used_by_heroes ?? {});
  const hero = heroKeys.length === 1 ? heroKeys[0].replace("npc_dota_hero_", "") : null;
  const kind =
    item.prefab === "courier" ? "courier" : item.prefab === "ward" ? "ward" : hero ? "wearable" : "other";

  items.push({
    id,
    name: entry.name,
    kind,
    hero,
    slot: item.item_slot ?? null,
    rarity: item.item_rarity ?? (item.prefab === "default_item" ? "default" : "common"),
    icon: item.image_inventory ?? null,
    models: entry.models,
  });
}

// What a hero wears by default, skipping personas, so a hero shows up complete
for (const [id, item] of Object.entries(itemsGame)) {
  if (item.prefab !== "default_item" || /persona/.test(item.item_slot ?? "")) {
    continue;
  }
  const models = index.items[id]?.models.filter((model) => exported.has(model)) ?? [];
  for (const key of Object.keys(item.used_by_heroes ?? {})) {
    const hero = heroes[key.replace("npc_dota_hero_", "")];
    if (hero && models.length > 0) {
      hero.defaults.push({ slot: item.item_slot ?? "weapon", models });
    }
  }
}

items.sort((a, b) => a.name.localeCompare(b.name));
// Names of every hero an item belongs to, also those without an exported model yet
const heroNames = {};
for (const item of items) {
  if (item.hero) {
    heroNames[item.hero] = heroName(item.hero);
  }
}

const catalog = {
  manifest: index.manifest,
  modelsBase: MODELS_BASE,
  heroNames,
  heroes: Object.values(heroes).sort((a, b) => a.name.localeCompare(b.name)),
  items,
};

fs.mkdirSync("public", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(catalog));
console.log(`${catalog.heroes.length} heroes, ${items.length} items -> ${OUT}`);
