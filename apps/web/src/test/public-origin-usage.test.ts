import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest runs with the package directory as its root; fail loudly instead of
// silently scanning nothing if that ever changes.
const srcRoot = join(process.cwd(), "src");
if (!existsSync(join(srcRoot, "lib", "public-origin.ts"))) {
  throw new Error(`public-origin usage guard must run from apps/web (cwd: ${process.cwd()})`);
}

/**
 * These two modules own the page origin.
 *
 * `public-origin` decides what a shareable link may name, and
 * `session-token` compares a workspace URL with the page origin to decide
 * whether a bearer token is needed. Everything else asks them: inside the
 * desktop shell the page origin is the bundle's internal `tauri.localhost`
 * address, and putting it in a link, a copy action or an OAuth callback would
 * expose the shell where a workspace address belongs.
 *
 * Tests are excluded because they compare against the page origin directly.
 * The OAuth callback (`authCallbackUrl`) is the one product use that must return
 * the webview origin; it lives in `public-origin` for that reason.
 */
const ALLOWED: Readonly<Record<string, true>> = {
  "lib/public-origin.ts": true,
  "lib/session-token.ts": true,
};

const SOURCE_FILE = /\.(?:ts|tsx)$/;
const TEST_FILE = /\.test\.(?:ts|tsx)$/;
const PAGE_ORIGIN = /location\.origin\b/;

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

describe("page origin use", () => {
  it("is read only by the modules that own origin decisions", () => {
    const offenders = sourceFiles(srcRoot)
      .map((path) => relative(srcRoot, path).split(sep).join("/"))
      .filter((path) => ALLOWED[path] !== true)
      .filter((path) => PAGE_ORIGIN.test(readFileSync(join(srcRoot, path), "utf8")));

    expect(offenders).toEqual([]);
  });
});
