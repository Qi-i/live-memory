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
const v3Preview = import.meta.env.VITE_V3_PREVIEW === "1"
  && new URLSearchParams(window.location.search).has("v3-preview");
const migrationLab = import.meta.env.VITE_V3_MIGRATION_LAB === "1";
const v3RealWorkspace = import.meta.env.VITE_V3_REAL_WORKSPACE === "1"
  && new URLSearchParams(window.location.search).has("v3-real-workspace");

if (migrationLab) {
  // The isolated release-preparation artifact has NO V2 AppRoot fallback.
  // Only authenticated, explicit preflight/private-staging operations exist.
  void import("./ui/system/V3MigrationLab").then(({ V3MigrationLab }) => {
    root.render(<React.StrictMode><AccessGate><V3MigrationLab /></AccessGate></React.StrictMode>);
  });
} else if (v3Preview) {
  // Independent design laboratory; intentionally never touches user login,
  // IndexedDB, cloud sync or the production application state.
  void import("./ui/system/V3Preview").then(({ V3Preview }) => {
    root.render(<React.StrictMode><V3Preview /></React.StrictMode>);
  });
} else if (v3RealWorkspace) {
  // Real-account V3 workspace remains an explicit opt-in preview route.
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

if ("serviceWorker" in navigator && import.meta.env.PROD && !migrationLab) {
  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL || "./";
    navigator.serviceWorker.register(`${base}sw.js`).catch(() => undefined);
  });
}
