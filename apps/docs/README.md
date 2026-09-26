# @aulora/docs

The Aulora documentation site: a zero-dependency static build that renders
Markdown from `content/` into `dist/`.

```sh
bun run --cwd apps/docs build   # write dist/
bun run --cwd apps/docs dev     # build and serve on http://localhost:4173
bun run --cwd apps/docs test    # node:test the markdown renderer
```

## Editing

- Pages live in `content/*.md`; the order and labels are declared in
  `scripts/build.mjs` (`PAGES`).
- `lib/markdown.mjs` supports headings, paragraphs, fenced code, lists,
  blockquotes, horizontal rules and inline code/bold/italic/links. Raw HTML is
  escaped.
- Relative `*.md` links are rewritten to `*.html`.
- Styling is a single `static/style.css` using the shared Aulora palette.

The build copies `static/` into `dist/`, so the whole site is portable static
files and can be served by any file server (or the `docs` service/route of your
choice).
