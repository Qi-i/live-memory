import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AccessGate } from "./access";
import { ExperienceThemeProvider } from "./experience";
import "./base.css";
import "./access.css";
import "./experience.css";
import "./archive.css";
import "./archiveBanner.css";
import "./statsPage.css";
import "./settingsPage.css";
import "./overlays.css";
import "./posterFrames.css";
import "./archivePolish.css";
import "./brand.css";
import "./liquidStage.css";
import "./ui/editorWorkflow.css";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
// Switching the public application shell is reversible. Account writes stay
// fenced by the server-side V3 writer marker; classic V2 remains accessible.
const v3Production = import.meta.env.VITE_V3_PRODUCTION === "1";
const classicMode = v3Production && new URLSearchParams(window.location.search).has("v2-classic");
const v3Preview = import.meta.env.VITE_V3_PREVIEW === "1"
  && new URLSearchParams(window.location.search).has("v3-preview");
// The isolated V3 beta remains separate from the reversible production route.
const v3Beta = import.meta.env.VITE_V3_BETA === "1";
const v3RealWorkspace = v3Beta || (
  (v3Production && !classicMode) ||
  import.meta.env.VITE_V3_REAL_WORKSPACE === "1"
  && new URLSearchParams(window.location.search).has("v3-real-workspace")
);

if (v3Preview) {
  // Independent design laboratory; intentionally never touches user login,
  // IndexedDB, cloud sync or the production application state.
  void import("./ui/system/V3Preview").then(({ V3Preview }) => {
    root.render(<React.StrictMode><V3Preview /></React.StrictMode>);
  });
} else if (v3RealWorkspace) {
  // V3 becomes the public home when enabled by the release workflow.
  // AccessGate establishes the actual scoped identity. Only an account with
  // a verified server-side V3 writer marker may edit and manually sync;
  // existing V2 owners stay read-only, and V2 AppRoot/timers never mount.
  void import("./ui/real/V3RealWorkspace").then(({ V3RealWorkspace }) => {
    root.render(
      <React.StrictMode><AccessGate><V3RealWorkspace /></AccessGate></React.StrictMode>,
    );
  });
} else {
  root.render(
    <React.StrictMode>
      <ExperienceThemeProvider>
        <AccessGate>
          <App />
        </AccessGate>
      </ExperienceThemeProvider>
    </React.StrictMode>,
  );
}

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL || "./";
    if (v3Beta) {
      // GitHub Pages V2's broader /live-memory/ worker also matches /v3-beta/.
      // Give only this beta path a more specific, pass-through worker so it
      // cannot be served a stale V2 HTML shell or cross-version media cache.
      // It never caches data and cannot control the official V2 route.
      navigator.serviceWorker.register(`${base}beta-sw.js`,{scope:base}).catch(() => undefined);
    } else {
      navigator.serviceWorker.register(`${base}sw.js`).catch(() => undefined);
    }
  });
}
