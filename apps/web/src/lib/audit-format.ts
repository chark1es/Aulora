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
  "channel.setMlsGroupId": "Initialized channel encryption",
  "server.updateSettings": "Updated workspace settings",
};

/** A readable label for an opaque audit action string. */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

/**
 * A one-line, non-leaky summary. Metadata is opaque JSON produced by the
 * server; anything that fails to parse is ignored rather than shown raw.
 */
export function describeAuditAction(action: string, meta: string | null): string {
  const label = auditActionLabel(action);
  if (meta === null) {
    return label;
  }
  try {
    const parsed = JSON.parse(meta) as unknown;
    if (parsed !== null && typeof parsed === "object") {
      const entries = Object.entries(parsed as Record<string, unknown>)
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([key, value]) => `${key}: ${String(value)}`);
      if (entries.length > 0) {
        return `${label} (${entries.join(", ")})`;
      }
    }
  } catch {
    // Ignore unparseable metadata.
  }
  return label;
}
