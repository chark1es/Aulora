import type { ServerProfile } from "@aulora/core";

/**
 * Notification data the push relay (and the OS) may attach to a wake. The relay
 * sends only the workspace id, channel id, message id and kind, never content.
 */
export interface WorkspaceNotificationHint {
  readonly serverId: string;
  readonly channelId: string;
  readonly kind: "message" | "call";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * Reads a wake's notification data. APNs puts the ids under a custom `aulora`
 * root; FCM (and local notifications) flatten them, so both shapes are read
 * without trusting anything else in the payload.
 */
export function readWorkspaceNotificationHint(data: unknown): WorkspaceNotificationHint | null {
  if (!isRecord(data)) {
    return null;
  }
  const payload = isRecord(data.aulora) ? data.aulora : data;
  const serverId = stringField(payload.serverId) ?? stringField(data.serverId);
  const channelId = stringField(payload.channelId) ?? stringField(data.channelId);
  if (serverId === undefined || channelId === undefined) {
    return null;
  }
  return {
    serverId,
    channelId,
    kind: payload.kind === "call" || data.kind === "call" ? "call" : "message",
  };
}

/** A comparable key for a workspace address: no hash, query or trailing slash. */
function serverKey(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.search = "";
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
}

function originKey(value: string): string | null {
  const key = serverKey(value);
  if (key === null) {
    return null;
  }
  const slash = key.indexOf("/", key.indexOf("//") + 2);
  return slash === -1 ? key : key.slice(0, slash);
}

/**
 * Finds the saved workspace a wake belongs to. The relay's `serverId` is the
 * server's own site (or a configured id), so the stored site/base/convex
 * addresses are compared directly, with an origin fallback for a workspace
 * address that carries a path. An ambiguous origin matches nothing.
 */
export function profileForServerId(
  profiles: readonly ServerProfile[],
  serverId: string,
): ServerProfile | undefined {
  const key = serverKey(serverId);
  if (key === null) {
    return undefined;
  }
  const keysOf = (profile: ServerProfile) =>
    [profile.siteUrl, profile.baseUrl, profile.convexUrl]
      .map(serverKey)
      .filter((entry): entry is string => entry !== null);

  const exact = profiles.find((profile) => keysOf(profile).includes(key));
  if (exact !== undefined) {
    return exact;
  }
  const origin = originKey(serverId);
  if (origin === null) {
    return undefined;
  }
  const matches = profiles.filter((profile) =>
    keysOf(profile).some((entry) => originKey(entry) === origin),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

let unreadByProfile: ReadonlyMap<string, number> = new Map();
const unreadListeners = new Set<() => void>();

function emitUnread(): void {
  for (const listener of [...unreadListeners]) {
    listener();
  }
}

export function subscribeWorkspaceUnread(listener: () => void): () => void {
  unreadListeners.add(listener);
  return () => {
    unreadListeners.delete(listener);
  };
}

export function workspaceUnreadSnapshot(): ReadonlyMap<string, number> {
  return unreadByProfile;
}

/** A wake for a workspace that is not open: badge that workspace in the nav. */
export function recordWorkspaceUnread(profileId: string): void {
  const next = new Map(unreadByProfile);
  next.set(profileId, (next.get(profileId) ?? 0) + 1);
  unreadByProfile = next;
  emitUnread();
}

/** Opening or acknowledging a workspace clears what the nav badge counted. */
export function clearWorkspaceUnread(profileId: string): void {
  if (!unreadByProfile.has(profileId)) {
    return;
  }
  const next = new Map(unreadByProfile);
  next.delete(profileId);
  unreadByProfile = next;
  emitUnread();
}

/** Test seam: drops badge and target state between cases. */
export function resetWorkspaceNotifications(): void {
  unreadByProfile = new Map();
  pendingTarget = null;
  emitUnread();
  emitTarget();
}

interface PendingTarget {
  readonly profileId: string;
  readonly channelId: string;
}

let pendingTarget: PendingTarget | null = null;
const targetListeners = new Set<() => void>();

function emitTarget(): void {
  for (const listener of [...targetListeners]) {
    listener();
  }
}

export function subscribeWorkspaceNotificationTargets(listener: () => void): () => void {
  targetListeners.add(listener);
  return () => {
    targetListeners.delete(listener);
  };
}

/**
 * Marks the conversation an opened notification should land in. The mounted
 * chat for that workspace takes it; when the workspace must switch first, the
 * new chat takes it on mount.
 */
export function setWorkspaceNotificationTarget(profileId: string, channelId: string): void {
  pendingTarget = { profileId, channelId };
  emitTarget();
}

/** Consumes the pending conversation once, and only for the workspace it names. */
export function takeWorkspaceNotificationTarget(profileId: string): string | undefined {
  if (pendingTarget === null || pendingTarget.profileId !== profileId) {
    return undefined;
  }
  const { channelId } = pendingTarget;
  pendingTarget = null;
  return channelId;
}
