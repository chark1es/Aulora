import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyTheme, readThemePreference } from "./lib/theme";
import { router } from "./router";
import "./styles/globals.css";

applyTheme(readThemePreference());

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Aulora web: missing #root element.");
}

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
