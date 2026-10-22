import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { MODELS_BASE } from "./scripts/dataset.mjs";

// Served from https://s1nuxoff.github.io/Dotadex/
export default defineConfig({
  base: "/Dotadex/",
  plugins: [react(), tailwindcss()],
  define: { __MODELS_BASE__: JSON.stringify(MODELS_BASE) },
  // three.js alone is most of the bundle
  build: { chunkSizeWarningLimit: 1200 },
});
