import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist/legal");
mkdirSync(output, { recursive: true });
for (const file of ["LICENSE", "NOTICE", "COMMERCIAL.md", "THIRD_PARTY_NOTICES.md"]) {
  cpSync(resolve(root, file), resolve(output, file));
}
if (existsSync(resolve(root, "licenses"))) {
  cpSync(resolve(root, "licenses"), resolve(output, "third-party"), { recursive: true });
}
const seen = new Set();
const packages = new Map();
function inspect(path) {
  // A reused local install can contain links to workspaces removed from Git.
  if (!existsSync(path)) return;
  const real = realpathSync(path);
  if (seen.has(real)) return;
  seen.add(real);
  const manifest = resolve(real, "package.json");
  if (!existsSync(manifest)) return;
  const value = JSON.parse(readFileSync(manifest, "utf8"));
  if (!value.name || value.name.startsWith("@aulora/")) return;
  const texts = readdirSync(real, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && /^(licen[sc]e|copying|notice|copyright)([._-]|$)/i.test(entry.name),
    )
    .map((entry) => `--- ${entry.name} ---\n${readFileSync(resolve(real, entry.name), "utf8")}`);
  const declared =
    typeof value.license === "string"
      ? value.license
      : (value.license?.type ??
        value.licenses?.map((item) => item.type).join(" OR ") ??
        "NOT DECLARED");
  packages.set(`${value.name}@${value.version}`, {
    name: value.name,
    version: value.version,
    license: declared,
    texts,
  });
  scan(resolve(real, "node_modules"));
}
function scan(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = resolve(directory, entry.name);
    if (entry.name.startsWith("@")) {
      for (const child of readdirSync(path)) inspect(resolve(path, child));
    } else if (entry.isDirectory() || entry.isSymbolicLink()) inspect(path);
  }
}
scan(resolve(root, "node_modules"));
const store = resolve(root, "node_modules/.bun");
if (existsSync(store)) {
  for (const entry of readdirSync(store)) scan(resolve(store, entry, "node_modules"));
}
for (const parent of ["apps", "packages", "infra"]) {
  if (!existsSync(resolve(root, parent))) continue;
  for (const entry of readdirSync(resolve(root, parent), { withFileTypes: true })) {
    if (entry.isDirectory()) scan(resolve(root, parent, entry.name, "node_modules"));
  }
}
if (!packages.size)
  throw new Error("No installed dependencies found. Run bun install --frozen-lockfile first.");
const entries = [...packages.values()].sort((a, b) =>
  `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
);
const missing = entries.filter((entry) => !entry.texts.length || entry.license === "NOT DECLARED");
writeFileSync(
  resolve(output, "THIRD_PARTY_JAVASCRIPT.txt"),
  "Aulora installed JavaScript dependency notices\nIncludes runtime dependencies and build tools. Native dependencies are separate.\n\n" +
    entries
      .map(
        (entry) =>
          `====================\n${entry.name}@${entry.version}\nDeclared license: ${entry.license}\n\n${entry.texts.join("\n\n") || "No license text included in the installed package. Review upstream before distribution."}\n`,
      )
      .join("\n"),
);
writeFileSync(
  resolve(output, "review-required.json"),
  `${JSON.stringify(
    missing.map(({ name, version, license }) => ({ name, version, license })),
    null,
    2,
  )}\n`,
);
console.log(
  `Wrote notices for ${entries.length} installed packages to dist/legal; ${missing.length} need upstream license review.`,
);
if (process.argv.includes("--web")) {
  const destination = resolve(root, "apps/web/dist/legal");
  mkdirSync(destination, { recursive: true });
  cpSync(output, destination, { recursive: true });
}
if (process.argv.includes("--mobile")) {
  for (const path of [
    "apps/mobile/android/app/src/main/assets/legal",
    "apps/mobile/ios/Aulora/Legal",
  ]) {
    const destination = resolve(root, path);
    mkdirSync(destination, { recursive: true });
    cpSync(output, destination, { recursive: true });
  }
}
