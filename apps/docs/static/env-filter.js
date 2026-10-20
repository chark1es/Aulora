// Filter box for the generated environment-variable reference. The haystack is
// built from each row's own text (key, description and metadata) plus its group
// id, so the page does not carry a duplicate copy of every field in a
// `data-search` attribute. Typing narrows the rows and hides any group left
// empty. Progressive: without JavaScript every row shows.

function matches(haystack, tokens) {
  return tokens.every((token) => haystack.includes(token));
}

/** Lowercased haystack for a row, built once and cached on the element. */
function haystackFor(variable, cache) {
  const cached = cache.get(variable);
  if (cached !== undefined) return cached;
  const group = variable.closest("[data-env-group]")?.querySelector("h2");
  const text = `${variable.textContent} ${group?.id ?? ""}`.toLowerCase();
  cache.set(variable, text);
  return text;
}

/** Mounts the filter inside a `[data-env-filter]` box, if present. */
export function mountEnvFilter(root = document) {
  const input = root.querySelector("[data-env-filter]");
  if (input === null) return null;
  const groups = [...root.querySelectorAll("[data-env-group]")];
  const variables = [...root.querySelectorAll("[data-env-var]")];
  const empty = root.querySelector("[data-env-empty]");
  const clear = root.querySelector("[data-env-filter-clear]");
  const haystacks = new WeakMap();

  const apply = () => {
    const tokens = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const variable of variables) {
      const match = matches(haystackFor(variable, haystacks), tokens);
      variable.hidden = !match;
      if (match) shown += 1;
    }
    for (const group of groups) {
      group.hidden = group.querySelector("[data-env-var]:not([hidden])") === null;
    }
    if (empty !== null) empty.hidden = shown !== 0;
    if (clear !== null) clear.hidden = input.value === "";
  };

  input.addEventListener("input", apply);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && input.value !== "") {
      input.value = "";
      apply();
    }
  });
  clear?.addEventListener("click", () => {
    input.value = "";
    input.focus();
    apply();
  });

  apply();
  return { input, apply };
}
