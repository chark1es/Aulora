/**
 * Friendly, human sentences and detail fields for audit events. The backend
 * resolves the actor and target to display names; this module turns an opaque
 * action code plus its metadata into a plain sentence ("Ada banned Bob — spam")
 * and a structured set of fields for the event-detail dialog. Raw ids and
 * developer-style labels are hidden unless no display name can be resolved.
 */

import { formatBytes, formatQuota } from "./instance-admin";

/** A readable label for an opaque audit action string. */
export function auditActionLabel(action: string): string {
  return addonActionLabel(action) ?? ACTION_LABEL_MAP.get(action) ?? humanize(action);
}

/** A coarse grouping used to tint and icon an event. */
export type AuditCategory =
  | "role"
  | "member"
  | "invite"
  | "message"
  | "category"
  | "channel"
  | "kanban"
  | "notes"
  | "call"
  | "bot"
  | "server"
  | "other";

/** The category an action string belongs to, by its `prefix.` namespace. */
export function auditCategory(action: string): AuditCategory {
  const prefix = action.split(".", 1)[0] ?? "";
  switch (prefix) {
    case "role":
    case "member":
    case "invite":
    case "message":
    case "category":
    case "channel":
    case "kanban":
    case "bot":
      return prefix;
    case "workspaceNotes":
      return "notes";
    case "guestCall":
    case "scheduledCall":
    case "transcription":
      return "call";
    case "allowlist":
      return "invite";
    case "webhook":
      return "channel";
    case "server":
    case "instance":
    case "email":
    case "license":
    case "addons":
    case "setup":
      return "server";
    case "owner":
      return "member";
    default:
      return "other";
  }
}

/** A short, human-scannable stand-in for an opaque id. */
export function shortId(id: string, length = 6): string {
  return id.length <= length ? id : `${id.slice(0, length)}…`;
}

/** A display name for an actor, falling back for synthetic/system actors. */
export function auditActorLabel(name: string | null | undefined, id: string): string {
  const resolved = nonEmpty(name);
  if (resolved !== null) {
    return resolved;
  }
  if (id === "system") {
    return "System";
  }
  if (id.startsWith("setup:")) {
    return "Setup";
  }
  return shortId(id);
}

/** The target kind for actions whose exact target has no display name. */
const TARGET_KINDS: ReadonlyArray<readonly [readonly string[], string]> = [
  [["role."], "Role"],
  [["member.", "owner."], "Member"],
  [["invite.", "allowlist."], "Invite"],
  [["message."], "Message"],
  [["category."], "Category"],
  [["channel."], "Channel"],
  [["webhook."], "Webhook"],
  [["kanban."], "Kanban board"],
  [["workspaceNotes."], "Workspace"],
  [["transcription."], "Transcription"],
  [["scheduledCall."], "Scheduled call"],
  [["guestCall."], "Guest session"],
  [["bot."], "Bot"],
  [["server.", "instance.", "addons.", "setup.", "email.", "license."], "Workspace"],
];

const SPECIAL_TARGET_KINDS: Record<string, string> = {
  "kanban.deleteCard": "Kanban card",
  "workspaceNotes.deleteFolder": "Notes folder",
  "workspaceNotes.deleteTag": "Note tag",
  "workspaceNotes.deleteNote": "Note",
  "guestCall.createLink": "Guest link",
  "guestCall.revokeLink": "Guest link",
};

/** The kind of target an action usually affects, for actions whose name is gone. */
export function auditTargetKind(action: string): string | null {
  const special = SPECIAL_TARGET_KINDS[action];
  if (special !== undefined) {
    return special;
  }
  for (const [prefixes, kind] of TARGET_KINDS) {
    if (prefixes.some((prefix) => action.startsWith(prefix))) {
      return kind;
    }
  }
  return null;
}

const ACTION_LABELS: Record<string, string> = {
  // Roles
  "role.create": "created a role",
  "role.update": "updated a role",
  "role.delete": "deleted a role",
  "role.reorder": "reordered roles",
  // Members
  "member.role.add": "gave a member a role",
  "member.role.remove": "removed a role from a member",
  "member.nickname": "changed a nickname",
  "member.timeout": "timed out a member",
  "member.kick": "kicked a member",
  "member.ban": "banned a member",
  "member.unban": "unbanned a member",
  // Messages
  "message.edit": "edited a message",
  "message.delete": "deleted a message",
  // Invites and the allowlist
  "invite.create": "created an invite",
  "invite.revoke": "revoked an invite",
  "invite.delete": "deleted an invite",
  "invite.redeem": "redeemed an invite",
  "allowlist.add": "added to the invite allowlist",
  "allowlist.remove": "removed from the invite allowlist",
  "allowlist.join": "joined from the allowlist",
  // Categories
  "category.create": "created a category",
  "category.update": "renamed a category",
  "category.delete": "deleted a category",
  "category.reorder": "reordered categories",
  "category.setOverrides": "changed category permissions",
  "category.clearOverride": "cleared a category override",
  // Channels
  "channel.create": "created a channel",
  "channel.reorder": "reordered channels",
  "channel.rename": "renamed a channel",
  "channel.setTopic": "updated a channel topic",
  "channel.setPrivate": "changed channel privacy",
  "channel.setBlocked": "updated blocked members",
  "channel.archive": "archived a channel",
  "channel.unarchive": "restored a channel",
  "channel.setOverrides": "changed channel permissions",
  "channel.clearOverride": "cleared a channel override",
  "channel.member.add": "added someone to a channel",
  "channel.member.remove": "removed someone from a channel",
  // Webhooks
  "webhook.create": "created a webhook",
  "webhook.update": "updated a webhook",
  "webhook.token.rotate": "replaced a webhook URL",
  "webhook.delete": "deleted a webhook",
  // Workspace
  "server.updateSettings": "updated workspace settings",
  "server.updateBranding": "updated the workspace branding",
  "server.setLogo": "changed the workspace logo",
  // Instance
  "instance.storage.update": "updated storage limits",
  "instance.pushRelay.update": "updated the push relay",
  "instance.authProviders.update": "changed sign-in providers",
  "instance.backups.update": "updated backup settings",
  "instance.backup.request": "requested a backup",
  "instance.env.override": "updated an environment variable",
  "instance.env.reset": "reset an environment variable",
  "instance.license.set": "updated the license key",
  "instance.license.clear": "removed the license key",
  // Email
  "email.sendTest": "sent a test email",
  "email.settings.update": "updated email settings",
  // Kanban
  "kanban.setEnabled": "changed the kanban add-on",
  "kanban.createBoard": "created a kanban board",
  "kanban.updateBoard": "updated a kanban board",
  "kanban.archiveBoard": "archived a kanban board",
  "kanban.restoreBoard": "restored a kanban board",
  "kanban.deleteBoard": "deleted a kanban board",
  "kanban.deleteCard": "deleted a kanban card",
  // Workspace notes
  "workspaceNotes.setEnabled": "changed workspace notes",
  "workspaceNotes.deleteFolder": "deleted a notes folder",
  "workspaceNotes.deleteNote": "deleted a note",
  "workspaceNotes.deleteTag": "deleted a note tag",
  // Transcription
  "transcription.updateConfig": "updated transcription settings",
  "transcription.downloadModel": "started a transcription model download",
  "transcription.start": "started a transcription",
  "transcription.stop": "stopped a transcription",
  "transcription.requestSummary": "requested a call summary",
  "transcription.delete": "deleted a transcription",
  // Scheduled and guest calls
  "scheduledCall.create": "scheduled a call",
  "scheduledCall.update": "updated a scheduled call",
  "scheduledCall.cancel": "cancelled a scheduled call",
  "scheduledCall.open": "opened a scheduled call",
  "scheduledCall.openDue": "opened a scheduled call",
  "guestCall.createLink": "created a guest call link",
  "guestCall.revokeLink": "revoked a guest call link",
  "guestCall.admit": "admitted a guest to a call",
  "guestCall.deny": "denied a guest entry to a call",
  "guestCall.remove": "removed a guest from a call",
  // Bots
  "bot.create": "created a bot",
  "bot.update": "updated a bot",
  "bot.permissions": "updated a bot's permissions",
  "bot.files": "updated a bot's files",
  "bot.env": "updated a bot's environment variables",
  "bot.token.rotate": "replaced a bot token",
  "bot.token.revoke": "revoked a bot token",
  "bot.delete": "deleted a bot",
  // Owners and setup
  "owner.promote": "made someone an owner",
  "owner.demote": "removed an owner",
  "owner.deletion.reserved": "started an owner account deletion",
  "owner.deletion.orphaned": "handled an ownerless workspace",
  "setup.claim": "claimed the workspace",
  "setup.claim.rejected": "rejected a setup claim",
  "setup.claim.rejected.summary": "summarized rejected setup claims",
};

const ACTION_LABEL_MAP = new Map(Object.entries(ACTION_LABELS));

const ADDON_NAMES: Record<string, string> = {
  transcription: "transcription",
  guestCalls: "guest calls",
  scheduledCalls: "scheduled calls",
};

function addonActionLabel(action: string): string | null {
  const match = /^addons\.(.+)\.setEnabled$/.exec(action);
  const id = match?.[1];
  if (id === undefined) {
    return null;
  }
  return `changed the ${ADDON_NAMES[id] ?? humanize(id)} add-on`;
}

function humanize(action: string): string {
  const words = action
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._]/g, " ")
    .trim()
    .toLowerCase();
  return words.length === 0 ? "did something" : words;
}

/** Turns a camelCase metadata key into a readable label. */
function humanizeField(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._]/g, " ")
    .trim();
  return spaced.length === 0 ? key : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

const AUTH_PROVIDERS: ReadonlyArray<readonly [key: string, label: string]> = [
  ["github", "GitHub"],
  ["google", "Google"],
  ["microsoft", "Microsoft"],
  ["apple", "Apple"],
  ["oidc", "SSO"],
  ["local", "email & password"],
];

interface AuthProviderChange {
  readonly label: string;
  readonly enabled: boolean;
}

function authProviderChanges(meta: Record<string, unknown>): AuthProviderChange[] {
  const changes: AuthProviderChange[] = [];
  for (const [key, label] of AUTH_PROVIDERS) {
    const value = meta[key];
    if (typeof value === "boolean") {
      changes.push({ label, enabled: value });
    }
  }
  return changes;
}

function authProviderDetail(meta: Record<string, unknown>): string | null {
  const changes = authProviderChanges(meta);
  if (changes.length === 0) {
    return null;
  }
  return changes
    .map((change) => `${change.enabled ? "enabled" : "disabled"} ${change.label} sign-in`)
    .join(", ");
}

function joinNatural(parts: readonly string[]): string {
  if (parts.length === 0) {
    return "";
  }
  if (parts.length === 1) {
    return parts[0] ?? "";
  }
  if (parts.length === 2) {
    return `${parts[0] ?? ""} and ${parts[1] ?? ""}`;
  }
  const head = parts.slice(0, -1).join(", ");
  return `${head}, and ${parts[parts.length - 1] ?? ""}`;
}

interface EventNames {
  readonly actorName?: string | null;
  readonly targetName?: string | null;
  readonly memberNames?: ReadonlyMap<string, string>;
  readonly roleNames?: ReadonlyMap<string, string>;
  readonly channelNames?: ReadonlyMap<string, string>;
}

/** One labelled value shown in the audit event detail dialog. */
export interface AuditDetailField {
  readonly label: string;
  readonly value: string;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function lookupName(id: unknown, names: ReadonlyMap<string, string> | undefined): string | null {
  const key = nonEmpty(id);
  if (key === null) {
    return null;
  }
  return names?.get(key) ?? null;
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

function inviteKindLabel(kind: unknown): string | null {
  const value = nonEmpty(kind);
  if (value === null) {
    return null;
  }
  if (value === "code") {
    return "Code invite";
  }
  if (value === "email") {
    return "Email invite";
  }
  return `${capitalize(value)} invite`;
}

function banDetail(meta: Record<string, unknown>): string | null {
  const reason = nonEmpty(meta.reason);
  const expiresAt = typeof meta.expiresAt === "number" ? meta.expiresAt : null;
  const parts = [
    reason,
    expiresAt !== null ? `until ${new Date(expiresAt).toLocaleDateString()}` : "permanent",
  ].filter((entry): entry is string => entry !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function inviteDetail(meta: Record<string, unknown>): string | null {
  const kind = inviteKindLabel(meta.kind);
  const email = nonEmpty(meta.email);
  const maxUses = typeof meta.maxUses === "number" ? meta.maxUses : null;
  const uses =
    maxUses !== null && maxUses > 0 ? (maxUses === 1 ? "single use" : `${maxUses} uses`) : null;
  const expires =
    "expiresAt" in meta
      ? meta.expiresAt === null || meta.expiresAt === undefined
        ? "never expires"
        : typeof meta.expiresAt === "number"
          ? `expires ${new Date(meta.expiresAt).toLocaleDateString()}`
          : null
      : null;
  const parts = [kind, email !== null ? `for ${email}` : null, uses, expires].filter(
    (entry): entry is string => entry !== null,
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

function allowlistDetail(meta: Record<string, unknown>): string | null {
  return nonEmpty(meta.pattern);
}

function transcriptionDetail(meta: Record<string, unknown>): string | null {
  const provider = nonEmpty(meta.provider);
  const retention = typeof meta.retentionDays === "number" ? meta.retentionDays : null;
  const parts = [
    provider,
    retention !== null ? `keeps transcripts ${retention} days` : null,
  ].filter((entry): entry is string => entry !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function scheduledCallDetail(meta: Record<string, unknown>): string | null {
  const startsAt = typeof meta.startsAt === "number" ? meta.startsAt : null;
  const lead = typeof meta.openLeadMinutes === "number" ? meta.openLeadMinutes : null;
  const parts = [
    startsAt !== null ? `starts ${new Date(startsAt).toLocaleString()}` : null,
    lead !== null ? `opens ${lead} minutes before` : null,
  ].filter((entry): entry is string => entry !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function guestLinkDetail(meta: Record<string, unknown>): string | null {
  const maxUses = typeof meta.maxUses === "number" ? meta.maxUses : null;
  const expiresAt = typeof meta.expiresAt === "number" ? meta.expiresAt : null;
  const parts = [
    maxUses !== null && maxUses > 0 ? `${maxUses} uses` : "unlimited uses",
    expiresAt !== null ? `expires ${new Date(expiresAt).toLocaleString()}` : "never expires",
  ].filter((entry): entry is string => entry !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function filesDetail(meta: Record<string, unknown>): string | null {
  const saved = typeof meta.saved === "number" ? meta.saved : null;
  const deleted = typeof meta.deleted === "number" ? meta.deleted : null;
  const parts = [
    saved !== null ? `${saved} saved` : null,
    deleted !== null ? `${deleted} removed` : null,
  ].filter((entry): entry is string => entry !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function botEnvDetail(meta: Record<string, unknown>): string | null {
  const set = Array.isArray(meta.set) ? meta.set.length : null;
  const removed = Array.isArray(meta.removed) ? meta.removed.length : null;
  const parts = [
    set !== null ? `${set} set` : null,
    removed !== null ? `${removed} removed` : null,
  ].filter((entry): entry is string => entry !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function enabledDetail(meta: Record<string, unknown>): string | null {
  return typeof meta.enabled === "boolean" ? (meta.enabled ? "turned on" : "turned off") : null;
}

const TOGGLE_SENTENCES: Record<string, { readonly on: string; readonly off: string }> = {
  "kanban.setEnabled": { on: "turned on the kanban add-on", off: "turned off the kanban add-on" },
  "workspaceNotes.setEnabled": {
    on: "turned on workspace notes",
    off: "turned off workspace notes",
  },
  "instance.backups.update": { on: "turned on backups", off: "turned off backups" },
  "instance.pushRelay.update": { on: "turned on the push relay", off: "turned off the push relay" },
};

function toggleSentence(
  action: string,
  meta: Record<string, unknown>,
  actor: string,
): string | null {
  if (typeof meta.enabled !== "boolean") {
    return null;
  }
  const entry = TOGGLE_SENTENCES[action];
  if (entry !== undefined) {
    return `${actor} ${meta.enabled ? entry.on : entry.off}`;
  }
  if (action.startsWith("addons.") && action.endsWith(".setEnabled")) {
    const id = action.slice("addons.".length, -".setEnabled".length);
    const name = ADDON_NAMES[id] ?? humanize(id);
    return `${actor} ${meta.enabled ? "turned on" : "turned off"} the ${name} add-on`;
  }
  return null;
}

function nameDetail(meta: Record<string, unknown>): string | null {
  return nonEmpty(meta.name);
}

function boardNameDetail(meta: Record<string, unknown>): string | null {
  return nonEmpty(meta.name) ?? nonEmpty(meta.title);
}

function privacyDetail(meta: Record<string, unknown>): string | null {
  return typeof meta.private === "boolean" ? (meta.private ? "now private" : "now public") : null;
}

function countDetail(meta: Record<string, unknown>, suffix: string): string | null {
  return typeof meta.count === "number" ? `${meta.count} ${suffix}` : null;
}

function overrideTargetDetail(meta: Record<string, unknown>, names: EventNames): string | null {
  const target = lookupName(
    meta.targetId,
    meta.targetType === "role" ? names.roleNames : names.memberNames,
  );
  return target ?? nonEmpty(meta.targetType);
}

function roleDetail(meta: Record<string, unknown>, names: EventNames): string | null {
  return lookupName(meta.roleId, names.roleNames);
}

function channelMemberDetail(meta: Record<string, unknown>, names: EventNames): string | null {
  return lookupName(meta.userId, names.memberNames);
}

function timeoutDetail(meta: Record<string, unknown>): string | null {
  return typeof meta.until === "number"
    ? `until ${new Date(meta.until).toLocaleString()}`
    : "cleared";
}

function deleteInviteDetail(meta: Record<string, unknown>): string | null {
  return inviteKindLabel(meta.kind);
}

function envOverrideDetail(meta: Record<string, unknown>): string | null {
  return nonEmpty(meta.key) ?? (Array.isArray(meta.keys) ? `${meta.keys.length} variables` : null);
}

function botCreateDetail(meta: Record<string, unknown>): string | null {
  const parts = [nonEmpty(meta.name), nonEmpty(meta.language)].filter(
    (part): part is string => part !== null,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

function logoDetail(meta: Record<string, unknown>): string | null {
  return meta.set === true ? "new logo set" : "logo removed";
}

function ownersDetail(meta: Record<string, unknown>): string | null {
  return typeof meta.ownerCount === "number" ? `${meta.ownerCount} owners` : null;
}

function channelCreateMetaDetail(meta: Record<string, unknown>): string | null {
  return channelCreateDetail(meta, nonEmpty(meta.name));
}

type MetaDetailFormatter = (meta: Record<string, unknown>, names: EventNames) => string | null;

const META_DETAIL_FORMATTERS = new Map<string, MetaDetailFormatter>([
  ["role.create", nameDetail],
  ["role.update", changedFields],
  ["role.delete", nameDetail],
  ["role.reorder", (meta) => countDetail(meta, "moved")],
  ["category.create", nameDetail],
  ["category.update", nameDetail],
  ["category.delete", nameDetail],
  ["category.reorder", (meta) => countDetail(meta, "moved")],
  ["category.setOverrides", (meta) => countDetail(meta, "overrides")],
  ["category.clearOverride", overrideTargetDetail],
  ["channel.create", channelCreateMetaDetail],
  ["channel.rename", nameDetail],
  ["channel.setTopic", nameDetail],
  ["channel.setPrivate", privacyDetail],
  ["channel.setBlocked", (meta) => countDetail(meta, "blocked")],
  ["channel.setOverrides", (meta) => countDetail(meta, "overrides")],
  ["channel.clearOverride", overrideTargetDetail],
  ["channel.reorder", (meta) => countDetail(meta, "moved")],
  ["channel.member.add", channelMemberDetail],
  ["channel.member.remove", channelMemberDetail],
  ["member.role.add", roleDetail],
  ["member.role.remove", roleDetail],
  ["member.nickname", nameDetail],
  ["member.ban", banDetail],
  ["member.timeout", timeoutDetail],
  ["invite.create", inviteDetail],
  ["invite.delete", deleteInviteDetail],
  ["allowlist.add", allowlistDetail],
  ["allowlist.remove", allowlistDetail],
  ["bot.create", botCreateDetail],
  ["bot.update", changedFields],
  ["bot.delete", nameDetail],
  ["bot.files", filesDetail],
  ["bot.env", botEnvDetail],
  ["webhook.update", changedFields],
  ["server.updateSettings", changedFields],
  ["server.updateBranding", changedFields],
  ["server.setLogo", logoDetail],
  ["instance.authProviders.update", authProviderDetail],
  ["instance.backups.update", enabledDetail],
  ["instance.env.override", envOverrideDetail],
  ["instance.env.reset", (meta) => nonEmpty(meta.key)],
  ["kanban.setEnabled", enabledDetail],
  ["kanban.createBoard", boardNameDetail],
  ["kanban.updateBoard", boardNameDetail],
  ["kanban.archiveBoard", boardNameDetail],
  ["kanban.restoreBoard", boardNameDetail],
  ["kanban.deleteBoard", boardNameDetail],
  ["kanban.deleteCard", boardNameDetail],
  ["workspaceNotes.setEnabled", enabledDetail],
  ["workspaceNotes.deleteFolder", nameDetail],
  ["workspaceNotes.deleteNote", nameDetail],
  ["workspaceNotes.deleteTag", nameDetail],
  ["scheduledCall.create", scheduledCallDetail],
  ["scheduledCall.update", changedFields],
  ["guestCall.createLink", guestLinkDetail],
  ["transcription.updateConfig", transcriptionDetail],
  ["owner.promote", ownersDetail],
  ["owner.demote", ownersDetail],
  ["owner.deletion.reserved", ownersDetail],
  ["owner.deletion.orphaned", ownersDetail],
]);

function metaDetail(
  action: string,
  meta: Record<string, unknown> | null,
  names: EventNames,
): string | null {
  if (meta === null) {
    return null;
  }
  const formatter = META_DETAIL_FORMATTERS.get(action);
  return formatter !== undefined ? formatter(meta, names) : enabledDetail(meta);
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
  const parsed = parseMeta(meta);
  if (parsed !== null) {
    const toggle = toggleSentence(action, parsed, actor);
    if (toggle !== null) {
      return toggle;
    }
    if (action === "instance.authProviders.update") {
      const changes = authProviderChanges(parsed);
      if (changes.length > 0) {
        const phrases = changes.map(
          (change) => `${change.enabled ? "enabled" : "disabled"} ${change.label} sign-in`,
        );
        return `${actor} ${joinNatural(phrases)}`;
      }
    }
  }

  const label = auditActionLabel(action);
  const target = nonEmpty(names.targetName);
  const detail = metaDetail(action, parsed, names);
  const bits: string[] = [`${actor} ${label}`];
  if (target !== null) {
    bits.push(target);
  }
  if (detail !== null && detail !== target) {
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
  const detail = metaDetail(action, parseMeta(meta), {});
  return detail === null ? capitalize(label) : `${capitalize(label)}: ${detail}`;
}

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  title: "Title",
  kind: "Type",
  private: "Private",
  reason: "Reason",
  expiresAt: "Expires",
  until: "Until",
  email: "Email",
  maxUses: "Max uses",
  count: "Count",
  changed: "Changed",
  enabled: "Enabled",
  key: "Key",
  keys: "Keys",
  grants: "Permission bits",
  channels: "Channels",
  saved: "Files saved",
  deleted: "Files deleted",
  set: "Set",
  removed: "Removed",
  provider: "Provider",
  retentionDays: "Retention",
  allowPrivateEndpoint: "Private endpoint",
  url: "URL",
  serverId: "Server ID",
  storageQuotaBytes: "Storage quota",
  maxUploadBytes: "Max upload",
  ownerCount: "Owners",
  liveOwnerCount: "Live owners",
  roleId: "Role",
  userId: "Member",
  targetId: "Target",
  targetType: "Target type",
  authorId: "Author",
  callId: "Call",
  position: "Position",
  startsAt: "Starts",
  openLeadMinutes: "Opens",
  language: "Language",
  scope: "Scope",
  ip: "IP address",
  source: "Source",
  via: "Via",
  pattern: "Pattern",
  note: "Note",
  custom: "Custom code",
  createdBy: "Created by",
};

const TIMESTAMP_FIELDS = new Set(["expiresAt", "until", "startsAt", "createdAt", "updatedAt"]);
const BYTE_FIELDS = new Set(["storageQuotaBytes", "maxUploadBytes"]);

function formatMetaValue(key: string, value: unknown, names: EventNames): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "number") {
    if (TIMESTAMP_FIELDS.has(key)) {
      return new Date(value).toLocaleString();
    }
    if (BYTE_FIELDS.has(key)) {
      return key === "storageQuotaBytes" ? formatQuota(value) : formatBytes(value);
    }
    if (key === "retentionDays") {
      return value === 0 ? "Keep forever" : `${value} days`;
    }
    if (key === "openLeadMinutes") {
      return `${value} minutes before`;
    }
    return value.toLocaleString();
  }
  if (Array.isArray(value)) {
    const items = value
      .map((entry) => (typeof entry === "string" ? humanizeField(entry) : null))
      .filter((entry): entry is string => entry !== null);
    return items.length > 0 ? items.join(", ") : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    if (key === "roleId") {
      return lookupName(trimmed, names.roleNames) ?? shortId(trimmed);
    }
    if (key === "userId" || key === "authorId" || key === "createdBy") {
      return lookupName(trimmed, names.memberNames) ?? shortId(trimmed);
    }
    if (key === "channelId") {
      return lookupName(trimmed, names.channelNames) ?? shortId(trimmed);
    }
    return trimmed;
  }
  return null;
}

function changedFields(meta: Record<string, unknown>): string | null {
  const changed = changedList(meta);
  return changed.length > 0 ? changed.map(humanizeField).join(", ") : null;
}

/**
 * The structured fields shown when an audit row is opened. Every value is
 * already resolved to a display name or formatted, so the dialog never exposes
 * raw ids or developer-style keys.
 */
export function auditEventFields(
  action: string,
  meta: string | null,
  names: EventNames = {},
): AuditDetailField[] {
  const parsed = parseMeta(meta);
  if (parsed === null) {
    return [];
  }
  const fields: AuditDetailField[] = [];
  const seen = new Set<string>();
  const add = (label: string, value: string | null): void => {
    const trimmed = value?.trim() ?? "";
    if (trimmed.length === 0) {
      return;
    }
    const key = `${label}\u0000${trimmed}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    fields.push({ label, value: trimmed });
  };
  const addKey = (label: string, key: string): void => {
    add(label, formatMetaValue(key, parsed[key], names));
  };

  switch (action) {
    case "instance.authProviders.update":
      for (const change of authProviderChanges(parsed)) {
        add(`${capitalize(change.label)} sign-in`, change.enabled ? "Enabled" : "Disabled");
      }
      break;
    case "instance.storage.update":
      addKey("Storage quota", "storageQuotaBytes");
      addKey("Max upload", "maxUploadBytes");
      break;
    case "instance.pushRelay.update":
      addKey("Enabled", "enabled");
      addKey("URL", "url");
      addKey("Server ID", "serverId");
      break;
    case "instance.env.override":
      addKey("Environment variable", "key");
      add("Environment variables", formatMetaValue("keys", parsed.keys, names));
      break;
    case "instance.env.reset":
      addKey("Environment variable", "key");
      break;
    case "instance.backups.update":
    case "kanban.setEnabled":
    case "workspaceNotes.setEnabled":
      addKey("Enabled", "enabled");
      break;
    case "role.create":
      addKey("Role name", "name");
      addKey("Position", "position");
      break;
    case "role.update":
      add("Changed", changedFields(parsed));
      break;
    case "role.delete":
      addKey("Role name", "name");
      break;
    case "category.create":
    case "category.update":
    case "category.delete":
      addKey("Category name", "name");
      break;
    case "category.reorder":
      addKey("Categories moved", "count");
      break;
    case "channel.create":
      add("Type", nonEmpty(parsed.kind));
      addKey("Private", "private");
      break;
    case "channel.setPrivate":
      addKey("Private", "private");
      break;
    case "channel.setBlocked":
      addKey("Blocked members", "count");
      break;
    case "channel.setOverrides":
    case "category.setOverrides":
      addKey("Overrides", "count");
      break;
    case "channel.clearOverride":
    case "category.clearOverride": {
      const targetType = nonEmpty(parsed.targetType);
      add("Target type", targetType === null ? null : capitalize(targetType));
      add(
        "Target",
        lookupName(
          parsed.targetId,
          parsed.targetType === "role" ? names.roleNames : names.memberNames,
        ) ?? formatMetaValue("targetId", parsed.targetId, names),
      );
      break;
    }
    case "channel.reorder":
      addKey("Channels moved", "count");
      break;
    case "kanban.createBoard":
    case "kanban.updateBoard":
    case "kanban.archiveBoard":
    case "kanban.restoreBoard":
    case "kanban.deleteBoard":
      addKey("Board name", "name");
      break;
    case "kanban.deleteCard":
      addKey("Card title", "title");
      break;
    case "channel.member.add":
    case "channel.member.remove":
      addKey("Member", "userId");
      break;
    case "member.role.add":
    case "member.role.remove":
      addKey("Role", "roleId");
      break;
    case "member.ban":
      addKey("Reason", "reason");
      add(
        "Duration",
        typeof parsed.expiresAt === "number"
          ? `Until ${new Date(parsed.expiresAt).toLocaleString()}`
          : "Permanent",
      );
      break;
    case "member.timeout":
      add(
        "Timeout",
        typeof parsed.until === "number"
          ? `Until ${new Date(parsed.until).toLocaleString()}`
          : "Cleared",
      );
      break;
    case "invite.create":
      add("Type", inviteKindLabel(parsed.kind));
      addKey("Email", "email");
      addKey("Max uses", "maxUses");
      add(
        "Expires",
        typeof parsed.expiresAt === "number"
          ? new Date(parsed.expiresAt).toLocaleString()
          : "Never",
      );
      addKey("Custom code", "custom");
      addKey("Note", "note");
      break;
    case "invite.delete":
      add("Type", inviteKindLabel(parsed.kind));
      addKey("Created by", "createdBy");
      break;
    case "allowlist.add":
    case "allowlist.remove":
      addKey("Pattern", "pattern");
      break;
    case "bot.create":
      addKey("Name", "name");
      addKey("Language", "language");
      break;
    case "bot.update":
      add("Changed", changedFields(parsed));
      break;
    case "bot.permissions":
      add(
        "Channels",
        parsed.channels === "all"
          ? "All channels"
          : typeof parsed.channels === "number"
            ? `${parsed.channels} channels`
            : null,
      );
      addKey("Permission bits", "grants");
      break;
    case "bot.files":
      addKey("Files saved", "saved");
      addKey("Files removed", "deleted");
      break;
    case "bot.env":
      add("Set", formatMetaValue("keys", parsed.set, names));
      add("Removed", formatMetaValue("keys", parsed.removed, names));
      break;
    case "bot.delete":
      addKey("Name", "name");
      break;
    case "transcription.updateConfig":
      addKey("Provider", "provider");
      addKey("Retention", "retentionDays");
      addKey("Private endpoint", "allowPrivateEndpoint");
      break;
    case "scheduledCall.create":
      addKey("Starts", "startsAt");
      addKey("Opens", "openLeadMinutes");
      break;
    case "scheduledCall.update":
      add("Changed", changedFields(parsed));
      break;
    case "guestCall.createLink":
      addKey("Max uses", "maxUses");
      add(
        "Expires",
        typeof parsed.expiresAt === "number" ? new Date(parsed.expiresAt).toLocaleString() : null,
      );
      break;
    case "guestCall.admit":
      addKey("Call", "callId");
      break;
    case "message.edit":
    case "message.delete":
      addKey("Author", "authorId");
      break;
    case "server.setLogo":
      add("Logo", parsed.set === true ? "Set" : "Removed");
      break;
    case "server.updateSettings":
    case "server.updateBranding":
      add("Changed", changedFields(parsed));
      break;
    case "webhook.create":
      addKey("Name", "name");
      addKey("Channel", "channelId");
      break;
    case "webhook.update":
      add("Changed", changedFields(parsed));
      break;
    case "webhook.delete":
      addKey("Name", "name");
      break;
    case "owner.promote":
    case "owner.demote":
    case "owner.deletion.reserved":
      addKey("Owners", "ownerCount");
      break;
    case "owner.deletion.orphaned":
      addKey("Reason", "reason");
      addKey("Owners", "ownerCount");
      addKey("Live owners", "liveOwnerCount");
      break;
    case "setup.claim":
      addKey("Source", "source");
      break;
    case "setup.claim.rejected":
      addKey("Reason", "reason");
      addKey("Scope", "scope");
      addKey("IP address", "ip");
      break;
    default:
      if (action.startsWith("addons.") && action.endsWith(".setEnabled")) {
        addKey("Enabled", "enabled");
      } else {
        // Future actions still get useful detail instead of an empty dialog.
        for (const [key, value] of Object.entries(parsed)) {
          add(FIELD_LABELS[key] ?? humanizeField(key), formatMetaValue(key, value, names));
        }
      }
      break;
  }

  return fields;
}
