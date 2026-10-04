// Builds the Aulora site into apps/docs/dist: the landing page at the root and
// the documentation under docs/.
//
// Zero dependencies: reads Markdown from ../content, renders it with the local
// markdown module, wraps each page in the shared layout and copies the static
// assets. Colors and icons come from packages/tokens and avatars from the same
// Blobatar build the clients use, so the site always matches the app. Pages are
// declared in order below so the nav is stable.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { escapeHtml, renderMarkdown } from "../lib/markdown.mjs";
import { iconSvg, paletteCss, readIcons, readPalettes } from "../lib/theme.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const repo = join(root, "..", "..");
const contentDir = join(root, "content");
const staticDir = join(root, "static");
const outDir = join(root, "dist");
const docsOut = join(outDir, "docs");

const GROUPS = [
  {
    label: "Start here",
    pages: [
      { file: "index.md", label: "Overview" },
      { file: "getting-started.md", label: "Getting started" },
      { file: "user-guide.md", label: "User guide" },
      { file: "kanban.md", label: "Kanban" },
    ],
  },
  {
    label: "Run a server",
    pages: [
      { file: "self-hosting.md", label: "Self-hosting" },
      { file: "coolify.md", label: "Coolify" },
      { file: "admin.md", label: "Admin panel" },
      { file: "backups.md", label: "Backups" },
      { file: "updates.md", label: "Updates" },
      { file: "troubleshooting.md", label: "Troubleshooting" },
    ],
  },
  {
    label: "Policy",
    pages: [
      { file: "privacy.md", label: "Privacy" },
      { file: "licensing.md", label: "Licensing" },
      { file: "contributing.md", label: "Contributing" },
    ],
  },
];

const PAGES = GROUPS.flatMap((group) => group.pages);

const icons = readIcons(readFileSync(join(repo, "packages/tokens/src/icons.ts"), "utf8"));
const palettes = readPalettes(readFileSync(join(repo, "packages/tokens/src/colors.ts"), "utf8"));
const blobatarEntry = createRequire(join(repo, "packages/avatars/package.json")).resolve(
  "blobatar",
);
const { blobatar } = await import(pathToFileURL(blobatarEntry).href);

const icon = (name, className) => iconSvg(icons, name, className);

function outputName(file) {
  return file.replace(/\.md$/, ".html");
}

function plainText(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function head({ title, description, base, styles }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="icon" type="image/svg+xml" href="${base}favicon.svg" />
    <script src="${base}site.js" defer></script>
${["tokens.css", "site.css", ...styles].map((file) => `    <link rel="stylesheet" href="${base}${file}" />`).join("\n")}
  </head>`;
}

function siteHeader({ base, section }) {
  const current = (name) => (section === name ? ' aria-current="page"' : "");
  return `    <header class="site-header">
      <div class="site-header-inner">
        <a class="brand" href="${base}index.html">
          <img src="${base}favicon.svg" alt="" width="26" height="26" />
          <span>Aulora</span>${section === "docs" ? '<span class="brand-sub">/ docs</span>' : ""}
        </a>
        <nav class="site-nav" aria-label="Site">
          <a href="${base}index.html#product">Product</a>
          <a href="${base}index.html#install">Install</a>
          <a href="${base}index.html#pricing">Pricing</a>
          <a href="${base}docs/index.html"${current("docs")}>Docs</a>
          <a href="https://github.com/chark1es/Aulora">GitHub</a>
        </nav>
      </div>
    </header>`;
}

function siteFooter({ base }) {
  return `    <footer class="site-footer">
      <div class="site-footer-inner">
        <p class="footer-mark">Aulora · team chat on your own server</p>
        <nav aria-label="Legal and contact">
          <a href="${base}docs/licensing.html">Licensing</a>
          <a href="${base}docs/privacy.html">Privacy</a>
          <a href="${base}docs/legal/COMMERCIAL.html">Commercial terms</a>
          <a href="${base}docs/legal/THIRD_PARTY_NOTICES.html">Third-party notices</a>
          <a href="mailto:cnguyen@spwnd.dev">cnguyen@spwnd.dev</a>
        </nav>
        <p class="footer-fine">Free for personal and noncommercial use under PolyForm Noncommercial 1.0.0. Business use requires a paid license.</p>
      </div>
    </footer>`;
}

function sidebar(currentFile, docs) {
  const groups = GROUPS.map((group) => {
    const links = group.pages.map((page) => {
      const active = page.file === currentFile ? ' aria-current="page"' : "";
      return `          <a href="${docs}${outputName(page.file)}"${active}>${page.label}</a>`;
    });
    return `        <div class="nav-group">
          <p class="nav-label">${group.label}</p>
${links.join("\n")}
        </div>`;
  });
  return groups.join("\n");
}

// Fenced code gains a toolbar with its language and a copy button.
function decorateCode(html) {
  return html
    .replace(
      /<pre><code(?: class="language-([\w-]+)")?>/g,
      (_match, language) =>
        `<div class="code"><div class="code-bar"><span>${language ?? "text"}</span><button type="button" data-copy>Copy</button></div><pre><code${language ? ` class="language-${language}"` : ""}>`,
    )
    .replace(/<\/code><\/pre>/g, "</code></pre></div>");
}

function tableOfContents(html) {
  const items = [...html.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)].map(
    (match) => `          <a href="#${match[1]}">${escapeHtml(plainText(match[2]))}</a>`,
  );
  if (items.length < 2) {
    return "";
  }
  return `      <aside class="toc" aria-label="On this page">
        <p class="nav-label">On this page</p>
        <nav>
${items.join("\n")}
        </nav>
      </aside>`;
}

function pager(currentFile, docs) {
  const index = PAGES.findIndex((page) => page.file === currentFile);
  if (index === -1) {
    return "";
  }
  const previous = PAGES[index - 1];
  const next = PAGES[index + 1];
  const link = (page, rel, label) =>
    page === undefined
      ? "<span></span>"
      : `<a class="pager-${rel}" href="${docs}${outputName(page.file)}" rel="${rel}"><small>${label}</small>${page.label}</a>`;
  return `        <nav class="pager" aria-label="Pages">
          ${link(previous, "prev", "Previous")}
          ${link(next, "next", "Next")}
        </nav>`;
}

function docsLayout({ title, body, currentFile, base }) {
  const docs = `${base}docs/`;
  // The page header carries the title, so drop the Markdown's own first heading.
  const content = decorateCode(body.replace(/^<h1 id="[^"]*">[\s\S]*?<\/h1>\n?/, ""));
  const minutes = Math.max(1, Math.round(plainText(content).split(/\s+/).length / 220));
  const group = GROUPS.find((entry) => entry.pages.some((page) => page.file === currentFile));
  return `${head({
    title: `${plainText(title)} · Aulora Docs`,
    description: "Documentation for Aulora, self-hosted team chat with server-side encryption.",
    base,
    styles: ["docs.css"],
  })}
  <body class="docs">
${siteHeader({ base, section: "docs" })}
    <div class="docs-shell">
      <details class="docs-nav" open>
        <summary>${icon("menu")}<span>Contents</span></summary>
        <nav aria-label="Documentation">
${sidebar(currentFile, docs)}
        </nav>
      </details>
      <main class="docs-main">
        <header class="page-header">
          <p class="page-eyebrow"><a href="${docs}index.html">Docs</a>${icon("chevron-right")}<span>${escapeHtml(group?.label ?? "Legal")}</span></p>
          <h1>${title}</h1>
          <p class="page-meta">${minutes} min read</p>
        </header>
        <article class="prose">
${content}
        </article>
${pager(currentFile, docs)}
      </main>
${tableOfContents(content)}
    </div>
${siteFooter({ base })}
  </body>
</html>
`;
}

// The landing page is hand-written HTML with a few build-time placeholders:
// {{icon:name}}, {{avatar:seed}} (a person, circle) and {{server:seed}}
// (a workspace, squircle), plus {{head}}, {{header}} and {{footer}}.
function renderLanding() {
  const template = readFileSync(join(root, "landing", "index.html"), "utf8");
  const base = "";
  return template
    .replace(
      "{{head}}",
      head({
        title: "Aulora · Team chat on your own server",
        description:
          "Channels, threads, DMs, and voice/video calls for your team, running on one Docker host you control. Browser, desktop, and mobile clients.",
        base,
        styles: ["landing.css"],
      }),
    )
    .replace("{{header}}", siteHeader({ base, section: "home" }))
    .replace("{{footer}}", siteFooter({ base }))
    .replace(/\{\{icon:([a-z-]+)\}\}/g, (_match, name) => icon(name))
    .replace(
      /\{\{(avatar|server):([^}]+)\}\}/g,
      (_match, kind, seed) =>
        `<span class="avatar${kind === "server" ? " avatar-server" : ""}" aria-hidden="true">${blobatar(`aulora:${kind === "server" ? "server" : "user"}:${seed}`)}</span>`,
    );
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(docsOut, { recursive: true });

cpSync(staticDir, outDir, { recursive: true });
cpSync(join(repo, "apps/web/public/favicon.svg"), join(outDir, "favicon.svg"));
writeFileSync(join(outDir, "tokens.css"), paletteCss(palettes), "utf8");
writeFileSync(join(outDir, "index.html"), renderLanding(), "utf8");

for (const page of PAGES) {
  const source = readFileSync(join(contentDir, page.file), "utf8");
  const { html, title } = renderMarkdown(source);
  writeFileSync(
    join(docsOut, outputName(page.file)),
    docsLayout({ title: title ?? page.label, body: html, currentFile: page.file, base: "../" }),
    "utf8",
  );
}

const legalDir = join(docsOut, "legal");
mkdirSync(legalDir, { recursive: true });
for (const file of ["LICENSE", "NOTICE", "COMMERCIAL.md", "CLA.md", "THIRD_PARTY_NOTICES.md"]) {
  const source = join(repo, file);
  cpSync(source, join(legalDir, file));
  if (file.endsWith(".md")) {
    const { html, title } = renderMarkdown(readFileSync(source, "utf8"));
    // Legal pages use repository-relative links. Keep their originals as text
    // and use absolute repository links in the readable HTML copies.
    const body = html.replace(
      /href="(?![a-z]+:|#|\/)([^"]+)"/gi,
      (_match, href) =>
        `href="https://github.com/chark1es/Aulora/blob/main/${href.replace(/\.html(?=#|$)/, ".md")}"`,
    );
    writeFileSync(
      join(legalDir, outputName(file)),
      docsLayout({ title: title ?? file, body, currentFile: file, base: "../../" }),
      "utf8",
    );
  }
}
process.stdout.write(`docs: wrote the landing page and ${PAGES.length} docs pages to ${outDir}\n`);
