// Shared by Expo config and CI. Hash committed native inputs, never generated
// signing files or the platform configuration rewritten during a release.
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { resolve } = require("node:path");

const root = resolve(__dirname, "../..");
const inputs = [
  "bun.lock",
  "apps/mobile/package.json",
  "apps/mobile/app.json",
  "apps/mobile/app.config.js",
  "apps/mobile/android",
  "apps/mobile/ios",
  "apps/mobile/plugins",
  "apps/mobile/assets/icon.png",
  "scripts/ci/mobile-ota.cjs",
];

function nativeRuntime(ref = "HEAD") {
  const tree = execFileSync("git", ["ls-tree", "-r", "-z", ref, "--", ...inputs], {
    cwd: root,
  });
  if (!tree.length) throw new Error("No committed mobile native inputs");
  return `mobile-${createHash("sha256").update(tree).digest("hex")}`;
}

function updateConfig(projectId, runtimeVersion) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId ?? "")) {
    throw new Error("Set EAS_PROJECT_ID to the Expo project's UUID");
  }
  return {
    runtimeVersion,
    updates: {
      enabled: true,
      url: `https://u.expo.dev/${projectId}`,
      checkAutomatically: "ON_LOAD",
      fallbackToCacheTimeout: 0,
      requestHeaders: { "expo-channel-name": "production" },
    },
    projectId,
  };
}

function assertCompatible(base, head) {
  if (base !== head) throw new Error("Native inputs changed; publish a full mobile release first");
}

function assertInstalledRuntime(base, expected) {
  if (
    !base.enabled ||
    !expected.enabled ||
    ["projectId", "runtimeVersion", "channel"].some((key) => base[key] !== expected[key])
  ) {
    throw new Error(
      "The base release must include OTA enabled for this project and native runtime",
    );
  }
}

module.exports = { nativeRuntime, updateConfig, assertCompatible, assertInstalledRuntime };

if (require.main === module) {
  const runtime = nativeRuntime();
  if (process.argv[2] === "check") {
    const ref = process.env.OTA_BASE_TAG;
    if (!/^v\d+\.\d+\.\d+$/.test(ref ?? "")) throw new Error("Expected a stable OTA_BASE_TAG");
    assertCompatible(nativeRuntime(`refs/tags/${ref}`), runtime);
    updateConfig(process.env.EAS_PROJECT_ID, runtime);
  }
  console.log(runtime);
}
