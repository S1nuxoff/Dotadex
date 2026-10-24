// Every place the site reads data from, named once. Moving a kind of data to another dataset
// changes one line here (TASKS.md, D-01). Plain constants, so the build scripts read it in Node too.

const HF_OWNER = "Sqls1";
const GITHUB_OWNER = "S1nuxoff";

// The Hugging Face datasets the tracker exports the game to
export const DATASETS = {
  data: "dota2-data",
  images: "dota2-images",
  videos: "dota2-videos",
  models: "dota2-models",
  sounds: "dota2-sounds",
  scenes: "dota2-scenes",
};

// A dataset's id (owner/name), its page, and the base its files are read from
export const datasetId = (name) => `${HF_OWNER}/${name}`;
export const datasetPage = (name) => `https://huggingface.co/datasets/${datasetId(name)}`;
export const datasetBase = (name) => `${datasetPage(name)}/resolve/main/`;

// The game's scripts and texts at their game paths, as JSON (items_game, localizations, npc_*)
export const DATA_BASE = datasetBase(DATASETS.data);
// The files the tracker makes for Dotadex out of them: index.json, exported.json, data/...
export const DOTADEX_BASE = `${DATA_BASE}dotadex/`;
// Every picture and video of the game's interface, as the game keeps it, at its game path
export const IMAGES_BASE = datasetBase(DATASETS.images);
export const VIDEOS_BASE = datasetBase(DATASETS.videos);
export const MODELS_BASE = datasetBase(DATASETS.models);
export const SOUNDS_BASE = datasetBase(DATASETS.sounds);
export const SCENES_BASE = datasetBase(DATASETS.scenes);

const githubRaw = (repo) => `https://raw.githubusercontent.com/${GITHUB_OWNER}/${repo}/main/static/`;

// Market prices, updated every 20 minutes (not from the game, so they stay on GitHub)
export const PRICES_URL = `${githubRaw("dota2-price-tacker")}prices/latest.json`;

// A picture of the game's interface by its name under panorama/images, without the extension
// ("heroes/icons/npc_dota_hero_axe_png"): the PNG the game keeps, or a JPEG for one made from a
// JPEG (its name ends in _jpg). A vector one (.svg) is named with its extension: panoramaFile.
export const panoramaImage = (name) => `${IMAGES_BASE}panorama/images/${name}.${name.endsWith("_jpg") ? "jpg" : "png"}`;
export const panoramaFile = (file) => `${IMAGES_BASE}panorama/images/${file}`;
// A game picture a data file names as images/<its path under panorama/images> (emoticons, masks)
export const dataImage = (image) => `${IMAGES_BASE}panorama/${image}`;

// Valve's web pictures the game has no copy of: the heroes' square crops (the Wardrobe)
export const STEAM_REACT_BASE = "https://cdn.steamstatic.com/apps/dota2/images/dota_react/";
