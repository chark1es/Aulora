// Builds the Aulora docs site into apps/docs/dist.
//
// Zero dependencies: reads Markdown from ../content, renders it with the local
// markdown module, wraps each page in the shared layout and copies the static
// assets. Pages are declared in order below so the nav is stable.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarkdown } from "../lib/markdown.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const contentDir = join(root, "content");
const staticDir = join(root, "static");
const outDir = join(root, "dist");

const PAGES = [
  { file: "index.md", label: "Overview" },
  { file: "getting-started.md", label: "Getting started" },
  { file: "self-hosting.md", label: "Self-hosting" },
  { file: "admin.md", label: "Admin panel" },
  { file: "backups.md", label: "Backups" },
  { file: "licensing.md", label: "Licensing" },
  { file: "contributing.md", label: "Contributing" },
];

function outputName(file) {
  return file.replace(/\.md$/, ".html");
}

function nav(currentFile) {
  const links = PAGES.map((page) => {
    const active = page.file === currentFile ? ' aria-current="page"' : "";
    return `      <a href="${outputName(page.file)}"${active}>${page.label}</a>`;
  });
  return links.join("\n");
}

function layout({ title, body, currentFile }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} · Aulora Docs</title>
    <meta name="description" content="Aulora self-hosted, end-to-end encrypted team chat documentation." />
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <header class="topbar">
      <a class="brand" href="index.html">Aulora <span>docs</span></a>
      <span class="tag">secure team chat on your own server</span>
    </header>
    <div class="shell">
      <nav class="sidebar" aria-label="Documentation">
${nav(currentFile)}
      </nav>
      <main class="content">
${body}
      </main>
    </div>
    <footer class="footer">
      Aulora is source-available under the PolyForm Noncommercial License 1.0.0.
      Commercial use needs a license.
    </footer>
  </body>
</html>
`;
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const page of PAGES) {
  const source = readFileSync(join(contentDir, page.file), "utf8");
  const { html, title } = renderMarkdown(source);
  const pageTitle = title ?? page.label;
  writeFileSync(
    join(outDir, outputName(page.file)),
    layout({ title: pageTitle, body: html, currentFile: page.file }),
    "utf8",
  );
}

cpSync(staticDir, outDir, { recursive: true });
process.stdout.write(`docs: wrote ${PAGES.length} pages to ${outDir}\n`);
