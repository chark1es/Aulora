// Command-palette documentation search for the shared header. The index is
// built at build time into `search-index.json`; this loads it on first use and
// scores it in the browser. Without JavaScript the input stays inert and the
// pages still read.

const MAX_RESULTS = 12;
const SNIPPET_CHARS = 150;

const ESCAPES = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
  ["'", "&#39;"],
]);

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => ESCAPES.get(character));
}

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

function highlight(text, tokens) {
  const pattern = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  if (pattern === "") return escapeHtml(text);
  return escapeHtml(text).replace(new RegExp(`(${pattern})`, "gi"), "<mark>$1</mark>");
}

function resultItem(container, entry, tokens, index) {
  const item = document.createElement("li");
  item.className = "site-search-result";
  item.id = `docs-search-option-${index}`;
  item.setAttribute("role", "option");
  item.setAttribute("aria-selected", "false");
  const base = container.dataset.base ?? "";
  const hash = entry.id === "" ? "" : `#${entry.id}`;
  const heading =
    entry.heading === "" || entry.heading === entry.title
      ? ""
      : `<span class="site-search-result-heading">${highlight(entry.heading, tokens)}</span>`;
  item.innerHTML = `<a tabindex="-1" href="${escapeHtml(`${base}${entry.url}${hash}`)}">
            <span class="site-search-result-page">${highlight(entry.title, tokens)}${heading}</span>
            <span class="site-search-result-snippet">${highlight(snippet(entry, tokens), tokens)}</span>
          </a>`;
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
    const option = list.children[state.active];
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

  const navigate = () => {
    const link = list.children[state.active]?.querySelector("a");
    if (link !== null && link !== undefined) window.location.href = link.href;
  };

  const trapFocus = (event) => {
    const focusable = [input, clear].filter((element) => element !== null && !element.hidden);
    if (focusable.length < 2) return;
    event.preventDefault();
    const delta = event.shiftKey ? -1 : 1;
    const next =
      (focusable.indexOf(document.activeElement) + delta + focusable.length) % focusable.length;
    focusable[next].focus();
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
    const target = event.target;
    const typing =
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
    const shortcut =
      event.key === "/" || (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey));
    if (!shortcut || typing) return;
    event.preventDefault();
    input.focus();
    void open();
  });

  document.addEventListener("click", (event) => {
    if (state.open && !container.contains(event.target)) close();
  });

  return { input, open, close, render };
}
