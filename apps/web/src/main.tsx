import { webLocalStorageStore } from "@aulora/core";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CallPipWindow } from "./components/voice/CallPipWindow";
import { isPipWindowLocation } from "./lib/call-pip";
import { completeAuthHandoffFromLocation } from "./lib/oauth-start";
import { logBoot } from "./lib/remount-debug";
import { applyTheme, readThemePreference } from "./lib/theme";
import { router } from "./router";
import "./styles/globals.css";

applyTheme(readThemePreference());

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Aulora web: missing #root element.");
}
const root = container;

// The desktop shell opens its call picture-in-picture window on the same bundle
// at the `#pip` entry (see `pip_window.rs`). That window has no workspace, no
// connection and no router: it only draws what the main window sends it.
const pip = isPipWindowLocation(window.location);

// Opt-in (`aulora.debug.remount`): records the document boot, its navigation
// type and a session-scoped boot count, so a real page reload is distinguishable
// from a React remount logged by the session surfaces.
logBoot(pip ? "pip" : "web");

function render() {
  createRoot(root).render(
    <StrictMode>{pip ? <CallPipWindow /> : <RouterProvider router={router} />}</StrictMode>,
  );
}

// An OAuth finish redirect stores the bearer token before the router mounts, so
// the session query sees it on its first read instead of racing a reload.
if (pip) {
  render();
} else {
  void (async () => {
    const active = await webLocalStorageStore()
      .getActive()
      .catch(() => undefined);
    await completeAuthHandoffFromLocation(undefined, active?.siteUrl);
  })().finally(render);
}
