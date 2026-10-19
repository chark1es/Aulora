// Platform detection and GitHub release asset matching for the download buttons.
// Pure helpers are covered by node:test. The page script supplies navigator and fetch.

const ASSET_PREFIX = "/chark1es/Aulora/releases/download/";

/** The public TestFlight invitation for the iOS beta. */
export const IOS_TESTFLIGHT_URL = "https://testflight.apple.com/join/YUp4ugyv";

/** Android beta testers must join this group before the Play Store listing opens. */
export const ANDROID_TESTERS_URL = "https://groups.google.com/g/aulora-testing";

/** The Play Store listing for the Android beta. */
export const ANDROID_PLAY_URL = "https://play.google.com/store/apps/details?id=dev.spwnd.aulora";

// Mobile betas are distributed through TestFlight and Google Play, not as
// release assets, so only desktop files are matched here.
const RULES = [
  ["windows", (name) => /_x64-setup\.exe$/i.test(name)],
  ["macosArm", (name) => /\.dmg$/i.test(name) && /aarch64|arm64/i.test(name)],
  ["macosIntel", (name) => /\.dmg$/i.test(name) && /(x86_64|_x64)\.dmg$/i.test(name)],
  ["linux", (name) => /\.AppImage$/i.test(name)],
];

export function isReleaseAssetUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "github.com" &&
      parsed.pathname.startsWith(ASSET_PREFIX)
    );
  } catch {
    return false;
  }
}

export function pickDownloads(assets) {
  const picked = new Map();
  for (const asset of assets ?? []) {
    if (!asset?.name || !isReleaseAssetUrl(asset.browser_download_url ?? asset.url ?? "")) {
      continue;
    }
    const url = asset.browser_download_url ?? asset.url;
    for (const [key, test] of RULES) {
      if (!picked.has(key) && test(asset.name)) {
        picked.set(key, { name: asset.name, url });
      }
    }
  }
  return picked;
}

export function detectFromHints({ ua = "", platform = "", touchPoints = 0, architecture = "" }) {
  let os = "unknown";
  if (/android/i.test(ua)) os = "android";
  else if (/iPhone|iPad|iPod/i.test(ua) || (platform === "MacIntel" && touchPoints > 1)) os = "ios";
  else if (/Win/i.test(platform) || /Windows/i.test(ua)) os = "windows";
  else if (/Mac/i.test(platform) || /Macintosh/i.test(ua)) os = "macos";
  else if (/Linux/i.test(platform) || /Linux/i.test(ua)) os = "linux";

  let arch = "unknown";
  if (/arm/i.test(architecture)) arch = "arm";
  else if (/x86|x64|amd64/i.test(architecture)) arch = "x64";
  if (os === "macos" && arch === "unknown") arch = "arm";
  return { os, arch };
}

export function primaryCopy(os) {
  switch (os) {
    case "macos":
      return { label: "Download for macOS", beta: false };
    case "windows":
      return { label: "Download for Windows", beta: false };
    case "ios":
      return { label: "Join the iOS beta", beta: true };
    case "android":
      return { label: "Join the Android beta", beta: true };
    case "linux":
      return { label: "Download for Linux", beta: false };
    default:
      return { label: "Download the app", beta: false };
  }
}

export function assetFor(picks, key, arch) {
  if (key === "macos") {
    if (arch === "intel" || arch === "x64") return picks.get("macosIntel");
    if (arch === "arm") return picks.get("macosArm");
    return picks.get("macosArm") ?? picks.get("macosIntel");
  }
  if (key === "windows") return picks.get("windows");
  if (key === "linux") return picks.get("linux");
  return undefined;
}

export function statusLine(os, arch, version) {
  const prefix = version ? `${version}. ` : "";
  switch (os) {
    case "macos":
      return `${prefix}${arch === "x64" ? "Intel disk image." : "Apple silicon disk image."}`;
    case "windows":
      return `${prefix}Windows installer. It is unsigned, so the first launch may warn you.`;
    case "ios":
      return `${prefix}iOS is in beta. The button opens the TestFlight invitation.`;
    case "android":
      return `${prefix}Android is in beta. Join the testers group, then install from Google Play.`;
    case "linux":
      return `${prefix}Linux AppImage.`;
    default:
      return `${prefix}iOS and Android are in beta.`;
  }
}

export async function detectClient() {
  const ua = navigator.userAgent ?? "";
  const platform = navigator.userAgentData?.platform || navigator.platform || "";
  let architecture = "";
  try {
    const hints = await navigator.userAgentData?.getHighEntropyValues?.(["architecture"]);
    architecture = hints?.architecture ?? "";
  } catch {
    architecture = "";
  }
  return detectFromHints({
    ua,
    platform,
    touchPoints: navigator.maxTouchPoints ?? 0,
    architecture,
  });
}

/**
 * Static release manifests, tried in order. The release workflow already emits
 * `latest.json` (same shape as `apps/desktop/scripts/release-manifest.mjs`) and
 * publishes it both as a release asset and, optionally, on the docs origin.
 * These are plain files, so they avoid the unauthenticated GitHub API, which
 * rate-limits per IP.
 */
export const STATIC_MANIFEST_URLS = [
  "/downloads/latest.json",
  "https://github.com/chark1es/Aulora/releases/latest/download/latest.json",
];

/**
 * Converts a release manifest into the `{ tag_name, assets }` shape the buttons
 * use. Prefers an explicit installer list (`assets`); falls back to the updater
 * `platforms` URLs. Returns `null` when the manifest carries no usable files.
 */
export function releaseFromManifest(manifest) {
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    return null;
  }
  const version = typeof manifest.version === "string" ? manifest.version : "";
  const assets = [];
  if (Array.isArray(manifest.assets)) {
    for (const asset of manifest.assets) {
      const name = typeof asset?.name === "string" ? asset.name : "";
      const url = asset?.browser_download_url ?? asset?.url;
      if (name.length > 0 && typeof url === "string" && url.length > 0) {
        assets.push({ name, browser_download_url: url });
      }
    }
  }
  if (
    assets.length === 0 &&
    typeof manifest.platforms === "object" &&
    manifest.platforms !== null
  ) {
    for (const entry of Object.values(manifest.platforms)) {
      const url = typeof entry?.url === "string" ? entry.url : "";
      if (url.length === 0) continue;
      const name = url.split("/").pop() ?? "";
      if (name.length > 0) assets.push({ name, browser_download_url: url });
    }
  }
  if (assets.length === 0) return null;
  const tag = version.length === 0 ? "" : version.startsWith("v") ? version : `v${version}`;
  return { tag_name: tag, assets };
}

/** The GitHub API release, used when the static manifest is unavailable. */
async function loadGithubRelease(fetchImpl) {
  const response = await fetchImpl("https://api.github.com/repos/chark1es/Aulora/releases/latest", {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) return null;
  const data = await response.json();
  return {
    tag_name: typeof data.tag_name === "string" ? data.tag_name : "",
    assets: Array.isArray(data.assets)
      ? data.assets.map((asset) => ({
          name: asset.name,
          browser_download_url: asset.browser_download_url,
        }))
      : [],
  };
}

export async function loadRelease(
  fetchImpl = globalThis.fetch,
  storage = globalThis.sessionStorage,
) {
  const cacheKey = "aulora-release-v1";
  try {
    const cached = storage?.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && Date.now() - parsed.at < 60 * 60 * 1000 && parsed.data) return parsed.data;
    }
  } catch {
    // Ignore a broken cache and fetch again.
  }
  // Prefer a static manifest; any failure falls back to the GitHub API.
  let release = null;
  for (const url of STATIC_MANIFEST_URLS) {
    try {
      const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
      if (response?.ok) {
        const manifest = await response.json();
        // Legacy updater manifests only list `platforms` (update archives);
        // they cannot satisfy direct installer selectors such as the macOS
        // `.dmg`, so fall through to the GitHub API instead of suppressing it.
        if (Array.isArray(manifest?.assets)) {
          release = releaseFromManifest(manifest);
        }
      }
    } catch {
      release = null;
    }
    if (release !== null) break;
  }
  if (release === null) {
    release = await loadGithubRelease(fetchImpl);
  }
  if (release === null) return null;
  try {
    storage?.setItem(cacheKey, JSON.stringify({ at: Date.now(), data: release }));
  } catch {
    // Private mode can reject sessionStorage. The buttons still work.
  }
  return release;
}

const SECTIONS = new Map([
  ["macos", "#macos"],
  ["windows", "#windows"],
  ["ios", "#ios"],
  ["android", "#android"],
  ["linux", "#linux"],
]);

/**
 * Where the primary button points. The mobile betas never serve a file: iOS
 * opens the TestFlight invitation and Android opens the testers group, which is
 * the step before the Play Store listing becomes available.
 */
function destination(primary, os, asset) {
  if (os === "ios") return IOS_TESTFLIGHT_URL;
  if (os === "android") return ANDROID_TESTERS_URL;
  if (asset) return asset.url;
  const authored = primary.getAttribute("href") || "install";
  const section = SECTIONS.get(os);
  if (!section) return authored;
  if (authored.startsWith("#")) return section;
  // Old markup used `install.html#...`; the site now links `install#...`.
  if (/(^|\/)install(\.html)?(#|$)/.test(authored)) return `install${section}`;
  return authored;
}

function fillPrimary(anchor, { label, beta, href }) {
  anchor.href = href;
  anchor.replaceChildren(document.createTextNode(label));
  if (beta) {
    const mark = document.createElement("span");
    mark.className = "beta";
    mark.textContent = "Beta";
    anchor.append(mark);
  }
}

export function applyDownloads(root, client, release) {
  const picks = pickDownloads(release?.assets);
  const version = release?.tag_name ?? "";
  const copy = primaryCopy(client.os);
  const primaryAsset = assetFor(picks, client.os, client.arch);

  for (const primary of root.querySelectorAll("[data-download='primary']")) {
    fillPrimary(primary, {
      label: copy.label,
      beta: copy.beta,
      href: destination(primary, client.os, primaryAsset),
    });
  }

  for (const link of root.querySelectorAll("[data-download]")) {
    const key = link.dataset.download;
    // iOS and Android keep their authored links (TestFlight and the Play
    // Store testers group); only desktop platforms attach a release file.
    if (key === "primary" || key === "ios") continue;
    const asset = assetFor(picks, key, link.dataset.arch ?? client.arch);
    if (asset) link.href = asset.url;
    const arch = link.dataset.arch;
    const archOk =
      arch === undefined ||
      (client.arch === "x64" && (arch === "intel" || arch === "x64")) ||
      (client.arch === "arm" && arch === "arm") ||
      (client.arch !== "x64" && client.arch !== "arm" && arch === "arm");
    link.classList.toggle("is-yours", key === client.os && archOk);
  }

  for (const zone of root.querySelectorAll("[data-downloads]")) {
    if (client.os === "unknown") continue;
    const duplicate = zone.querySelector(`[data-download="${client.os}"]`);
    if (duplicate) duplicate.hidden = true;
  }

  const line = statusLine(client.os, client.arch, version);
  for (const meta of root.querySelectorAll("[data-download-meta]")) {
    meta.textContent = line;
  }
}
