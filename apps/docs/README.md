# @aulora/docs

The Aulora website: a landing page and the documentation, built into static
files in `dist/` with no dependencies of its own.

```sh
bun run --cwd apps/docs build   # write dist/
bun run --cwd apps/docs dev     # build and serve on http://localhost:4173
bun run --cwd apps/docs test    # node:test the markdown renderer and token reader
```

## Layout

| Output | Source |
| --- | --- |
| `dist/index.html` | `landing/index.html`, the landing page |
| `dist/docs/*.html` | `content/*.md`, the documentation |
| `dist/docs/legal/` | `LICENSE`, `NOTICE`, `COMMERCIAL.md`, `CLA.md`, `THIRD_PARTY_NOTICES.md` from the repository root |
| `dist/tokens.css` | Generated from `packages/tokens/src/colors.ts` |
| `dist/*.css`, `dist/*.js` | `static/` |

## Theme

The site uses the app's own design system, so it can't drift from the clients:

- `tokens.css` is generated from the `@aulora/tokens` light and dark palettes.
  The site follows the system appearance and has no appearance switch of its
  own. It also responds to Increase Contrast and Reduce Transparency.
- Ember marks what you can click. In dark mode, `site.css` derives a darker
  button fill and a lighter link color from the token so both clear 4.5:1.
- Icons come from `packages/tokens/src/icons.ts` (Material Symbols Rounded,
  the same glyphs as `@aulora/ui-web`).
- Avatars in the landing page are rendered with Blobatar, resolved from
  `packages/avatars`, from the seeds the app's `/__preview` demo uses.
- The docs are a reading page, not an app window: a centred table of
  contents, a breadcrumb and large title, the opening paragraph as a summary,
  and blockquotes rendered as notes.

## Editing

- Docs pages live in `content/*.md`. Their order, labels, and sidebar groups
  are declared in `scripts/build.mjs` (`GROUPS`).
- `lib/markdown.mjs` supports headings, paragraphs, fenced code, lists,
  blockquotes, tables, horizontal rules and inline code/bold/italic/links. Raw
  HTML is escaped. Relative `*.md` links are rewritten to `*.html`.
- The landing page is hand-written HTML. The build fills these placeholders:
  `{{icon:name}}` for a token icon, `{{avatar:seed}}` for a person,
  `{{server:seed}}` for a workspace, and `{{head}}`, `{{header}}`, and
  `{{footer}}` for the shared chrome.
- `static/site.css` holds the shared chrome, `static/docs.css` the docs, and
  `static/landing.css` the landing page. Use the token variables (`--accent`,
  `--surface-2`, …) rather than hex values.

Every link in `dist/` is relative, so the site can be served from any static
file server or subdirectory. `bun run docs:check` verifies every generated
link and anchor.
