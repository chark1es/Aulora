// Builds the docs site, then serves apps/docs/dist on a local port.
//
//   node scripts/serve.mjs [port]
//
// Dev-only convenience: no watch mode, restart after editing content.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = join(here, "..");
const dist = join(root, "dist");
const port = Number(process.argv[2] ?? process.env.DOCS_PORT ?? 4173);

const build = spawnSync(process.execPath, [join(here, "build.mjs")], { stdio: "inherit" });
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  const relative = normalize(url.pathname).replace(/^([/\\])+/, "");
  let file = join(dist, relative);
  // Clean URLs: `/docs/` and `/docs` resolve to `docs/index.html`, and
  // `/docs/privacy` falls back to `docs/privacy.html`.
  if (existsSync(file) && statSync(file).isDirectory()) {
    file = join(file, "index.html");
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    const withHtml = `${file}.html`;
    file = existsSync(withHtml) ? withHtml : join(dist, "index.html");
  }
  try {
    const body = readFileSync(file);
    response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("Not found");
  }
});

server.listen(port, () => {
  process.stdout.write(`docs: serving ${dist} at http://localhost:${port}\n`);
});
