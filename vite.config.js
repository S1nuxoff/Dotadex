import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Served from https://s1nuxoff.github.io/dota2-model-viewer/
export default defineConfig({
  base: "/dota2-model-viewer/",
  plugins: [react(), tailwindcss()],
  // three.js alone is most of the bundle
  build: { chunkSizeWarningLimit: 1200 },
});
