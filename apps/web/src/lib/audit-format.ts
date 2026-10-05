/**
 * Friendly, human sentences for audit events. The backend now resolves the
 * actor and target to display names; this module turns an opaque action code
 * plus its metadata into a plain sentence ("Ada banned Bob — spam"), and never
 * leaks raw ids or developer-style labels.
 */

/** A readable label for an opaque audit action string. */
export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? humanize(action);
}

/** A coarse grouping used to tint and icon an event. */
export type AuditCategory = "role" | "member" | "category" | "channel" | "server" | "other";

/** The category an action string belongs to, by its `prefix.` namespace. */
export function auditCategory(action: string): AuditCategory {
  const prefix = action.split(".", 1)[0];
  switch (prefix) {
    case "role":
    case "member":
    case "category":
      return prefix;
    case "channel":
      return "channel";
    case "server":
    case "instance":
      return "server";
    default:
      return "other";
  }
}

/** A short, human-scannable stand-in for an opaque id. */
export function shortId(id: string, length = 6): string {
  return id.length <= length ? id : `${id.slice(0, length)}…`;
}

const ACTION_LABELS: Record<string, string> = {
  "role.create": "created a role",
  "role.update": "updated a role",
  "role.delete": "deleted a role",
  "role.reorder": "reordered roles",
  "member.role.add": "gave a member a role",
  "member.role.remove": "removed a role from a member",
  "member.nickname": "changed a nickname",
  "member.timeout": "timed out a member",
  "member.kick": "kicked a member",
  "member.ban": "banned a member",
  "member.unban": "unbanned a member",
  "invite.create": "created an invite",
  "invite.revoke": "revoked an invite",
  "invite.redeem": "redeemed an invite",
  "category.create": "created a category",
  "category.update": "renamed a category",
  "category.delete": "deleted a category",
  "category.setOverrides": "changed category permissions",
  "category.clearOverride": "cleared a category override",
  "channel.create": "created a channel",
  "channel.rename": "renamed a channel",
  "channel.setTopic": "updated a channel topic",
  "channel.archive": "archived a channel",
  "channel.unarchive": "restored a channel",
  "channel.setOverrides": "changed channel permissions",
  "channel.clearOverride": "cleared a channel override",
  "channel.member.add": "added someone to a channel",
  "channel.member.remove": "removed someone from a channel",
  "server.updateSettings": "updated workspace settings",
  "server.updateBranding": "updated the workspace branding",
  "server.setLogo": "changed the workspace logo",
  "instance.storage.update": "updated storage limits",
  "instance.pushRelay.update": "updated the push relay",
  "instance.authProviders.update": "updated sign-in providers",
  "instance.backups.update": "updated backup settings",
  "email.sendTest": "sent a test email",
  "email.settings.update": "updated email settings",
  "license.setKey": "updated the license key",
};

function humanize(action: string): string {
  const words = action.replace(/[._]/g, " ").trim();
  return words.length === 0 ? "did something" : words;
}

const META_LABELS: Record<string, string> = {
  name: "name",
  reason: "reason",
  domain: "domain",
  email: "email",
  kind: "kind",
  position: "position",
  provider: "provider",
};

interface EventNames {
  readonly actorName?: string | null;
  readonly targetName?: string | null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseMeta(meta: string | null): Record<string, unknown> | null {
  if (meta === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(meta) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function changedList(meta: Record<string, unknown>): string[] {
  return Array.isArray(meta.changed)
    ? meta.changed.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function channelCreateDetail(
  meta: Record<string, unknown>,
  fallback: string | null,
): string | null {
  const kind = nonEmpty(meta.kind);
  const isPrivate = meta.private === true;
  const parts = [kind, isPrivate ? "private" : null].filter(
    (entry): entry is string => entry !== null,
  );
  return parts.length > 0 ? parts.join(", ") : fallback;
}

function banDetail(meta: Record<string, unknown>): string | null {
  const reason = nonEmpty(meta.reason);
  const expiresAt = typeof meta.expiresAt === "number" ? meta.expiresAt : null;
  const parts = [
    reason,
    expiresAt !== null ? `until ${new Date(expiresAt).toLocaleDateString()}` : null,
  ].filter((entry): entry is string => entry !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function inviteDetail(meta: Record<string, unknown>): string | null {
  const expiresAt = typeof meta.expiresAt === "number" ? meta.expiresAt : null;
  return expiresAt !== null ? `expires ${new Date(expiresAt).toLocaleDateString()}` : null;
}

function metaDetail(action: string, meta: Record<string, unknown> | null): string | null {
  if (meta === null) {
    return null;
  }
  const name = nonEmpty(meta.name);
  const changed = changedList(meta);
  switch (action) {
    case "role.create":
    case "role.delete":
    case "category.create":
    case "category.update":
    case "category.delete":
    case "channel.rename":
    case "channel.setTopic":
    case "member.nickname":
      return name !== null ? name : null;
    case "role.update":
      return changed.length > 0 ? changed.join(", ") : name;
    case "server.updateSettings":
    case "instance.authProviders.update":
      return changed.length > 0 ? changed.join(", ") : null;
    case "channel.create":
      return channelCreateDetail(meta, name);
    case "member.ban":
      return banDetail(meta);
    case "member.timeout":
      return typeof meta.until === "number"
        ? `until ${new Date(meta.until).toLocaleString()}`
        : "cleared";
    case "invite.create":
      return inviteDetail(meta);
    default: {
      const keys = Object.keys(meta).filter((key) => META_LABELS[key] !== undefined);
      return keys.length > 0 ? null : null;
    }
  }
}

/**
 * A friendly sentence for one audit event: the actor, what they did and the
 * resolved target or metadata detail. Unknown actions fall back to a readable
 * humanized phrase rather than the raw code.
 */
export function formatAuditEvent(
  action: string,
  meta: string | null,
  names: EventNames = {},
): string {
  const actor = nonEmpty(names.actorName) ?? "Someone";
  const label = auditActionLabel(action);
  const target = nonEmpty(names.targetName);
  const detail = metaDetail(action, parseMeta(meta));
  const bits: string[] = [`${actor} ${label}`];
  if (target !== null) {
    bits.push(target);
  }
  if (detail !== null) {
    bits.push(detail);
  }
  return bits.join(" · ");
}

/**
 * Meta-only summary, retained for callers that have not resolved names yet.
 * `formatAuditEvent` is preferred wherever actor/target names are available.
 */
export function describeAuditAction(action: string, meta: string | null): string {
  const label = auditActionLabel(action);
  const detail = metaDetail(action, parseMeta(meta));
  return detail === null ? capitalize(label) : `${capitalize(label)}: ${detail}`;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}
