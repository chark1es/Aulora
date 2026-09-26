// Apply the persisted theme before first paint to avoid a flash. This lives in
// its own file (not inline) so the desktop shell can ship a strict
// `script-src 'self'` CSP with no inline scripts.
(() => {
  var stored;
  var pref;
  var dark;
  try {
    stored = window.localStorage.getItem("aulora.theme.v1");
    pref = stored === "dark" || stored === "light" ? stored : "system";
    dark =
      pref === "dark" ||
      (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch {
    document.documentElement.classList.add("dark");
  }
})();
