// Command-palette documentation search for the shared header. The index is
// built at build time into `search-index.json`; this loads it on first use and
// scores it in the browser. Without JavaScript the input stays inert and the
// pages still read.

const MAX_RESULTS = 12;
const SNIPPET_CHARS = 150;

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function scoreEntry(entry, tokens) {
  if (tokens.length === 0) return 0;
  const title = tokenize(entry.title);
  const heading = tokenize(entry.heading);
  const body = tokenize(entry.text);
  let score = 0;
  for (const token of tokens) {
    if (title.some((word) => word.startsWith(token))) score += 6;
    else if (heading.some((word) => word.startsWith(token))) score += 4;
    else if (body.some((word) => word.startsWith(token))) score += 1;
    else return 0;
  }
  return score;
}

/** Whether keyboard focus is in a field the person is typing into. */
function isEditable(target) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select");
}

/** Prefix-matches every token against title, heading and body, weighted in turn. */
export function searchIndex(entries, query) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  return entries
    .map((entry) => ({ entry, score: scoreEntry(entry, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map((item) => item.entry);
}

function snippet(entry, tokens) {
  const text = entry.text;
  const lower = text.toLowerCase();
  let at = -1;
  for (const token of tokens) {
    const found = lower.indexOf(token);
    if (found !== -1 && (at === -1 || found < at)) at = found;
  }
  if (at === -1) return text.slice(0, SNIPPET_CHARS);
  const start = Math.max(0, at - 40);
  const end = Math.min(text.length, start + SNIPPET_CHARS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/** The [start, end) ranges of `text` that match any token, merged and sorted. */
function matchRanges(text, tokens) {
  const lower = text.toLowerCase();
  // Case mapping can change a string's length; skip highlighting rather than misplace it.
  if (lower.length !== text.length) return [];
  const ranges = [];
  for (const token of tokens) {
    let from = lower.indexOf(token);
    while (from !== -1) {
      ranges.push([from, from + token.length]);
      from = lower.indexOf(token, from + token.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last !== undefined && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

/** Appends `text` to `parent`, wrapping every token match in a `<mark>` element. */
function appendHighlighted(parent, text, tokens) {
  let cursor = 0;
  for (const [start, end] of matchRanges(text, tokens)) {
    if (start > cursor) parent.append(text.slice(cursor, start));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(start, end);
    parent.append(mark);
    cursor = end;
  }
  if (cursor < text.length) parent.append(text.slice(cursor));
}

function span(className, text, tokens) {
  const element = document.createElement("span");
  element.className = className;
  appendHighlighted(element, text, tokens);
  return element;
}

function resultItem(container, entry, tokens, index) {
  const item = document.createElement("li");
  item.className = "site-search-result";
  item.id = `docs-search-option-${index}`;
  item.setAttribute("role", "option");
  item.setAttribute("aria-selected", "false");
  const base = container.dataset.base ?? "";
  const hash = entry.id === "" ? "" : `#${entry.id}`;
  const link = document.createElement("a");
  link.tabIndex = -1;
  link.setAttribute("href", `${base}${entry.url}${hash}`);
  const page = span("site-search-result-page", entry.title, tokens);
  if (entry.heading !== "" && entry.heading !== entry.title) {
    page.append(span("site-search-result-heading", entry.heading, tokens));
  }
  link.append(page, span("site-search-result-snippet", snippet(entry, tokens), tokens));
  item.append(link);
  return item;
}

/**
 * Mounts the search palette inside a `[data-search]` container, if present.
 * Returns the mounted controller, or `null` when the page has no search UI.
 */
export function mountSearch(root = document) {
  const container = root.querySelector("[data-search]");
  if (container === null) return null;
  const field = container.querySelector("[data-search-field]");
  const input = container.querySelector("#docs-search-input");
  const clear = container.querySelector("[data-search-clear]");
  const panel = container.querySelector("[data-search-panel]");
  const list = container.querySelector("[data-search-results]");
  const empty = container.querySelector("[data-search-empty]");
  const state = { entries: null, loading: null, results: [], active: -1, open: false };

  const ensureIndex = () => {
    if (state.entries !== null) return Promise.resolve(state.entries);
    if (state.loading === null) {
      state.loading = fetch(container.dataset.index ?? "search-index.json")
        .then((response) => response.json())
        .then((data) => {
          state.entries = Array.isArray(data.entries) ? data.entries : [];
          return state.entries;
        })
        .catch(() => {
          state.entries = [];
          return state.entries;
        });
    }
    return state.loading;
  };

  const setActive = (index) => {
    if (state.results.length === 0) return;
    state.active = (index + state.results.length) % state.results.length;
    for (const [position, item] of [...list.children].entries()) {
      const active = position === state.active;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-selected", active ? "true" : "false");
    }
    const option = list.children.item(state.active);
    if (option === null) return;
    input.setAttribute("aria-activedescendant", option.id);
    option.scrollIntoView({ block: "nearest" });
  };

  const render = () => {
    const query = input.value.trim();
    clear.hidden = query === "";
    list.replaceChildren();
    state.active = -1;
    if (query === "") {
      panel.hidden = true;
      empty.hidden = true;
      return;
    }
    state.results = searchIndex(state.entries ?? [], query);
    panel.hidden = false;
    if (state.results.length === 0) {
      empty.hidden = false;
      empty.textContent = `No results for “${query}”`;
      return;
    }
    empty.hidden = true;
    const tokens = tokenize(query);
    for (const [index, entry] of state.results.entries()) {
      list.append(resultItem(container, entry, tokens, index));
    }
    setActive(0);
  };

  const open = () => {
    if (!state.open) {
      state.open = true;
      field.classList.add("is-open");
      input.setAttribute("aria-expanded", "true");
    }
    return ensureIndex().then(render);
  };

  const close = () => {
    state.open = false;
    panel.hidden = true;
    field.classList.remove("is-open");
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };

  // Follow the result link itself, so the browser performs the navigation.
  const navigate = () => {
    list.children.item(state.active)?.querySelector("a")?.click();
  };

  const trapFocus = (event) => {
    const focusable = [input, clear].filter((element) => element !== null && !element.hidden);
    if (focusable.length < 2) return;
    event.preventDefault();
    const delta = event.shiftKey ? -1 : 1;
    const next =
      (focusable.indexOf(document.activeElement) + delta + focusable.length) % focusable.length;
    focusable.at(next)?.focus();
  };

  input.addEventListener("focus", () => void open());
  input.addEventListener("input", () => void open());
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(state.active + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(state.active - 1);
    } else if (event.key === "Enter") {
      if (state.active >= 0) {
        event.preventDefault();
        navigate();
      }
    } else if (event.key === "Escape") {
      if (input.value !== "") {
        input.value = "";
        render();
      } else {
        close();
      }
    } else if (event.key === "Tab") {
      trapFocus(event);
    }
  });

  clear.addEventListener("click", () => {
    input.value = "";
    input.focus();
    render();
  });

  list.addEventListener("mousemove", (event) => {
    const item = event.target.closest(".site-search-result");
    if (item !== null) setActive([...list.children].indexOf(item));
  });

  document.addEventListener("keydown", (event) => {
    const shortcut =
      event.key === "/" || (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey));
    if (!shortcut || isEditable(event.target)) return;
    event.preventDefault();
    input.focus();
    void open();
  });

  document.addEventListener("click", (event) => {
    if (state.open && !container.contains(event.target)) close();
  });

  return { input, open, close, render };
}
