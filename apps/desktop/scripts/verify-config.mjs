// Validates the Tauri configuration without a Rust toolchain: required fields,
// the no-remote-code CSP posture, the deep-link scheme and the platform
// overrides. Run `bun run verify`. This is a structural check, not a schema
// validator; `tauri build` in CI is the final authority.

import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const srcTauri = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri");

const failures = [];

function readJson(relative) {
  const path = resolve(srcTauri, relative);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    failures.push(`${relative}: not valid JSON (${error.message})`);
    return null;
  }
}

function check(label, condition) {
  if (!condition) {
    failures.push(label);
  }
}

function parseCsp(csp) {
  const directives = new Map();
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length > 0) {
      directives.set(tokens[0], tokens.slice(1));
    }
  }
  return directives;
}

const config = readJson("tauri.conf.json");
if (config !== null) {
  check("productName must be Aulora", config.productName === "Aulora");
  check("identifier must be dev.spwnd.aulora", config.identifier === "dev.spwnd.aulora");
  check(
    "frontendDist must point at the web build",
    typeof config.build?.frontendDist === "string" &&
      config.build.frontendDist.endsWith("web/dist"),
  );
  check(
    "beforeBuildCommand must build @aulora/web",
    /@aulora\/web build/.test(config.build?.beforeBuildCommand ?? ""),
  );
  check("withGlobalTauri must be enabled", config.app?.withGlobalTauri === true);
  check("windows[0] must be the main window", config.app?.windows?.[0]?.label === "main");
  check(
    "windows[0] must set dragDropEnabled to false so the app-wide web file drop reaches the webview",
    config.app?.windows?.[0]?.dragDropEnabled === false,
  );

  const csp = config.app?.security?.csp;
  check("a CSP string must be set", typeof csp === "string");
  if (typeof csp === "string") {
    const directives = parseCsp(csp);
    const scriptSrc = directives.get("script-src") ?? [];
    check("script-src must be restricted to 'self'", scriptSrc.join(" ") === "'self'");
    check(
      "script-src must not allow remote origins or eval",
      !scriptSrc.some((token) => /https?:|unsafe-eval|\*/.test(token)),
    );
    check("object-src must be 'none'", (directives.get("object-src") ?? []).includes("'none'"));
    const connectSrc = (directives.get("connect-src") ?? []).join(" ");
    check("connect-src must allow ipc: for commands", connectSrc.includes("ipc:"));
    check(
      "connect-src must allow http://ipc.localhost for Windows IPC",
      connectSrc.includes("http://ipc.localhost"),
    );
  }

  check(
    "deep-link scheme must be aulora",
    (config.plugins?.["deep-link"]?.desktop?.schemes ?? []).includes("aulora"),
  );

  const updater = config.plugins?.updater;
  const pubkey = updater?.pubkey;
  check("updater pubkey must be embedded", typeof pubkey === "string" && pubkey.length > 0);
  if (typeof pubkey === "string") {
    check(
      "updater pubkey must not be a file path",
      !pubkey.includes("/") && !pubkey.includes("\\"),
    );
    let decoded = "";
    try {
      decoded = Buffer.from(pubkey, "base64").toString("utf8");
    } catch {
      decoded = "";
    }
    check(
      "updater pubkey must be the base64 minisign public key",
      decoded.includes("untrusted comment: minisign public key:") && /\nRW/.test(decoded),
    );
  }
  check(
    "updater endpoint must be the GitHub latest.json feed",
    (updater?.endpoints ?? []).includes(
      "https://github.com/chark1es/Aulora/releases/latest/download/latest.json",
    ),
  );
  check(
    "default bundles must not require the updater signing key",
    config.bundle?.createUpdaterArtifacts !== true,
  );

  const icons = config.bundle?.icon ?? [];
  check(
    "bundle.icon must reference .icns and .ico",
    icons.some((i) => i.endsWith(".icns")) && icons.some((i) => i.endsWith(".ico")),
  );
}

const macos = readJson("tauri.macos.conf.json");
if (macos !== null) {
  const window = macos.app?.windows?.[0];
  check("macOS window must be transparent for vibrancy", window?.transparent === true);
  check("macOS window must use the overlay title bar", window?.titleBarStyle === "Overlay");
  check(
    "macOS window must set dragDropEnabled to false so the app-wide web file drop reaches the webview",
    window?.dragDropEnabled === false,
  );
  check(
    "macOS bundles must be app + dmg",
    JSON.stringify(macos.bundle?.targets) === JSON.stringify(["app", "dmg"]),
  );
}

const windows = readJson("tauri.windows.conf.json");
if (windows !== null) {
  check(
    "Windows bundle target must be nsis",
    JSON.stringify(windows.bundle?.targets) === JSON.stringify(["nsis"]),
  );
}

const linux = readJson("tauri.linux.conf.json");
if (linux !== null) {
  check(
    "Linux bundle target must be deb",
    JSON.stringify(linux.bundle?.targets) === JSON.stringify(["deb"]),
  );
}

const release = readJson("tauri.release.conf.json");
if (release !== null) {
  check(
    "release bundles must create updater artifacts",
    release.bundle?.createUpdaterArtifacts === true,
  );
}

const capabilities = readJson("capabilities/default.json");
if (capabilities !== null) {
  check(
    "capability must target the main window",
    JSON.stringify(capabilities.windows) === JSON.stringify(["main"]),
  );
  check(
    "capability must grant core:default",
    Array.isArray(capabilities.permissions) && capabilities.permissions.includes("core:default"),
  );
}

if (failures.length > 0) {
  process.stderr.write(`desktop config verification failed (${failures.length}):\n`);
  for (const failure of failures) {
    process.stderr.write(`  - ${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write("desktop config verification passed\n");
