import { defineConfig } from "vite";

export default defineConfig({
  // Relative assets work both at localhost and under /live-memory/ on GitHub Pages.
  base: "./",
  build: {
    sourcemap: true,
  },
});
