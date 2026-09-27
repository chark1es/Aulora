/** Human labels for the audit actions the server records. */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  "role.create": "Created role",
  "role.update": "Updated role",
  "role.delete": "Deleted role",
  "role.reorder": "Reordered roles",
  "member.role.add": "Added member role",
  "member.role.remove": "Removed member role",
  "member.nickname": "Changed nickname",
  "member.timeout": "Set timeout",
  "member.kick": "Kicked member",
  "member.ban": "Banned member",
  "member.unban": "Unbanned member",
  "invite.create": "Created invite",
  "invite.revoke": "Revoked invite",
  "invite.redeem": "Redeemed invite",
  "category.create": "Created category",
  "category.update": "Updated category",
  "category.delete": "Deleted category",
  "category.setOverrides": "Set category overrides",
  "category.clearOverride": "Cleared category override",
  "channel.create": "Created channel",
  "channel.rename": "Renamed channel",
  "channel.setTopic": "Set channel topic",
  "channel.archive": "Archived channel",
  "channel.unarchive": "Unarchived channel",
  "channel.setOverrides": "Set channel overrides",
  "channel.clearOverride": "Cleared channel override",
  "channel.join": "Joined channel",
  "channel.leave": "Left channel",
  "channel.member.add": "Added channel member",
  "channel.member.remove": "Removed channel member",
  "channel.createDm": "Opened a direct message",
  "channel.createGroupDm": "Opened a group message",
  "server.updateSettings": "Updated workspace settings",
};

/** A readable label for an opaque audit action string. */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
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
      return "server";
    default:
      return "other";
  }
}

/** A short, human-scannable stand-in for an opaque id. */
export function shortId(id: string, length = 6): string {
  return id.length <= length ? id : `${id.slice(0, length)}…`;
}

/**
 * Formats one metadata value. Known scalar keys get friendly copy; opaque ids
 * (roleId, userId, targetId, …) return `null` so they are never surfaced raw.
 */
function formatMetaValue(key: string, value: unknown): string | null {
  switch (key) {
    case "name":
      return typeof value === "string" && value.length > 0 ? value : null;
    case "reason":
      return typeof value === "string" && value.length > 0 ? `Reason: ${value}` : null;
    case "changed":
      return Array.isArray(value) && value.length > 0
        ? `Changed ${value.filter((entry) => typeof entry === "string").join(", ")}`
        : null;
    case "kind":
      return typeof value === "string" ? `Kind: ${value}` : null;
    case "private":
      return typeof value === "boolean" ? (value ? "Private" : "Public") : null;
    case "count":
      return typeof value === "number" ? `${value} item${value === 1 ? "" : "s"}` : null;
    case "position":
      return typeof value === "number" ? `Position ${value}` : null;
    case "targetType":
      return value === "role" || value === "member" ? `Target: ${value}` : null;
    case "until":
      if (value === null) {
        return "Cleared";
      }
      return typeof value === "number" ? `Until ${new Date(value).toLocaleString()}` : null;
    default:
      return null;
  }
}

/**
 * A one-line, non-leaky summary. Metadata is opaque JSON produced by the
 * server; unknown keys (including raw ids) are dropped rather than shown, and
 * anything that fails to parse is ignored.
 */
export function describeAuditAction(action: string, meta: string | null): string {
  const label = auditActionLabel(action);
  if (meta === null) {
    return label;
  }
  try {
    const parsed = JSON.parse(meta) as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const parts: string[] = [];
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        const formatted = formatMetaValue(key, value);
        if (formatted !== null) {
          parts.push(formatted);
        }
      }
      if (parts.length > 0) {
        return `${label} (${parts.join(", ")})`;
      }
    }
  } catch {
    // Ignore unparseable metadata.
  }
  return label;
}
