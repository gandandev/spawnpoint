import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { currentSiteName } from "./lib/site-name";
import "./styles.css";

document.title = currentSiteName();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
