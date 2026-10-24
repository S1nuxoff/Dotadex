// The models dataset the site is built for: the catalog's modelsBase (build-catalog.mjs), and known
// to the page from the start (vite.config.js), so its files are asked for alongside the catalog.
// HF_DATASET builds against another copy of it (owner/name).
import { MODELS_BASE as DEFAULT_BASE } from "../src/datasets.js";

export const MODELS_BASE = process.env.HF_DATASET
  ? `https://huggingface.co/datasets/${process.env.HF_DATASET}/resolve/main/`
  : DEFAULT_BASE;
