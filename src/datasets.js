// Every place the site reads data from, named once. Moving a kind of data to another dataset
// changes one line here (TASKS.md, D-01). Plain constants, so the build scripts read it in Node too.

const HF_OWNER = "Sqls1";
const GITHUB_OWNER = "S1nuxoff";

// The Hugging Face datasets the tracker exports the game to
export const DATASETS = {
  data: "dota2-data",
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
export const MODELS_BASE = datasetBase(DATASETS.models);
export const SOUNDS_BASE = datasetBase(DATASETS.sounds);
export const SCENES_BASE = datasetBase(DATASETS.scenes);

const githubRaw = (repo) => `https://raw.githubusercontent.com/${GITHUB_OWNER}/${repo}/main/static/`;

// Cosmetic item icons; to move to a dataset (D-04)
export const IMAGE_TRACKER_BASE = githubRaw("dota2-image-tracker");

// Market prices, updated every 20 minutes (not from the game, so they stay on GitHub)
export const PRICES_URL = `${githubRaw("dota2-price-tacker")}prices/latest.json`;

// Valve's web pictures: hero portraits and crops, attribute icons; to move to a dataset (D-04)
export const STEAM_REACT_BASE = "https://cdn.steamstatic.com/apps/dota2/images/dota_react/";
