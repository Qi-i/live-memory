import { resolve } from "node:path";
import { defineConfig } from "vite";

// The standalone V3 prototype is a separate, demo-only entry with no
// authentication, personal files, application database, or sync dependencies.
// GitHub Pages production retains the existing /live-memory/ path and entry.
const standalonePreview = process.env.VITE_V3_STANDALONE === "1";

export default defineConfig({
  base: standalonePreview ? "/live-memory/v3-preview/" : "/live-memory/",
  build: {
    sourcemap: false,
    ...(standalonePreview
      ? { rollupOptions: { input: resolve(process.cwd(), "v3-preview.html") } }
      : {}),
  },
});
