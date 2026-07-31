import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AccessGate } from "./access";
import "./styles.css";
import "./ui-consistency.css";
import "./access.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AccessGate>
      <App />
    </AccessGate>
  </React.StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL || "./";
    navigator.serviceWorker.register(`${base}sw.js`).catch(() => undefined);
  });
}
