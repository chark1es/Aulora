import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
// Every current source guide participates, including newly added untracked guides.
// Historical investigations preserve obsolete paths and are indexed by their README.
const docs = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\0")
  .filter((file) => file.endsWith(".md") && existsSync(resolve(root, file)))
  .filter((file) => !file.startsWith("docs/archive/") || file === "docs/archive/README.md")
  .filter((file) => !/^spikes\/.*(?:REPORT|PHASE-.*)\.md$/.test(file));

function headings(source) {
  return new Set(
    [...source.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) =>
      match[1]
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
    ),
  );
}
function checkLink(file, href, generated = false) {
  if (/^[a-z]+:/i.test(href) || href.startsWith("//")) return;
  const [target, anchor] = href.split("#");
  let path;
  if (!generated && file.startsWith("apps/docs/content/") && target.startsWith("legal/")) {
    path = resolve(root, target.slice(6));
  } else {
    path = resolve(root, dirname(file), target || file.split("/").at(-1));
  }
  if (generated) {
    // Generated links are clean (no `.html`). The files on disk keep the
    // extension, and a clean directory path is served by its `index.html`.
    path =
      [path, `${path}.html`, resolve(path, "index.html")].find(
        (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
      ) ?? path;
  }
  if (!existsSync(path) || !statSync(path).isFile()) {
    failures.push(`${file}: missing target ${href}`);
    return;
  }
  if (anchor && /\.(md|html)$/.test(path)) {
    const source = readFileSync(path, "utf8");
    const found = generated
      ? source.includes(`id="${anchor}"`)
      : headings(source.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "")).has(anchor);
    if (!found) failures.push(`${file}: missing anchor ${href}`);
  }
}
for (const file of docs) {
  const source = readFileSync(resolve(root, file), "utf8").replace(
    /^```[^\n]*\n[\s\S]*?^```\s*$/gm,
    "",
  );
  for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    checkLink(file, match[1]);
  }
}
function checkHtml(directory) {
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) checkHtml(file);
    else if (file.endsWith(".html")) {
      for (const match of readFileSync(resolve(root, file), "utf8").matchAll(
        /(?:href|src)="([^"]+)"/g,
      )) {
        checkLink(file, match[1].replaceAll("&amp;", "&"), true);
      }
    }
  }
}
if (!existsSync(resolve(root, "apps/docs/dist/index.html"))) {
  failures.push("Build the docs before checking links: bun run docs:build");
} else checkHtml("apps/docs/dist");
if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else console.log(`Checked ${docs.length} public guides and all generated documentation links.`);
