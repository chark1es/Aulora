import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CallPipWindow } from "./components/voice/CallPipWindow";
import { isPipWindowLocation } from "./lib/call-pip";
import { applyTheme, readThemePreference } from "./lib/theme";
import { router } from "./router";
import "./styles/globals.css";

applyTheme(readThemePreference());

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Aulora web: missing #root element.");
}

// The desktop shell opens its call picture-in-picture window on the same bundle
// at the `#pip` entry (see `pip_window.rs`). That window has no workspace, no
// connection and no router: it only draws what the main window sends it.
createRoot(container).render(
  <StrictMode>
    {isPipWindowLocation(window.location) ? <CallPipWindow /> : <RouterProvider router={router} />}
  </StrictMode>,
);
