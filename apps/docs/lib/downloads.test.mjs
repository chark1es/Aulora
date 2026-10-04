import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assetFor,
  detectFromHints,
  isReleaseAssetUrl,
  pickDownloads,
  primaryCopy,
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

test("pickDownloads keeps one GitHub asset per platform and drops other hosts", () => {
  const picked = pickDownloads(assets);
  assert.equal(picked.get("windows").name, "Aulora_1.0.0_x64-setup.exe");
  assert.equal(picked.get("macosArm").name, "Aulora_1.0.0_aarch64.dmg");
  assert.equal(picked.get("macosIntel").name, "Aulora_1.0.0_x64.dmg");
  assert.equal(picked.get("android").name, "Aulora_1.0.0_android.apk");
  assert.equal(picked.get("ios").name, "Aulora_1.0.0_ios.ipa");
  assert.match(picked.get("linux").name, /AppImage$/);
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
  assert.equal(primaryCopy("ios").beta, true);
  assert.equal(primaryCopy("android").beta, true);
  assert.equal(primaryCopy("macos").beta, false);
  assert.match(statusLine("ios", "arm", "v1.0.0"), /TestFlight/);
  assert.equal(assetFor(picked, "macos", "x64")?.name, "Aulora_1.0.0_x64.dmg");
  assert.equal(assetFor(picked, "macos", "arm")?.name, "Aulora_1.0.0_aarch64.dmg");
});
