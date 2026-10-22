// Builds the Aulora site into apps/docs/dist: the landing page at the root and
// the documentation under docs/.
//
// Zero dependencies: reads Markdown from ../content, renders it with the local
// markdown module, wraps each page in the shared layout and copies the static
// assets. Colors and icons come from packages/tokens and avatars from the same
// Blobatar build the clients use, so the site always matches the app. Pages are
// declared in order below so the nav is stable.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { readEnvCatalog } from "../lib/env-catalog.mjs";
import { ENV_REFERENCE_PAGE, renderEnvReference } from "../lib/env-reference.mjs";
import { EXTRA_ENV_VARS, EXTRA_GROUPS } from "../lib/env-reference-extras.mjs";
import { escapeHtml, renderMarkdown } from "../lib/markdown.mjs";
import { buildSearchIndex } from "../lib/search-index.mjs";
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
      { file: "notes.md", label: "Notes" },
      { file: "bots.md", label: "Bots" },
      { file: "webhooks.md", label: "Webhooks" },
    ],
  },
  {
    label: "Run a server",
    pages: [
      { file: "self-hosting.md", label: "Self-hosting" },
      { file: ENV_REFERENCE_PAGE, label: "Environment variables" },
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
const envCatalog = readEnvCatalog(repo);
const envExtras = { groups: EXTRA_GROUPS, variables: EXTRA_ENV_VARS };
// `blobatar` is a dependency of the avatars package, not the docs app, so load
// it through a require rooted at that package with a fixed module name.
const { blobatar } = createRequire(join(repo, "packages/avatars/package.json"))("blobatar");

const icon = (name, className) => iconSvg(icons, name, className);

function outputName(file) {
  return file.replace(/\.md$/, ".html");
}

// Clean, extensionless URL for a documentation page. The generated file keeps
// its `.html` extension for backwards compatibility (and so GitHub Pages can
// serve it), but links and canonical URLs omit it. The index page maps to the
// directory itself.
function pageHref(file) {
  return file === "index.md" ? "" : outputName(file).replace(/\.html$/, "");
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
    <script type="module" src="${base}site.js"></script>
${["tokens.css", "site.css", ...styles].map((file) => `    <link rel="stylesheet" href="${base}${file}" />`).join("\n")}
  </head>`;
}

function siteHeader({ base, section }) {
  const item = (href, label, name) => {
    const current = section === name ? ' aria-current="page"' : "";
    return `<a href="${base}${href}"${current}>${label}</a>`;
  };
  return `    <header class="site-header">
      <div class="site-header-inner">
        <a class="brand" href="${base || "./"}">
          <img src="${base}favicon.svg" alt="" width="26" height="26" />
          <span class="brand-lockup"><span class="brand-name">Aulora</span>${section === "docs" ? '<span class="brand-sub">/docs</span>' : ""}</span>
        </a>
${siteSearch({ base })}
        <nav class="site-nav" aria-label="Site">
          ${item("how-it-works", "How it works", "how-it-works")}
          ${item("install", "Install", "install")}
          ${item("pricing", "Pricing", "pricing")}
          ${item("docs/", "Docs", "docs")}
          <a href="https://github.com/chark1es/Aulora">GitHub</a>
        </nav>
      </div>
    </header>`;
}

// The search command palette, shared by the marketing pages and the docs. The
// index is built at build time into `search-index.json`; `static/search.js`
// loads it lazily and scores it in the browser.
function siteSearch({ base }) {
  return `        <div class="site-search" data-search data-index="${base}search-index.json" data-base="${base}">
          <div class="site-search-field" data-search-field>
            ${icon("search")}
            <label class="visually-hidden" for="docs-search-input">Search the documentation</label>
            <input id="docs-search-input" class="site-search-input" type="search" placeholder="Search docs" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="docs-search-listbox" aria-autocomplete="list" />
            <kbd class="site-search-kbd" aria-hidden="true">/</kbd>
            <button type="button" class="site-search-clear" data-search-clear aria-label="Clear search" hidden>${icon("x")}</button>
          </div>
          <div class="site-search-panel" data-search-panel hidden>
            <ul id="docs-search-listbox" class="site-search-results" role="listbox" aria-label="Search results" data-search-results></ul>
            <p class="site-search-empty" data-search-empty hidden></p>
          </div>
        </div>`;
}

function siteFooter({ base }) {
  return `    <footer class="site-footer">
      <div class="site-footer-inner">
        <p class="footer-mark">Aulora · team chat on your own server</p>
        <nav aria-label="Legal and contact">
          <a href="${base}docs/licensing">Licensing</a>
          <a href="${base}docs/privacy">Privacy</a>
          <a href="${base}docs/legal/COMMERCIAL">Commercial terms</a>
          <a href="${base}docs/legal/THIRD_PARTY_NOTICES">Third-party notices</a>
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
      return `          <a href="${docs}${pageHref(page.file)}"${active}>${page.label}</a>`;
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
      /<pre><code class="language-([\w-]+)">/g,
      (_match, language) =>
        `<div class="code"><div class="code-bar"><span>${language ?? "text"}</span><button type="button" data-copy>Copy</button></div><pre><code${language ? ` class="language-${language}"` : ""}>`,
    )
    .replace(
      /<pre><code>/g,
      () =>
        '<div class="code"><div class="code-bar"><span>text</span><button type="button" data-copy>Copy</button></div><pre><code>',
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
      : `<a class="pager-${rel}" href="${docs}${pageHref(page.file)}" rel="${rel}"><small>${label}</small>${page.label}</a>`;
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
          <p class="page-eyebrow"><a href="${docs}">Docs</a>${icon("chevron-right")}<span>${escapeHtml(group?.label ?? "Legal")}</span></p>
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

// Marketing pages are hand-written HTML with a few build-time placeholders:
// {{icon:name}}, {{avatar:seed}} (a person, circle) and {{server:seed}}
// (a workspace, squircle), plus {{head}}, {{header}} and {{footer}}.
const LANDING_PAGES = [
  {
    file: "index.html",
    section: "home",
    title: "Aulora · Team chat on your own server",
    description:
      "Channels, threads, direct messages, and voice and video calls. Download the app, or install a workspace on a server you run.",
  },
  {
    file: "how-it-works.html",
    section: "how-it-works",
    title: "How it works · Aulora",
    description:
      "One Aulora app can join several servers. Each server is its own workspace, with its own accounts, channels, and files.",
  },
  {
    file: "install.html",
    section: "install",
    title: "Install · Aulora",
    description:
      "Install the Aulora client for macOS, Windows, Linux, or the iOS and Android betas, or run a workspace on a server you control.",
  },
  {
    file: "pricing.html",
    section: "pricing",
    title: "Pricing · Aulora",
    description:
      "Aulora is free for personal and noncommercial use. Companies pay $1 per active user per month.",
  },
];

// Each marketing page declares its own literal source and output paths, so the
// build only ever opens files under the fixed landing and dist directories.
const LANDING_IO = new Map([
  [
    "index.html",
    {
      read: () => readFileSync(join(root, "landing", "index.html"), "utf8"),
      write: (contents) => writeFileSync(join(outDir, "index.html"), contents, "utf8"),
    },
  ],
  [
    "how-it-works.html",
    {
      read: () => readFileSync(join(root, "landing", "how-it-works.html"), "utf8"),
      write: (contents) => writeFileSync(join(outDir, "how-it-works.html"), contents, "utf8"),
    },
  ],
  [
    "install.html",
    {
      read: () => readFileSync(join(root, "landing", "install.html"), "utf8"),
      write: (contents) => writeFileSync(join(outDir, "install.html"), contents, "utf8"),
    },
  ],
  [
    "pricing.html",
    {
      read: () => readFileSync(join(root, "landing", "pricing.html"), "utf8"),
      write: (contents) => writeFileSync(join(outDir, "pricing.html"), contents, "utf8"),
    },
  ],
]);

function renderLanding(page) {
  const template = LANDING_IO.get(page.file).read();
  const base = "";
  return template
    .replace(
      "{{head}}",
      head({
        title: page.title,
        description: page.description,
        base,
        styles: ["landing.css"],
      }),
    )
    .replace("{{header}}", siteHeader({ base, section: page.section }))
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
for (const page of LANDING_PAGES) {
  LANDING_IO.get(page.file).write(renderLanding(page));
}

/** Reads one docs page. `file` is always an entry of the PAGES manifest, never user input. */
function readContentPage(file) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- manifest entry, not user input
  return readFileSync(join(contentDir, file), "utf8");
}

const indexPages = [];
for (const page of PAGES) {
  const { html, title } =
    page.file === ENV_REFERENCE_PAGE
      ? renderEnvReference(envCatalog, envExtras, icon)
      : renderMarkdown(readContentPage(page.file));
  writeFileSync(
    join(docsOut, outputName(page.file)),
    docsLayout({ title: title ?? page.label, body: html, currentFile: page.file, base: "../" }),
    "utf8",
  );
  indexPages.push({ title: title ?? page.label, url: `docs/${pageHref(page.file)}`, html });
}
writeFileSync(
  join(outDir, "search-index.json"),
  `${JSON.stringify(buildSearchIndex(indexPages))}\n`,
  "utf8",
);

// Legal pages are written from repository-root Markdown but link relative to
// the repository. Map a rendered link back to the real file (keeping `.md`
// where the source is Markdown) for the absolute GitHub copy.
function repoBlobPath(href) {
  const hashAt = href.indexOf("#");
  const target = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  const candidate = [target, `${target}.md`].find((path) => existsSync(join(repo, path)));
  return `${candidate ?? target}${hash}`;
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
      (_match, href) => `href="https://github.com/chark1es/Aulora/blob/main/${repoBlobPath(href)}"`,
    );
    writeFileSync(
      join(legalDir, outputName(file)),
      docsLayout({ title: title ?? file, body, currentFile: file, base: "../../" }),
      "utf8",
    );
  }
}
// Precompress text assets so a host can serve `.gz` with `gzip_static` without
// compressing per request. Deterministic: a sorted walk, level 9, and an
// existing `.gz` is left as-is. Files under 1 KB are not worth the sibling.
const TEXT_ASSET = /\.(?:html|js|css|json|svg)$/;
const GZIP_MIN_BYTES = 1024;

function precompress(directory) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Walks the build output directory this script just wrote; paths are bounded to it.
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed child entry of the build output tree above.
    if (statSync(path).isDirectory()) {
      precompress(path);
      continue;
    }
    if (!TEXT_ASSET.test(name)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed text asset inside the build output tree.
    const contents = readFileSync(path);
    if (contents.byteLength < GZIP_MIN_BYTES) continue;
    const target = `${path}.gz`;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Writes the .gz sibling of a build output file.
    if (!existsSync(target)) writeFileSync(target, gzipSync(contents, { level: 9 }));
  }
}

precompress(outDir);

process.stdout.write(
  `docs: wrote ${LANDING_PAGES.length} marketing pages and ${PAGES.length} docs pages to ${outDir}\n`,
);
