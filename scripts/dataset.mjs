// The dataset the site is built for: the catalog's modelsBase (build-catalog.mjs), and known to
// the page from the start (vite.config.js), so its files are asked for alongside the catalog
const DATASET = process.env.HF_DATASET || "Sqls1/dota2-models";
export const MODELS_BASE = `https://huggingface.co/datasets/${DATASET}/resolve/main/`;
