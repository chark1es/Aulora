import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateVersion } from "../../apps/desktop/scripts/release-version.mjs";

export const versionPath = "apps/desktop/src-tauri/tauri.conf.json";

export function releasePlan({
  eventName,
  ref,
  version,
  previousVersion,
  alreadyReleased,
  publish,
  autoPublish = true,
}) {
  validateVersion(version);
  if (ref !== "refs/heads/main") throw new Error("Releases must build main.");
  if (eventName === "push" && previousVersion && previousVersion !== version) {
    const previous = validateVersion(previousVersion).split(".").map(Number);
    const current = version.split(".").map(Number);
    const different = current.findIndex((part, index) => part !== previous.at(index));
    if (different === -1 || current.at(different) < previous.at(different))
      throw new Error("Release versions must increase.");
  }
  if (eventName === "workflow_dispatch" && publish && alreadyReleased) {
    throw new Error("This version is already published. Increase the version before publishing.");
  }
  return {
    version,
    build: eventName === "workflow_dispatch" || (previousVersion !== version && !alreadyReleased),
    publish: (eventName === "push" && autoPublish) || publish === true,
  };
}

export function mobileVersion(version, buildNumber) {
  validateVersion(version);
  const number = Number(buildNumber);
  if (!Number.isSafeInteger(number) || number < 1 || number > 2100000000)
    throw new Error("Build number must be a positive Android-compatible integer.");
  return { version, buildNumber: number };
}

function main() {
  const command = process.argv[2];
  const version = JSON.parse(readFileSync(versionPath, "utf8")).version;
  if (command === "mobile") {
    const release = mobileVersion(process.env.RELEASE_VERSION, process.env.BUILD_NUMBER);
    const path = "apps/mobile/app.json";
    const config = JSON.parse(readFileSync(path, "utf8"));
    config.expo.version = release.version;
    config.expo.ios.buildNumber = String(release.buildNumber);
    config.expo.android.versionCode = release.buildNumber;
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
    return;
  }
  if (command !== "plan") throw new Error("Use plan or mobile.");
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  let previousVersion;
  if (process.env.GITHUB_EVENT_NAME === "push" && !/^0+$/.test(event.before)) {
    previousVersion = JSON.parse(
      execFileSync("git", ["show", `${event.before}:${versionPath}`], { encoding: "utf8" }),
    ).version;
  }
  validateVersion(version);
  const repository = process.env.GITHUB_REPOSITORY;
  const lookup = spawnSync("gh", ["api", `repos/${repository}/releases/tags/v${version}`], {
    encoding: "utf8",
  });
  if (lookup.status !== 0 && !lookup.stderr.includes("HTTP 404"))
    throw new Error("Cannot check the existing GitHub release.");
  const tag = spawnSync("git", ["rev-parse", "--verify", `refs/tags/v${version}^{commit}`], {
    encoding: "utf8",
  });
  if (tag.status === 0 && tag.stdout.trim() !== process.env.GITHUB_SHA)
    throw new Error("The release tag already points to a different commit.");
  const plan = releasePlan({
    eventName: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    version,
    previousVersion,
    alreadyReleased: lookup.status === 0 && !JSON.parse(lookup.stdout).draft,
    publish: event.inputs?.publish === "true" || event.inputs?.publish === true,
    autoPublish: process.env.RELEASE_AUTO_PUBLISH !== "false",
  });
  for (const [name, value] of Object.entries(plan))
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  console.log(`Version ${version}: build=${plan.build}, publish=${plan.publish}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
