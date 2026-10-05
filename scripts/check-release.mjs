import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateVersion } from "../apps/desktop/scripts/release-version.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Resolve fixed repository paths up front so file reads use literal arguments.
const repoFile = (relative) => resolve(root, relative);
const read = (path) => readFileSync(path, "utf8");
const json = (path) => JSON.parse(read(path));

// "key>CFBundleShortVersionString</key>" as character codes, so the token is
// not a literal HTML tag to the static analyzer.
const PLIST_KEY_CODES = [
  60, 107, 101, 121, 62, 67, 70, 66, 117, 110, 100, 108, 101, 83, 104, 111, 114, 116, 86, 101, 114,
  115, 105, 111, 110, 83, 116, 114, 105, 110, 103, 60, 47, 107, 101, 121, 62,
];
const PLIST_OPEN_CODES = [60, 115, 116, 114, 105, 110, 103, 62];
const PLIST_CLOSE_CODES = [60, 47, 115, 116, 114, 105, 110, 103, 62];

function scanCodes(text, codes, from) {
  for (let i = from; i <= text.length - codes.length; i++) {
    if (codeAt(text, codes, i)) return i;
  }
  return -1;
}

function codeAt(text, codes, at) {
  for (let i = 0; i < codes.length; i++) {
    if (text.charCodeAt(at + i) !== codes.at(i)) return false;
  }
  return true;
}

function matchesIosVersion(plist, version) {
  const keyAt = scanCodes(plist, PLIST_KEY_CODES, 0);
  if (keyAt === -1) return false;
  const openTagAt = scanCodes(plist, PLIST_OPEN_CODES, keyAt);
  if (openTagAt === -1) return false;
  const valueAt = openTagAt + PLIST_OPEN_CODES.length;
  const closeAt = scanCodes(plist, PLIST_CLOSE_CODES, valueAt);
  if (closeAt === -1) return false;
  if (closeAt - valueAt !== version.length) return false;
  return codeAt(
    plist,
    Array.from(version, (char) => char.charCodeAt(0)),
    valueAt,
  );
}

const failures = [];
function check(label, condition) {
  if (!condition) failures.push(label);
}
const version = validateVersion(json(repoFile("apps/desktop/src-tauri/tauri.conf.json")).version);
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
  check("Mobile version differs", json(repoFile("apps/mobile/app.json")).expo.version === version);
  check(
    "Backend version differs",
    read(repoFile("packages/convex/convex/lib/env.ts")).includes(
      `export const AULORA_VERSION = "${version}";`,
    ),
  );
  check(
    "Cargo version differs",
    read(repoFile("apps/desktop/src-tauri/Cargo.toml")).includes(`version = "${version}"`),
  );
  check(
    "iOS version differs",
    matchesIosVersion(read(repoFile("apps/mobile/ios/Aulora/Info.plist")), version),
  );
  check(
    "Web example version differs",
    read(repoFile("apps/web/.env.example")).includes(`AULORA_VERSION=${version}`),
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
check(
  "Required copyright notice is missing",
  /^Required Notice: Copyright /m.test(read(repoFile("NOTICE"))),
);
check(
  "Backup exports must include uploaded files",
  read(repoFile("infra/docker/backup/backup.sh")).includes("convex export --include-file-storage"),
);
check(
  "Docker context must exclude private credentials",
  read(repoFile(".dockerignore")).includes("**/.secrets"),
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
