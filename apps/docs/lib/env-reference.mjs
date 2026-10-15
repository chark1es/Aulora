// Builds the "Environment variables" documentation page from the server's
// environment catalog plus the hand-maintained extras that live outside it.
// Rendering HTML (rather than Markdown) lets the page carry the copy buttons,
// badges and the filter box the CSS and static/env-filter.js expect.

import { escapeHtml } from "./markdown.mjs";

/** Content file name for the generated page, shared with the build. */
export const ENV_REFERENCE_PAGE = "environment-variables.md";

/** Page title, also used for the document head. */
export const ENV_REFERENCE_TITLE = "Environment variables";

const INTRO_HTML =
  "Operators configure Aulora with environment variables. The Docker stack reads most of them from " +
  "<code>infra/docker/.env</code>; the workspace owner can override a curated set from Instance admin, " +
  "and those saved values win over the deployment. This page is generated from the server's environment " +
  "catalog, so it lists every variable the app reads.";

const SETUP_HTML = `    <h2 id="how-variables-are-set">How variables are set</h2>
    <ul>
      <li><strong><code>infra/docker/.env</code></strong> is the deployment environment. <code>setup</code> generates the missing secrets and writes them back there. This file and Compose are where bootstrap and security settings live.</li>
      <li><strong>Compose and host ports</strong> come from the same <code>.env</code>; the stack maps them into each container.</li>
      <li><strong>Instance admin → Environment</strong> lets the workspace owner override a curated set without editing the file. Overrides live in the workspace database, sealed with the server encryption key, and win over the deployment value. Deployment values are never shown, and secrets typed there are write-only.</li>
      <li><strong>Precedence:</strong> an admin override beats the deployment environment for a key that allows overrides; everything else comes from the deployment. Overriding any key in a credential group (OIDC or a social provider's id and secret) stops that group's deployment values from applying, so a deployment secret is never paired with an endpoint the owner chose. Overrides apply on the next request, with no restart.</li>
      <li><strong>Disable overrides</strong> with <code>AULORA_ALLOW_UI_ENV_OVERRIDES=false</code> in <code>.env</code>, then re-run <code>docker compose run --rm setup</code>.</li>
    </ul>
    <p>Bootstrap and security variables such as <code>BETTER_AUTH_SECRET</code>, the encryption keys and <code>SITE_URL</code> are read-only in the panel. Keep credentials that should never change in <code>.env</code>. See <a href="self-hosting">self-hosting</a> and <a href="admin">Admin panel</a>.</p>`;

function badge(text, kind) {
  return `<span class="env-badge env-badge-${kind}">${escapeHtml(text)}</span>`;
}

function metaItem(label, value) {
  return `        <div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`;
}

function codeList(values) {
  return values.map((value) => `<code>${escapeHtml(value)}</code>`).join(" ");
}

function rangeText(variable) {
  if (variable.min === undefined && variable.max === undefined) return null;
  const max =
    typeof variable.max === "number" && variable.max >= Number.MAX_SAFE_INTEGER
      ? "∞"
      : `${variable.max}`;
  if (variable.min === undefined) return `up to ${max}`;
  if (variable.max === undefined) return `${variable.min} or more`;
  return `${variable.min}–${max}`;
}

function setInHtml(variable) {
  if (variable.managedInSection !== undefined) {
    return `Instance admin → ${escapeHtml(variable.managedInSection)}; the deployment environment is the fallback`;
  }
  if (variable.overridable === true) {
    return "<code>infra/docker/.env</code>, overridable in Instance admin → Environment";
  }
  if (variable.internal === true) {
    return "Internal; normally left at its default";
  }
  return "<code>infra/docker/.env</code> or the compose environment";
}

function badgesFor(variable) {
  const badges = [];
  if (variable.secret === true) badges.push(badge("Secret", "secret"));
  if (variable.overridable === true) badges.push(badge("Overridable in admin UI", "overridable"));
  if (variable.internal === true) badges.push(badge("Internal", "internal"));
  return badges.join("");
}

function metaFor(variable) {
  const items = [metaItem("Type", `<code>${escapeHtml(variable.type)}</code>`)];
  items.push(metaItem("Required", variable.required === true ? "Required with SSO" : "Optional"));
  if (variable.default !== undefined) {
    items.push(metaItem("Default", `<code>${escapeHtml(variable.default)}</code>`));
  }
  if (Array.isArray(variable.enumValues) && variable.enumValues.length > 0) {
    items.push(metaItem("Values", codeList(variable.enumValues)));
  }
  const range = rangeText(variable);
  if (range !== null) items.push(metaItem("Range", escapeHtml(range)));
  items.push(metaItem("Set in", setInHtml(variable)));
  return items.join("\n");
}

function searchText(variable) {
  return [variable.key, variable.label, variable.group ?? "", variable.description]
    .join(" ")
    .toLowerCase()
    .replaceAll('"', "");
}

function renderVariable(variable) {
  const id = `env-${variable.key}`;
  const head = `<code class="env-key" id="${escapeHtml(id)}">${escapeHtml(variable.key)}</code>`;
  return `      <div class="env-var" data-env-var data-search="${escapeHtml(searchText(variable))}">
        <div class="env-var-head">
          ${head}
          <button type="button" class="env-copy" data-copy="${escapeHtml(id)}">Copy</button>
          <span class="env-badges">${badgesFor(variable)}</span>
        </div>
        <p class="env-desc">${escapeHtml(variable.description)}</p>
        <dl class="env-meta">
${metaFor(variable)}
        </dl>
      </div>`;
}

function renderGroup(group, variables) {
  return `    <section class="env-group" data-env-group>
      <h2 id="${escapeHtml(group.id)}">${escapeHtml(group.label)}</h2>
${variables.map(renderVariable).join("\n")}
    </section>`;
}

function filterBox(renderIcon) {
  return `    <div class="env-filter">
      <span class="env-filter-icon">${renderIcon("search")}</span>
      <label class="visually-hidden" for="env-filter">Filter environment variables</label>
      <input id="env-filter" type="search" data-env-filter autocomplete="off" spellcheck="false" placeholder="Filter by name, group or description" />
      <button type="button" class="env-filter-clear" data-env-filter-clear aria-label="Clear filter" hidden>${renderIcon("x")}</button>
    </div>
    <p class="env-empty" data-env-empty hidden>No environment variables match that filter.</p>`;
}

function normalizeCatalog(entry, required) {
  return { ...entry, required: required.has(entry.key), internal: false };
}

/** Assembles, in order, every group that has at least one variable. */
export function buildGroups(catalog, extras) {
  const required = new Set(catalog.required ?? []);
  const groups = [...catalog.groups, ...extras.groups];
  const variables = [
    ...catalog.variables.map((entry) => normalizeCatalog(entry, required)),
    ...extras.variables,
  ];
  return groups
    .map((group) => ({
      group,
      variables: variables.filter((variable) => variable.group === group.id),
    }))
    .filter((entry) => entry.variables.length > 0);
}

/**
 * Renders the page body. `renderIcon` draws a token icon (`iconSvg` bound to
 * the parsed icon set). Returns `{ title, html }` like `renderMarkdown`.
 */
export function renderEnvReference(catalog, extras, renderIcon) {
  const sections = buildGroups(catalog, extras)
    .map((entry) => renderGroup(entry.group, entry.variables))
    .join("\n");
  return {
    title: ENV_REFERENCE_TITLE,
    html: `    <p>${INTRO_HTML}</p>
${SETUP_HTML}
${filterBox(renderIcon)}
${sections}`,
  };
}
