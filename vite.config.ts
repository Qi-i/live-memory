import { defineConfig, loadEnv } from "vite";

// V3 preview is a separate, demo-only app entry: no AccessGate, database,
// personal cloud, credentials or production service worker are imported.
// The existing GitHub Pages app remains under /live-memory/.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  const standalonePreview = env.VITE_V3_STANDALONE === "1";
  return {
    base: env.VITE_V3_BETA === "1" ? (env.VITE_V3_BETA_BASE === "pages" ? "/live-memory/v3-beta/" : "/") : standalonePreview ? "/live-memory/v3-preview/" : "/live-memory/",
    build: {
      sourcemap: false,
      ...(standalonePreview ? { rollupOptions: { input: "v3-preview.html" } } : {}),
    },
  };
});
