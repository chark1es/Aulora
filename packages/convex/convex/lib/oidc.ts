/**
 * OIDC group-claim -> Aulora role-name mapping.
 *
 * `OIDC_GROUP_CLAIM` names the IdP claim that carries group membership
 * (for example `groups` in Keycloak or `roles` in Okta). `OIDC_GROUP_ROLE_MAP`
 * is a JSON object mapping an IdP group to one Aulora role name or a list of
 * them: `{"aulora-admins": "Admin", "aulora-mods": ["Mod", "Helper"]}`.
 *
 * The mapping is applied when Better Auth creates the user, so an IdP group
 * can create/attach an Aulora role on first sign-in.
 */

export type GroupRoleMap = Record<string, readonly string[]>;

/** Parses `OIDC_GROUP_ROLE_MAP`; malformed input degrades to an empty map. */
export function parseGroupRoleMap(raw: string | undefined): GroupRoleMap {
  if (raw === undefined) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const result: Record<string, string[]> = {};
  for (const [group, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string") {
      const name = value.trim();
      if (name.length > 0) {
        result[group] = [name];
      }
    } else if (Array.isArray(value)) {
      const names = value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      if (names.length > 0) {
        result[group] = names;
      }
    }
  }
  return result;
}

/**
 * Extracts group names from a provider profile. Accepts an array of strings
 * or a single string that is space- or comma-separated.
 */
export function extractGroups(
  profile: Record<string, unknown>,
  claim: string | undefined,
): string[] {
  if (claim === undefined) {
    return [];
  }
  const value = profile[claim];
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

/** Maps IdP groups to deduplicated Aulora role names, order preserved. */
export function roleNamesForGroups(groups: readonly string[], map: GroupRoleMap): string[] {
  const names = new Set<string>();
  for (const group of groups) {
    const mapped = map[group];
    if (mapped === undefined) {
      continue;
    }
    for (const name of mapped) {
      names.add(name);
    }
  }
  return [...names];
}
