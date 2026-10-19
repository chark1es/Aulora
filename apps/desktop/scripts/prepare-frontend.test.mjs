import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isExcludedDesktopAsset, prepareFrontend } from "./prepare-frontend.mjs";

test("excludes the effect assets and the duplicated legal notices", () => {
  const excluded = [
    "legal",
    "legal/LICENSE",
    "legal/third-party/foo",
    "assets/vision_wasm_internal-BWEwtLSW.wasm",
    "assets/vision_wasm_internal-CaWMRP85.js",
    "assets/vision_bundle-BpHKGcJN.js",
    "assets/selfie_segmenter_landscape-C0qNgSaC.tflite",
    "assets/rnnoise-lVVwgm0Y.wasm",
    "assets/rnnoise_simd-BsE3sPy6.wasm",
  ];
  for (const path of excluded) {
    expect(isExcludedDesktopAsset(path)).toBe(true);
  }
});

test("keeps the app shell, vendors and unrelated assets", () => {
  const kept = [
    "index.html",
    "theme-boot.js",
    "push-sw.js",
    "favicon.svg",
    "assets/index-Byphdv-Q.js",
    "assets/react-CHUBdPbd.js",
    "assets/workletProcessor-CHZrfIcS.js",
  ];
  for (const path of kept) {
    expect(isExcludedDesktopAsset(path)).toBe(false);
  }
});

test("prepareFrontend copies the shell without the excluded files", () => {
  const root = mkdtempSync(join(tmpdir(), "aulora-desktop-frontend-"));
  try {
    const source = join(root, "dist");
    const target = join(root, "dist-desktop");
    mkdirSync(join(source, "assets"), { recursive: true });
    mkdirSync(join(source, "legal"), { recursive: true });
    writeFileSync(join(source, "index.html"), "shell");
    writeFileSync(join(source, "assets", "index-abc.js"), "app");
    writeFileSync(join(source, "assets", "vision_wasm_internal-abc.wasm"), "big");
    writeFileSync(join(source, "assets", "rnnoise_simd-abc.wasm"), "big");
    writeFileSync(join(source, "legal", "LICENSE"), "legal");

    prepareFrontend({ source, target });

    expect(readdirSync(target).sort()).toEqual(["assets", "index.html"]);
    expect(readdirSync(join(target, "assets"))).toEqual(["index-abc.js"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
