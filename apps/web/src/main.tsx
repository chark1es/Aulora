import { webLocalStorageStore } from "@aulora/core";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { hasAuthHandoffParams } from "./lib/auth-handoff-location";
import { isPipWindowLocation } from "./lib/call-pip";
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
// connection and no router: it only draws what the main window sends it, so its
// view loads on demand instead of shipping in the entry chunk.
const pip = isPipWindowLocation(window.location);

// Opt-in (`aulora.debug.remount`): records the document boot, its navigation
// type and a session-scoped boot count, so a real page reload is distinguishable
// from a React remount logged by the session surfaces.
logBoot(pip ? "pip" : "web");

function renderApp() {
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}

async function renderPip() {
  const { CallPipWindow } = await import("./components/voice/CallPipWindow");
  createRoot(root).render(
    <StrictMode>
      <CallPipWindow />
    </StrictMode>,
  );
}

// An OAuth finish redirect stores the bearer token before the router mounts, so
// the session query sees it on its first read instead of racing a reload. The
// handoff module (exchange, verifier and deep-link completion) is only
// downloaded when the address bar actually carries a finish redirect.
if (pip) {
  void renderPip();
} else {
  void (async () => {
    const active = await webLocalStorageStore()
      .getActive()
      .catch(() => undefined);
    if (hasAuthHandoffParams(window.location.hash, window.location.search)) {
      const { completeAuthHandoffFromLocation } = await import("./lib/oauth-start");
      await completeAuthHandoffFromLocation(undefined, active?.siteUrl);
    }
  })().finally(renderApp);
}
