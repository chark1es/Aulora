import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateVersion } from "../apps/desktop/scripts/release-version.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const json = (path) => JSON.parse(read(path));
const failures = [];
function check(label, condition) {
  if (!condition) failures.push(label);
}
const version = validateVersion(json("apps/desktop/src-tauri/tauri.conf.json").version);
const license = "PolyForm-Noncommercial-1.0.0";
const manifests = ["package.json", "infra/push-relay/package.json"];
for (const parent of ["apps", "packages"]) {
  for (const entry of readdirSync(resolve(root, parent), { withFileTypes: true })) {
    if (entry.isDirectory()) manifests.push(`${parent}/${entry.name}/package.json`);
  }
}
for (const path of manifests) {
  const value = json(path);
  check(`${path}: missing source license identifier`, value.license === license);
}
// Package versions before v1 are historical. From v1 onward every distributable
// and workspace version must agree with the release source of truth.
if (Number(version.split(".")[0]) >= 1) {
  for (const path of manifests)
    check(`${path}: version differs from ${version}`, json(path).version === version);
  check("Mobile version differs", json("apps/mobile/app.json").expo.version === version);
  check(
    "Backend version differs",
    read("packages/convex/convex/lib/env.ts").includes(
      `export const AULORA_VERSION = "${version}";`,
    ),
  );
  check(
    "Cargo version differs",
    read("apps/desktop/src-tauri/Cargo.toml").includes(`version = "${version}"`),
  );
  check(
    "iOS version differs",
    new RegExp(
      `<key>CFBundleShortVersionString</key>\\s*<string>${version.replaceAll(".", "\\.")}</string>`,
    ).test(read("apps/mobile/ios/Aulora/Info.plist")),
  );
  check(
    "Web example version differs",
    read("apps/web/.env.example").includes(`AULORA_VERSION=${version}`),
  );
}
for (const path of [
  "LICENSE",
  "NOTICE",
  "COMMERCIAL.md",
  "CLA.md",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md",
]) {
  check(`Missing ${path}`, existsSync(resolve(root, path)));
}
for (const path of ["COMMERCIAL.md", "CLA.md"]) {
  check(
    `${path}: unfinished placeholder`,
    !/status:\s*stub|short-form placeholder/i.test(read(path)),
  );
}
check("Required copyright notice is missing", /^Required Notice: Copyright /m.test(read("NOTICE")));
check(
  "Backup exports must include uploaded files",
  read("infra/docker/backup/backup.sh").includes("convex export --include-file-storage"),
);
check(
  "Docker context must exclude private credentials",
  read(".dockerignore").includes("**/.secrets"),
);
if (existsSync(resolve(root, ".git"))) {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split(
    "\0",
  );
  for (const path of tracked) {
    if (
      !path ||
      path === "apps/mobile/android/app/debug.keystore" ||
      path.endsWith(".env.example") ||
      path.endsWith("/.xcode.env")
    )
      continue;
    const sensitive =
      /(^|\/)\.secrets\//.test(path) ||
      /(^|\/)\.env($|\.)/.test(path) ||
      /\.(p8|p12|pfx|jks|keystore|mobileprovision|provisionprofile)$/.test(path) ||
      /(^|\/)(google-services\.json|GoogleService-Info\.plist|credentials\.json)$/.test(path) ||
      /(?:service-account|firebase-adminsdk).*\.json$/.test(path);
    check(`Sensitive file is tracked: ${path}`, !sensitive);
  }
}
if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else
  console.log(
    `Release metadata and source-distribution checks passed for ${version}. Native builds and publication checks are separate.`,
  );
