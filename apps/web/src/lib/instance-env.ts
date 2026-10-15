import type { TextTone } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../packages/convex/convex/_generated/api";

/**
 * View helpers and data hook for the instance admin Environment section. The
 * server owns the catalog, the allowlist and every validation; this module only
 * formats what Convex returned (it never sees deployment environment values)
 * and mirrors the discovery-URL shape check for a faster form.
 */

export type EnvVariablesResult = FunctionReturnType<typeof api.envOverrides.list>;
export type EnvVariable = EnvVariablesResult["variables"][number];
export type EnvSource = EnvVariable["source"];
export type EnvVariablesModel = EnvVariablesResult;

/** Loads the catalog and returns the override mutations for the owner. */
export function useEnvOverrides() {
  const data = useQuery(api.envOverrides.list, {});
  const setValue = useMutation(api.envOverrides.set);
  const setGroup = useMutation(api.envOverrides.setMany);
  const resetValue = useMutation(api.envOverrides.clear);
  return { data, setValue, setGroup, resetValue };
}

export function envSourceLabel(source: EnvSource): string {
  switch (source) {
    case "ui":
      return "Overridden";
    case "environment":
      return "Deployment";
    default:
      return "Not set";
  }
}

export function envSourceTone(source: EnvSource): TextTone {
  switch (source) {
    case "ui":
      return "accent";
    case "environment":
      return "secondary";
    default:
      return "muted";
  }
}

/**
 * Human summary of a variable's value. Deployment values are never rendered in
 * any form; a UI secret is only reported as set.
 */
export function envValueLabel(variable: EnvVariable): string {
  if (variable.source === "ui") {
    if (variable.secret) {
      return "••••••";
    }
    return variable.value !== undefined && variable.value.length > 0 ? variable.value : "Set";
  }
  if (variable.source === "environment") {
    return "Set by the deployment (value hidden)";
  }
  return "Not set";
}

/** Explanation shown on rows the deployment owns. */
export function envManagedReason(variable: EnvVariable): string | null {
  if (variable.overridable) {
    return null;
  }
  if (variable.managedInSection !== null) {
    return `Managed in the ${variable.managedInSection} section.`;
  }
  return "Managed by the deployment; changing it from here could lock everyone out.";
}

export function envValuePlaceholder(variable: EnvVariable): string {
  if (variable.secret) {
    return "Set — enter a new value to replace";
  }
  switch (variable.type) {
    case "url":
      return "https://example.com";
    case "number":
      return "e.g. 8";
    case "list":
      return "openid profile email";
    case "json":
      return variable.key === "AULORA_ICE_SERVERS"
        ? '[{"urls":["stun:stun.example.com:3478"]}]'
        : '{"admins":"Admin"}';
    default:
      return "Enter a value";
  }
}

export interface OidcFormValues {
  readonly displayName: string;
  readonly issuer: string;
  readonly discoveryUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scopes: string;
  readonly groupClaim: string;
  readonly groupRoleMap: string;
}

export const EMPTY_OIDC_FORM: OidcFormValues = {
  displayName: "",
  issuer: "",
  discoveryUrl: "",
  clientId: "",
  clientSecret: "",
  scopes: "openid profile email",
  groupClaim: "",
  groupRoleMap: "",
};

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

/** Client-side discovery-URL check; the server repeats the https rule. */
export function discoveryUrlError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "Enter the discovery URL";
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "Enter an absolute URL";
  }
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && isLocalHostname(parsed.hostname))
  ) {
    return "Use an https URL (http is allowed only for localhost)";
  }
  if (!parsed.pathname.endsWith("/.well-known/openid-configuration")) {
    return "The URL should end with /.well-known/openid-configuration";
  }
  return null;
}

/** Non-empty fields of the group form, as `setMany` entries. */
export function buildOidcEntries(values: OidcFormValues): { key: string; value: string }[] {
  const entries = [
    { key: "OIDC_ISSUER", value: values.issuer.trim() },
    { key: "OIDC_DISCOVERY_URL", value: values.discoveryUrl.trim() },
    { key: "OIDC_CLIENT_ID", value: values.clientId.trim() },
    { key: "OIDC_CLIENT_SECRET", value: values.clientSecret },
    { key: "OIDC_DISPLAY_NAME", value: values.displayName.trim() },
    { key: "OIDC_SCOPES", value: values.scopes.trim() },
    { key: "OIDC_GROUP_CLAIM", value: values.groupClaim.trim() },
    { key: "OIDC_GROUP_ROLE_MAP", value: values.groupRoleMap.trim() },
  ];
  return entries.filter((entry) => entry.value.length > 0);
}

/** Prefills the group form from UI-saved values; secrets stay blank. */
export function oidcFormFromVariables(variables: readonly EnvVariable[]): OidcFormValues {
  const savedValue = (key: string): string => {
    const variable = variables.find((candidate) => candidate.key === key);
    return variable?.value ?? "";
  };
  return {
    displayName: savedValue("OIDC_DISPLAY_NAME"),
    issuer: savedValue("OIDC_ISSUER"),
    discoveryUrl: savedValue("OIDC_DISCOVERY_URL"),
    clientId: savedValue("OIDC_CLIENT_ID"),
    clientSecret: "",
    scopes: savedValue("OIDC_SCOPES") || "openid profile email",
    groupClaim: savedValue("OIDC_GROUP_CLAIM"),
    groupRoleMap: savedValue("OIDC_GROUP_ROLE_MAP"),
  };
}

export type EnvVarFormat = "ice-servers" | "group-role-map";

/** Catalog metadata the list query does not return, mirrored for the editor. */
export interface EnvFieldMeta {
  readonly format: EnvVarFormat | null;
  readonly min: number | null;
  readonly max: number | null;
  readonly step: number;
  readonly unit: string | null;
  readonly defaultValue: string | null;
}

const DEFAULT_FIELD_META: EnvFieldMeta = {
  format: null,
  min: null,
  max: null,
  step: 1,
  unit: null,
  defaultValue: null,
};

// Mirrors the bounds and formats declared in `packages/convex/convex/lib/envCatalog*`.
const ENV_FIELD_META = new Map<string, Partial<EnvFieldMeta>>([
  ["AUTH_MIN_PASSWORD_LENGTH", { min: 1, max: 128, unit: "characters", defaultValue: "8" }],
  [
    "AUTH_RATE_LIMIT_MAX",
    { min: 1, max: 100000, unit: "requests per minute", defaultValue: "120" },
  ],
  ["OIDC_SCOPES", { defaultValue: "openid profile email" }],
  ["OIDC_GROUP_ROLE_MAP", { format: "group-role-map" }],
  ["AULORA_ICE_SERVERS", { format: "ice-servers" }],
]);

/** Bounds, unit and structural format for a variable, with safe defaults. */
export function envFieldMeta(variable: EnvVariable): EnvFieldMeta {
  return { ...DEFAULT_FIELD_META, ...(ENV_FIELD_META.get(variable.key) ?? {}) };
}

const ENV_MAX_VALUE_LENGTH = 8192;
const ENV_MAX_LIST_ITEMS = 64;
const ENV_MAX_LIST_ITEM_LENGTH = 256;

function envUrlError(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "Enter an absolute URL";
  }
  const host = parsed.hostname;
  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  if (/^(169\.254\.|\[?fe80:)/i.test(host)) {
    return "Link-local addresses are not allowed";
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocal)) {
    return "Use an https URL (http is allowed only for localhost)";
  }
  return null;
}

function envNumberError(variable: EnvVariable, value: string): string | null {
  if (!/^\d+$/.test(value)) {
    return "Enter a whole number";
  }
  const meta = envFieldMeta(variable);
  const parsed = Number(value);
  if (meta.min !== null && parsed < meta.min) {
    return `Must be at least ${meta.min}`;
  }
  if (meta.max !== null && parsed > meta.max) {
    return `Must be at most ${meta.max}`;
  }
  return null;
}

function envListError(value: string): string | null {
  const items = parseEnvList(value);
  if (items.length === 0) {
    return "Enter at least one value";
  }
  if (items.length > ENV_MAX_LIST_ITEMS) {
    return `Use at most ${ENV_MAX_LIST_ITEMS} values`;
  }
  if (items.some((item) => item.length > ENV_MAX_LIST_ITEM_LENGTH)) {
    return `Each value must be at most ${ENV_MAX_LIST_ITEM_LENGTH} characters`;
  }
  return null;
}

export function parseEnvList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function serializeEnvList(items: readonly string[]): string {
  return items.join(" ");
}

function parseJson(value: string):
  | { readonly ok: true; readonly parsed: unknown }
  | {
      readonly ok: false;
      readonly error: string;
    } {
  try {
    return { ok: true, parsed: JSON.parse(value) as unknown };
  } catch {
    return { ok: false, error: "Enter valid JSON" };
  }
}

function envIceServersError(parsed: unknown): string | null {
  if (!Array.isArray(parsed)) {
    return "Enter a JSON array of ICE servers";
  }
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) {
      return "Each ICE server must be an object with urls";
    }
    const urls = (entry as Record<string, unknown>).urls;
    const list = Array.isArray(urls) ? urls : [urls];
    if (!list.some((url) => typeof url === "string" && url.trim().length > 0)) {
      return "Each ICE server needs at least one URL";
    }
  }
  return null;
}

function envGroupRoleMapError(parsed: unknown): string | null {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return "Enter a JSON object mapping groups to role names";
  }
  for (const value of Object.values(parsed as Record<string, unknown>)) {
    const names = Array.isArray(value) ? value : [value];
    if (!names.some((name) => typeof name === "string" && name.trim().length > 0)) {
      return "Each group must map to a role name or a list of role names";
    }
  }
  return null;
}

function envJsonError(variable: EnvVariable, value: string): string | null {
  const result = parseJson(value);
  if (!result.ok) {
    return result.error;
  }
  const { parsed } = result;
  if (parsed === null || typeof parsed !== "object") {
    return "Enter a JSON object or array";
  }
  const format = envFieldMeta(variable).format;
  if (format === "ice-servers") {
    return envIceServersError(parsed);
  }
  if (format === "group-role-map") {
    return envGroupRoleMapError(parsed);
  }
  return null;
}

/** Client-side value check mirroring the server's per-type validation. */
export function envValueError(variable: EnvVariable, rawValue: string): string | null {
  const value = rawValue.trim();
  if (value.length === 0) {
    return "Enter a value";
  }
  if (value.length > ENV_MAX_VALUE_LENGTH) {
    return `Values must be at most ${ENV_MAX_VALUE_LENGTH} characters`;
  }
  switch (variable.type) {
    case "url":
      return envUrlError(value);
    case "number":
      return envNumberError(variable, value);
    case "boolean":
      return value === "true" || value === "false" ? null : "Choose Enabled or Disabled";
    case "enum": {
      const allowed = variable.enumValues ?? [];
      return allowed.includes(value) ? null : `Choose one of: ${allowed.join(", ")}`;
    }
    case "list":
      return envListError(value);
    case "json":
      return envJsonError(variable, value);
    case "string":
      return null;
  }
}

/** Pretty-prints a JSON string, or returns null when it is not valid JSON. */
export function prettyJson(value: string): string | null {
  const result = parseJson(value);
  return result.ok ? JSON.stringify(result.parsed, null, 2) : null;
}

export type EnvFilter = "all" | "overridden" | "overridable" | "read-only";

export const ENV_FILTERS: readonly { readonly id: EnvFilter; readonly label: string }[] = [
  { id: "all", label: "All" },
  { id: "overridden", label: "Overridden" },
  { id: "overridable", label: "Overridable" },
  { id: "read-only", label: "Read-only" },
];

export interface EnvGroupSummary {
  readonly id: string;
  readonly label: string;
  readonly total: number;
  readonly overridden: number;
}

/** Per-group totals plus the count of UI overrides, for the navigation. */
export function envGroupSummaries(
  groups: readonly { readonly id: string; readonly label: string }[],
  variables: readonly EnvVariable[],
): EnvGroupSummary[] {
  const counts = new Map<string, { total: number; overridden: number }>();
  for (const variable of variables) {
    const current = counts.get(variable.group) ?? { total: 0, overridden: 0 };
    current.total += 1;
    if (variable.source === "ui") {
      current.overridden += 1;
    }
    counts.set(variable.group, current);
  }
  return groups.map((group) => {
    const count = counts.get(group.id) ?? { total: 0, overridden: 0 };
    return { id: group.id, label: group.label, total: count.total, overridden: count.overridden };
  });
}

/** The first group that actually has variables, so the view never opens empty. */
export function firstEnvGroup(summaries: readonly EnvGroupSummary[]): string {
  return summaries.find((summary) => summary.total > 0)?.id ?? summaries.at(0)?.id ?? "";
}

function envMatchesFilter(variable: EnvVariable, filter: EnvFilter): boolean {
  switch (filter) {
    case "overridden":
      return variable.source === "ui";
    case "overridable":
      return variable.overridable;
    case "read-only":
      return !variable.overridable;
    case "all":
      return true;
  }
}

export function envVariableMatchesQuery(variable: EnvVariable, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return true;
  }
  return [variable.key, variable.label, variable.description, variable.type].some((part) =>
    part.toLowerCase().includes(needle),
  );
}

export interface EnvGroupBlock {
  readonly id: string;
  readonly label: string;
  readonly variables: EnvVariable[];
}

/**
 * Chooses which variables to render. With no query and the `all` filter only the
 * selected group is returned; searching or filtering widens the view to every
 * group, so a match is never hidden behind the navigation.
 */
export function selectEnvBlocks(input: {
  readonly groups: readonly { readonly id: string; readonly label: string }[];
  readonly variables: readonly EnvVariable[];
  readonly activeGroup: string;
  readonly query: string;
  readonly filter: EnvFilter;
}): readonly EnvGroupBlock[] {
  const searchActive = input.query.trim().length > 0 || input.filter !== "all";
  const groups = searchActive
    ? input.groups
    : input.groups.filter((group) => group.id === input.activeGroup);
  return groups
    .map((group) => ({
      id: group.id,
      label: group.label,
      variables: input.variables.filter(
        (variable) =>
          variable.group === group.id &&
          envMatchesFilter(variable, input.filter) &&
          envVariableMatchesQuery(variable, input.query),
      ),
    }))
    .filter((block) => block.variables.length > 0);
}
