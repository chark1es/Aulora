// Builds the client search index from the rendered documentation pages. Each
// heading (with its anchor id) becomes an entry carrying the page title, the
// heading text and the plain text of the section below it, so the browser can
// score and preview matches without a server.

const HEADING = /<h([23]) id="([^"]+)">([\s\S]*?)<\/h\1>/g;
const MAX_SECTION_CHARS = 600;

const ENTITIES = new Map([
  ["&amp;", "&"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
  ["&#39;", "'"],
]);

/** Strips tags and HTML entities from a rendered fragment. */
export function plainText(html) {
  return String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/g, (entity) => ENTITIES.get(entity) ?? " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text) {
  return text.length > MAX_SECTION_CHARS
    ? `${text.slice(0, MAX_SECTION_CHARS - 1).trimEnd()}…`
    : text;
}

function sectionsFor(page) {
  const matches = [...page.html.matchAll(HEADING)];
  const entries = [];
  const intro = clip(plainText(page.html.slice(0, matches[0]?.index ?? page.html.length)));
  if (intro !== "") {
    entries.push({ title: page.title, url: page.url, id: "", heading: page.title, text: intro });
  }
  matches.forEach((match, index) => {
    const start = match.index + match[0].length;
    const sectionEnd = matches[index + 1]?.index ?? page.html.length;
    entries.push({
      title: page.title,
      url: page.url,
      id: match[2],
      heading: plainText(match[3]),
      text: clip(plainText(page.html.slice(start, sectionEnd))),
    });
  });
  return entries;
}

/**
 * Builds `{ entries }` from `{ title, url, html }` records. `url` is a clean,
 * site-root-relative link such as `docs/self-hosting`; the browser prepends the
 * page's base so the index works from the docs and the landing pages alike.
 */
export function buildSearchIndex(pages) {
  return { entries: pages.flatMap((page) => sectionsFor(page)) };
}
