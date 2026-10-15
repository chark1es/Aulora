// Filter box for the generated environment-variable reference. Each row carries
// its key, label and description in `data-search`; typing narrows the rows and
// hides any group left empty. Progressive: without JavaScript every row shows.

function matches(haystack, tokens) {
  return tokens.every((token) => haystack.includes(token));
}

/** Mounts the filter inside a `[data-env-filter]` box, if present. */
export function mountEnvFilter(root = document) {
  const input = root.querySelector("[data-env-filter]");
  if (input === null) return null;
  const groups = [...root.querySelectorAll("[data-env-group]")];
  const variables = [...root.querySelectorAll("[data-env-var]")];
  const empty = root.querySelector("[data-env-empty]");
  const clear = root.querySelector("[data-env-filter-clear]");

  const apply = () => {
    const tokens = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const variable of variables) {
      const match = matches(variable.dataset.search ?? "", tokens);
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
