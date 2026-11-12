import { debugLog, installDebugConsole } from "@aulora/core";

installDebugConsole();
window.addEventListener("error", (event) => {
  debugLog.record("window.error", event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  debugLog.record("unhandledrejection", event.reason);
});
