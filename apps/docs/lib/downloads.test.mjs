import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANDROID_PLAY_URL,
  ANDROID_TESTERS_URL,
  assetFor,
  detectFromHints,
  IOS_TESTFLIGHT_URL,
  isReleaseAssetUrl,
  loadRelease,
  pickDownloads,
  primaryCopy,
  releaseFromManifest,
  STATIC_MANIFEST_URLS,
  statusLine,
} from "../static/downloads.js";

const assets = [
  {
    name: "Aulora_1.0.0_aarch64.dmg",
    browser_download_url:
      "https://github.com/chark1es/Aulora/releases/download/v1.0.0/Aulora_1.0.0_aarch64.dmg",
  },
  {
    name: "Aulora_1.0.0_x64.dmg",
    browser_download_url:
      "https://github.com/chark1es/Aulora/releases/download/v1.0.0/Aulora_1.0.0_x64.dmg",
  },
  {
    name: "Aulora_1.0.0_x64-setup.exe",
    browser_download_url:
      "https://github.com/chark1es/Aulora/releases/download/v1.0.0/Aulora_1.0.0_x64-setup.exe",
  },
  {
    name: "Aulora_1.0.0_amd64.AppImage",
    browser_download_url:
      "https://github.com/chark1es/Aulora/releases/download/v1.0.0/Aulora_1.0.0_amd64.AppImage",
  },
  {
    name: "Aulora_1.0.0_android.apk",
    browser_download_url:
      "https://github.com/chark1es/Aulora/releases/download/v1.0.0/Aulora_1.0.0_android.apk",
  },
  {
    name: "Aulora_1.0.0_ios.ipa",
    browser_download_url:
      "https://github.com/chark1es/Aulora/releases/download/v1.0.0/Aulora_1.0.0_ios.ipa",
  },
  {
    name: "not-a-release.txt",
    browser_download_url: "https://example.com/Aulora_1.0.0_x64-setup.exe",
  },
];

test("pickDownloads keeps one GitHub asset per desktop platform and drops other hosts", () => {
  const picked = pickDownloads(assets);
  assert.equal(picked.get("windows").name, "Aulora_1.0.0_x64-setup.exe");
  assert.equal(picked.get("macosArm").name, "Aulora_1.0.0_aarch64.dmg");
  assert.equal(picked.get("macosIntel").name, "Aulora_1.0.0_x64.dmg");
  assert.match(picked.get("linux").name, /AppImage$/);
  assert.equal(picked.has("android"), false);
  assert.equal(picked.has("ios"), false);
  assert.equal(isReleaseAssetUrl("https://example.com/file.exe"), false);
});

test("detectFromHints distinguishes the client platforms", () => {
  assert.equal(
    detectFromHints({ ua: "Mozilla/5.0 (Windows NT 10.0)", platform: "Win32" }).os,
    "windows",
  );
  assert.deepEqual(
    detectFromHints({ ua: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", architecture: "arm" }),
    { os: "macos", arch: "arm" },
  );
  assert.equal(
    detectFromHints({ ua: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", architecture: "x86" })
      .arch,
    "x64",
  );
  assert.equal(detectFromHints({ platform: "MacIntel" }).arch, "arm");
  assert.equal(detectFromHints({ ua: "iPhone", platform: "iPhone" }).os, "ios");
  assert.equal(detectFromHints({ ua: "Mozilla/5.0 (Linux; Android 14)" }).os, "android");
  assert.equal(detectFromHints({ platform: "Linux x86_64", ua: "Linux" }).os, "linux");
  assert.equal(
    detectFromHints({ platform: "MacIntel", touchPoints: 5, ua: "Mozilla/5.0 (Macintosh)" }).os,
    "ios",
  );
});

test("iOS is a beta note, not an IPA", () => {
  const picked = pickDownloads(assets);
  assert.equal(assetFor(picked, "ios", "arm"), undefined);
  assert.equal(assetFor(picked, "android", "arm"), undefined);
  assert.equal(primaryCopy("ios").beta, true);
  assert.equal(primaryCopy("android").beta, true);
  assert.equal(primaryCopy("macos").beta, false);
  assert.equal(primaryCopy("ios").label, "Join the iOS beta");
  assert.equal(primaryCopy("android").label, "Join the Android beta");
  assert.match(statusLine("ios", "arm", "v1.0.0"), /TestFlight/);
  assert.match(statusLine("android", "arm", "v1.0.0"), /Google Play/);
  assert.equal(assetFor(picked, "macos", "x64")?.name, "Aulora_1.0.0_x64.dmg");
  assert.equal(assetFor(picked, "macos", "arm")?.name, "Aulora_1.0.0_aarch64.dmg");
});

test("mobile betas point at TestFlight and the Play Store testers group", () => {
  assert.equal(IOS_TESTFLIGHT_URL, "https://testflight.apple.com/join/YUp4ugyv");
  assert.equal(ANDROID_TESTERS_URL, "https://groups.google.com/g/aulora-testing");
  assert.equal(ANDROID_PLAY_URL, "https://play.google.com/store/apps/details?id=dev.spwnd.aulora");
});

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

test("releaseFromManifest converts a static manifest into button assets", () => {
  const release = releaseFromManifest({
    version: "2.0.0",
    assets: [
      {
        name: "Aulora_2.0.0_aarch64.dmg",
        browser_download_url:
          "https://github.com/chark1es/Aulora/releases/download/v2.0.0/Aulora_2.0.0_aarch64.dmg",
      },
    ],
  });
  assert.equal(release.tag_name, "v2.0.0");
  assert.equal(release.assets[0].name, "Aulora_2.0.0_aarch64.dmg");
});

test("releaseFromManifest derives assets from updater platforms", () => {
  const release = releaseFromManifest({
    version: "1.2.3",
    platforms: {
      "windows-x86_64": {
        url: "https://github.com/chark1es/Aulora/releases/download/v1.2.3/Aulora_1.2.3_x64-setup.exe",
      },
    },
  });
  assert.equal(release.tag_name, "v1.2.3");
  assert.equal(release.assets[0].name, "Aulora_1.2.3_x64-setup.exe");
});

test("releaseFromManifest rejects manifests without downloads", () => {
  assert.equal(releaseFromManifest(null), null);
  assert.equal(releaseFromManifest({ version: "1.0.0" }), null);
  assert.equal(releaseFromManifest({ version: "1.0.0", assets: [] }), null);
});

test("loadRelease prefers the static docs manifest and skips the API", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return new Response(
      JSON.stringify({
        version: "2.0.0",
        assets: [
          {
            name: "Aulora_2.0.0_aarch64.dmg",
            browser_download_url:
              "https://github.com/chark1es/Aulora/releases/download/v2.0.0/Aulora_2.0.0_aarch64.dmg",
          },
        ],
      }),
      { status: 200 },
    );
  };
  const release = await loadRelease(fetchImpl, fakeStorage());
  assert.equal(release.tag_name, "v2.0.0");
  assert.equal(release.assets.length, 1);
  assert.deepEqual(calls, [STATIC_MANIFEST_URLS[0]]);
});

test("loadRelease falls back to the GitHub API when no static manifest exists", async () => {
  const fetchImpl = async (url) => {
    if (STATIC_MANIFEST_URLS.includes(String(url))) {
      return new Response("not found", { status: 404 });
    }
    return new Response(
      JSON.stringify({
        tag_name: "v3.0.0",
        assets: [
          {
            name: "Aulora_3.0.0_x64-setup.exe",
            browser_download_url:
              "https://github.com/chark1es/Aulora/releases/download/v3.0.0/Aulora_3.0.0_x64-setup.exe",
          },
        ],
      }),
      { status: 200 },
    );
  };
  const release = await loadRelease(fetchImpl, fakeStorage());
  assert.equal(release.tag_name, "v3.0.0");
  assert.equal(release.assets[0].name, "Aulora_3.0.0_x64-setup.exe");
});

test("loadRelease serves a fresh session cache without fetching", async () => {
  const cached = {
    tag_name: "v1.0.0",
    assets: [
      {
        name: "Aulora_1.0.0_x64.dmg",
        browser_download_url:
          "https://github.com/chark1es/Aulora/releases/download/v1.0.0/Aulora_1.0.0_x64.dmg",
      },
    ],
  };
  const storage = fakeStorage({
    "aulora-release-v1": JSON.stringify({ at: Date.now(), data: cached }),
  });
  let fetched = false;
  const release = await loadRelease(async () => {
    fetched = true;
    return new Response("", { status: 200 });
  }, storage);
  assert.deepEqual(release, cached);
  assert.equal(fetched, false);
});
