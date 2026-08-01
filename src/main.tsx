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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ExperienceThemeProvider>
      <AccessGate>
        <App />
      </AccessGate>
    </ExperienceThemeProvider>
  </React.StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL || "./";
    navigator.serviceWorker.register(`${base}sw.js`).catch(() => undefined);
  });
}
