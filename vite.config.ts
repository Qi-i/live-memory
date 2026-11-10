import { defineConfig, loadEnv } from "vite";

// V3 preview is a separate, demo-only app entry: no AccessGate, database,
// personal cloud, credentials or production service worker are imported.
// The existing GitHub Pages app remains under /live-memory/.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  const standalonePreview = env.VITE_V3_STANDALONE === "1";
  const isolatedRealBeta = env.VITE_V3_BETA === "1";
  const buildEnvironment = (globalThis as {process?: {env?: Record<string,string|undefined>}}).process?.env || {};
  return {
    base: standalonePreview ? "/live-memory/v3-preview/" : isolatedRealBeta ? "/" : "/live-memory/",
    plugins: isolatedRealBeta ? [{
      name: "live-memory-v3-beta-build-info",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "v3-build-info.json",
          source: JSON.stringify({
            sha: buildEnvironment.VERCEL_GIT_COMMIT_SHA || buildEnvironment.GITHUB_SHA || "unknown",
            version: "v3-isolated-beta",
            release: false,
            cloudWriterCutover: false,
          }),
        });
      },
    }] : [],
    build: {
      sourcemap: false,
      ...(standalonePreview ? { rollupOptions: { input: "v3-preview.html" } } : {}),
    },
  };
});
