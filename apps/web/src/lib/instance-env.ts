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
      return "Overridden in UI";
    case "environment":
      return "Environment";
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
      return "Set (hidden)";
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
