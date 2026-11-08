# Performance and regression guards

Automated guards keep updates from silently growing the shipped bundles or
turning bounded backend reads into full-table scans. They run in CI and in the
local aggregate check, and each one has a deliberate, reviewable escape hatch
rather than a blanket disable. This is the operating guide; the design intent
behind Convex reads is in [Convex performance and upgrades](convex/README.md).

Run every guard the way CI does:

```sh
bun run build     # produces apps/web/dist
bun run perf:bundle
bun run perf:embed
bun run perf:convex
```

`bun run check` runs all three after the build. A failure names the file, method
or chunk that changed, so fix the code or update the committed number with a
reviewed reason.

## Web bundle budget

`scripts/ci/bundle-budget.mjs` measures `apps/web/dist` and compares it with
`scripts/ci/bundle-budget.json`.

- Every emitted asset has a raw and gzip ceiling. Asset keys drop the Vite
  content hash, so `assets/index-C5L5PBI_.js` is budgeted as
  `assets/index.js` and an ordinary content change keeps the same ceiling.
- The initial graph has its own ceiling. It follows `index.html` scripts,
  `modulepreload` links and stylesheets plus every statically imported chunk.
  Dynamic imports are deliberately not followed.
- Heavy on-demand libraries must stay out of that initial graph: LiveKit,
  MediaPipe tasks-vision, the MediaPipe WebAssembly loader, the selfie
  segmentation model, and RNNoise. The guard checks emitted chunk names and
  also scans initial-graph code for their markers, so renaming a chunk or
  merging a library into the entry chunk still fails.
- A stale chunk entry only warns: a removed chunk is not a performance
  regression.

Ceilings are the measured baseline plus 10 percent headroom, rounded up to 64
bytes.

### Update the budget

```sh
bun run build
bun run perf:bundle -- --update
```

Commit the changed `scripts/ci/bundle-budget.json` and explain the growth in the
pull request. `--update` rewrites every chunk ceiling from the current build and
preserves the lazy-loading list, so it cannot quietly drop that guard. Treat a
regression as a bug: check whether the new code should be a dynamic import
before raising the ceiling.

Useful options: `--dist=<dir>` to measure another build and `--budget=<file>`
to compare against a different budget.

## Convex query guard

`scripts/ci/convex-query-guard.mjs` parses `packages/convex/convex` with the
TypeScript compiler API (skipping `_generated` and test files) and reports:

1. `collect` — `ctx.db.query(...).collect()` reads the whole table or index.
2. `filter-without-index` — `.filter(...)` on a database query whose chain has
   no `.withIndex(...)`. The predicate runs after the read.
3. `paginate-unbounded` — `.paginate(...)` whose `numItems` is not a numeric
   literal, a file constant initialized to a number or clamp, or a clamp call
   such as `Math.min(...)`.

A violation fails `bun run lint` (and therefore `bun run check`). A violation
inside a helper in `packages/convex/convex/lib` is attributed to its own
function name. Filters on arrays that were already collected are not database
violations, and neither are bounded terminals such as `.take(20)` or `.first()`.

### Add a justified exception

Pre-existing violations are recorded in
`scripts/ci/convex-query-allowlist.json`. Each entry is keyed by
`<convex file>#<function>#<rule>`, which survives line movement:

```json
{
  "key": "presence.ts#sweep#collect",
  "reason": "Bounded by the 200-member presence cap; rebuilt every sweep interval."
}
```

Add an entry only when the read is provably bounded by something the guard
cannot see, and put that bound in `reason`. Reference the limit in review, not
just the file name. New violations are not allowed; the guard deliberately does
not offer a silence flag.

The allowlist is generated once from the current tree:

```sh
node scripts/ci/convex-query-guard.mjs --update
```

`--update` keeps existing reasons and stale entries, and only adds missing keys,
so it does not erase review notes. A stale entry (code removed or bounded) only
prints a warning; delete it in the cleanup that fixed the query. Remove the
entry first when you make a read bounded so the guard keeps watching it.
Otherwise a regression reintroduces the original unbounded read without a
failing check.

Run the guard alone with `bun run perf:convex`. Use `--root=<dir>` and
`--allowlist=<file>` to scan a fixture.

## Desktop embed budget

`apps/desktop/scripts/prepare-frontend.mjs` copies `apps/web/dist` to
`apps/web/dist-desktop` for Tauri and checks the embedded size against
`apps/desktop/scripts/frontend-budget.json`. The ceiling is the measured embed
plus 10 percent, rounded up to the next kibibyte.

This runs automatically because `src-tauri/tauri.conf.json` includes
`prepare:frontend` in `beforeBuildCommand`, and CI runs `bun run perf:embed`
after the web build. Update the committed ceiling when a reviewed feature
legitimately grows the embed:

```sh
bun run build
bun run perf:embed -- --update-budget
```

Bulk assets that the shell does not need offline should be fetched on demand
instead. The MediaPipe and RNNoise assets are kept on purpose: the shell's
no-remote-code CSP cannot re-fetch them from the workspace origin.

## End-to-end tests

`apps/web/e2e` is a Playwright suite that needs a deployed stack
(`AULORA_E2E_BASE_URL` plus owner credentials), documented in
[development](development.md). It is not part of the required checks and has no
scheduled workflow, because the suite requires a live docker compose stack and
secrets. Run it manually with `bun run --cwd apps/web test:e2e` against that
stack when a change touches sign-in, uploads, admin, deep links, or the
two-device chat path.
