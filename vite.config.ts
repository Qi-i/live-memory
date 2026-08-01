import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages project site and OAuth callbacks both live under /live-memory/.
  base: "/live-memory/",
  build: {
    sourcemap: false,
  },
});
