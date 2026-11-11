import React from "react";
import ReactDOM from "react-dom/client";
import { V3Preview } from "./ui/system/V3Preview";
import "./ui/system/standalone.css";

// Standalone UI demo: no personal data or production application initialization.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <V3Preview />
  </React.StrictMode>,
);
