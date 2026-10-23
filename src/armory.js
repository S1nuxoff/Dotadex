// The Armory's World and Interface categories as client.dll lays them out (the table at
// 0x185b949e0: id, label, icon, a filter class, the global loadout slot; the groups added by
// 0x182611d00 / 0x182611e30), and which of items_game's items each takes. The game's filters read
// flags of the parsed item definition; here the same is read off the items_game entry they come
// from (its prefab, slot, bundle contents, tool type).

// [tab, group, [category id, label, icon, rows of the list]]; a category with rows lists its items
// under them (Creeps: Radiant / Dire / Siege), the icons are control_icons/24px/<icon>.svg unless named in full (the game spells Roshan's roashan.svg)
export const ARMORY_GROUPS = [
  [
    "world",
    "World",
    [
      ["couriers", "Couriers", "couriers"],
      ["wards", "Wards", "wards"],
      ["terrain", "Terrain", "terrain"],
      ["creeps", "Creeps", "creeps", [["radiant_creeps", "Radiant Creeps"], ["dire_creeps", "Dire Creeps"], ["radiant_siege_creeps", "Radiant Siege Creeps"], ["dire_siege_creeps", "Dire Siege Creeps"]]],
      ["towers", "Towers", "towers", [["radiant_towers", "Radiant Towers"], ["dire_towers", "Dire Towers"]]],
      ["ancient", "Ancient", "ancients"],
      ["pet_effigy", "Effigy Pet", "effigy_pet"],
      ["roshan", "Roshan", "roashan.svg"],
      ["tormentor", "Tormentor", "tormentor_png.png"],
      ["map_effects", "Map Effects", "map_effects"],
      ["weather", "Weather Effects", "weather_effects"],
      ["emblems", "Emblems", "emblems"],
    ],
  ],
  [
    "interface",
    "Audio",
    [
      ["music", "Music", "music"],
      ["announcer_packs", "Announcer Packs", "announcer_packs"],
      ["mega_kills", "Mega Kills", "mega_kills"],
    ],
  ],
  [
    "interface",
    "Interface",
    [
      ["loading_screens", "Loading Screens", "loading_screens"],
      ["versus_screens", "Versus Screens", "versus_screens"],
      ["huds", "HUDs", "huds"],
      ["streak_effects", "Kill Streak Effects", "kill_streak_effects"],
      ["cursor_packs", "Cursor Packs", "cursor_packs"],
      ["emoticons", "Emoticons", "emoticons"],
      ["chat_wheel", "Chat Wheel", "chatwheel"],
      ["multikill_banner", "Multikill Banner", "multikill_banner"],
    ],
  ],
  [
    "interface",
    "Stickers",
    [
      ["stickers", "Stickers", "sticker"],
      ["capsules", "Sticker Capsules", "sticker_capsule"],
    ],
  ],
  [
    "interface",
    "Misc",
    [
      ["event", "Event", "battle_passes"],
      ["gems", "Gems", "gems"],
      ["bundles", "Bundles", "bundles"],
      ["other", "Other", "other"],
    ],
  ],
  // The Treasury's rows (0x185b96090): its chests are the catalog's treasures, the rest are items
  [
    "treasury",
    "Treasury",
    [
      ["treasures", "Treasures", "treasure"],
      ["keys", "Keys", "key"],
      ["charms", "Charms", "charm"],
    ],
  ],
];

// The slot an item is in, its own or its prefab's
function slotOf(item, prefabs) {
  return item.item_slot ?? prefabs?.[item.prefab]?.item_slot ?? null;
}

const heroesOf = (item) => (item.used_by_heroes && typeof item.used_by_heroes === "object" ? Object.keys(item.used_by_heroes) : []);

// Prefabs the Treasury lists (Treasures, Keys, Charms), and kept out of Other as the game does
const TREASURY = new Set(["treasure_chest", "retired_treasure_chest", "key"]);

// The game's flags of an item's kind, kept out of Other (the definition's 0x21f bits 0x01-0x70)
const OWN_KINDS = new Set(["sticker_capsule", "sticker", "socket_gem", "emoticon_tool"]);

// The Treasury's Charms (0x18263c140): these tools, and the item 16291
const CHARM_TOOLS = new Set(["tournament_passport", "wrapped_gift", "victory_prediction"]);

// The World, Interface or Treasury category of an items_game item and the row of the list it is
// in, or null: { category, row? }
export function armoryCategory(item, prefabs, id) {
  const prefab = item.prefab;
  const slot = slotOf(item, prefabs);
  const tool = item.tool?.type;
  // The Treasury's Keys (tool decoder_ring) and Charms
  if (tool === "decoder_ring") {
    return { category: "keys" };
  }
  if (CHARM_TOOLS.has(tool) || id === "16291") {
    return { category: "charms" };
  }
  // Emoticons: the game's emoticon flag, set for the emoticon packs and the tools unlocking them
  if (tool === "emoticon_unlock") {
    return { category: "emoticons" };
  }
  const byPrefab = {
    courier: "couriers",
    ward: "wards",
    terrain: "terrain",
    ancient: "ancient",
    roshan: "roshan",
    tormentor: "tormentor",
    map_effect: "map_effects",
    weather: "weather",
    emblem: "emblems",
    loading_screen: "loading_screens",
    versus_screen: "versus_screens",
    hud_skin: "huds",
    streak_effect: "streak_effects",
    cursor_pack: "cursor_packs",
    emoticon_tool: "emoticons",
    music: "music",
    sticker: "stickers",
    sticker_capsule: "capsules",
    socket_gem: "gems",
  };
  if (byPrefab[prefab]) {
    return { category: byPrefab[prefab] };
  }
  const rows = {
    radiantcreeps: ["creeps", "radiant_creeps"],
    direcreeps: ["creeps", "dire_creeps"],
    radiantsiegecreeps: ["creeps", "radiant_siege_creeps"],
    diresiegecreeps: ["creeps", "dire_siege_creeps"],
    radianttowers: ["towers", "radiant_towers"],
    diretowers: ["towers", "dire_towers"],
  }[prefab];
  if (rows) {
    return { category: rows[0], row: rows[1] };
  }
  // The rest by their global slot
  const bySlot = { pet_effigy: "pet_effigy", weather: "weather", multikill_banner: "multikill_banner", announcer: "announcer_packs", mega_kills: "mega_kills" };
  if (bySlot[slot]) {
    return { category: bySlot[slot] };
  }
  // Battle passes: tool type compendium (also event_points of one event, left out)
  if (tool === "compendium") {
    return { category: "event" };
  }
  const heroes = heroesOf(item);
  // Bundles: those of no hero or of several (a single hero's bundle is its set)
  if (item.bundle && typeof item.bundle === "object") {
    return heroes.length === 1 ? null : { category: "bundles" };
  }
  // Other: no hero, no slot, none of the kinds above, not the Treasury's
  if (heroes.length || (slot && slot !== "none") || OWN_KINDS.has(prefab) || TREASURY.has(prefab) || prefab === "default_item") {
    return null;
  }
  return { category: "other" };
}

// The weather items' effects by their weather_type (client.dll's table at 0x184945790, 0 none)
export const WEATHER_SYSTEMS = [
  null,
  "particles/rain_fx/econ_snow.vpcf",
  "particles/rain_fx/econ_rain.vpcf",
  "particles/rain_fx/econ_moonlight.vpcf",
  "particles/rain_fx/econ_weather_pestilence.vpcf",
  "particles/rain_fx/econ_weather_harvest.vpcf",
  "particles/rain_fx/econ_weather_sirocco.vpcf",
  "particles/rain_fx/econ_weather_spring.vpcf",
  "particles/rain_fx/econ_weather_ash.vpcf",
  "particles/rain_fx/econ_weather_aurora.vpcf",
];
// The map a weather is shown over (the game's is the match's map): the default terrain's preview
export const WEATHER_SCENE = "terrain_previews/dota_default_preview";

// The categories whose items the game shows in the Armory's scene beside a narrower list
// (dashboard_page_collection's CollectionTab_* rules for #SceneGroup); the rest list 1470 wide
// (and on the site the weather, over the default terrain's preview map, the pets and the Ancients,
// which the game lists without a scene but have models to see)
export const SCENE_CATEGORIES = new Set(["couriers", "wards", "terrain", "creeps", "towers", "emblems", "roshan", "tormentor", "weather", "pet_effigy", "ancient"]);

// Every category by its id: { id, label, icon, rows, tab, group }
export const ARMORY_CATEGORIES = Object.fromEntries(
  ARMORY_GROUPS.flatMap(([tab, group, list]) => list.map(([id, label, icon, rows]) => [id, { id, label, icon, rows, tab, group }]))
);

// A category's icon in the dataset (control_icons/24px)
export function categoryIcon(modelsBase, category) {
  const file = category.icon.includes(".") ? category.icon : `${category.icon}.svg`;
  return `${modelsBase}images/control_icons/24px/${file}`;
}
