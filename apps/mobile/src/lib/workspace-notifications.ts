import type { ServerProfile } from "@aulora/core";

/**
 * A mobile wake's routing metadata. The push relay forwards only ids: never a
 * sender, message text or workspace name. `messageId` is the message to land
 * on; for a call it is the call id and is not used as a message jump.
 */
export interface WorkspaceNotificationHint {
  readonly serverId: string;
  readonly channelId: string;
  readonly messageId: string | null;
  readonly kind: "message" | "call";
}

/** A conversation to open after a wake, scoped to the workspace it belongs to. */
export interface WorkspaceNotificationTarget {
  readonly profileId: string;
  readonly channelId: string;
  readonly messageId: string | null;
  readonly kind: "message" | "call";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * Reads the stable mobile-wake id a server advertises through its public
 * config. An older backend omits it, so callers fall back to address matching.
 */
export function workspaceServerIdFromConfig(config: unknown): string | null {
  if (!isRecord(config) || !isRecord(config.pushRelay)) {
    return null;
  }
  return stringField(config.pushRelay.serverId) ?? null;
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
    messageId: stringField(payload.messageId) ?? stringField(data.messageId) ?? null,
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
 * The server id a workspace advertised when it was connected. It may be a
 * configured opaque id (`AULORA_SERVER_ID`), a site URL or the historical
 * literal `aulora`, so it is never parsed as an address.
 */
const profileIdByServerId = new Map<string, string>();
const serverIdByProfileId = new Map<string, string>();
/**
 * Ids advertised by more than one saved workspace (for example two deployments
 * left on the literal `aulora` fallback). Such an id cannot route safely.
 */
const ambiguousServerIds = new Set<string>();

/**
 * Re-derives one id's ownership after a profile is added or renamed. An id
 * advertised by two profiles stays ambiguous, but renaming one of them must be
 * able to make the remaining id unique again; otherwise a stale ambiguity would
 * permanently block a wake from the workspace that kept the original id.
 */
function refreshServerIdOwnership(serverId: string): void {
  const owners: string[] = [];
  for (const [profileId, advertised] of serverIdByProfileId) {
    if (advertised === serverId) {
      owners.push(profileId);
    }
  }
  if (owners.length === 1 && owners[0] !== undefined) {
    profileIdByServerId.set(serverId, owners[0]);
    ambiguousServerIds.delete(serverId);
    return;
  }
  profileIdByServerId.delete(serverId);
  if (owners.length > 1) {
    ambiguousServerIds.add(serverId);
  } else {
    ambiguousServerIds.delete(serverId);
  }
}

/**
 * Remembers which saved workspace a wake's server id belongs to. Returns true
 * when this changed anything, so a caller can persist without writing on every
 * public-config refresh. Existing profiles are backfilled when their config is
 * read; new profiles remember it at connect time.
 */
export function rememberWorkspaceServerId(profileId: string, serverId: string): boolean {
  const trimmed = serverId.trim();
  if (profileId.length === 0 || trimmed.length === 0) {
    return false;
  }
  const previous = serverIdByProfileId.get(profileId);
  if (previous === trimmed) {
    return false;
  }
  serverIdByProfileId.set(profileId, trimmed);
  if (previous !== undefined) {
    refreshServerIdOwnership(previous);
  }
  refreshServerIdOwnership(trimmed);
  return true;
}

/** True when two saved workspaces advertise the same wake id. */
export function workspaceServerIdIsAmbiguous(serverId: string): boolean {
  return ambiguousServerIds.has(serverId.trim());
}

/** Test seam: the server id last learned for a workspace. */
export function workspaceServerIdForProfile(profileId: string): string | undefined {
  return serverIdByProfileId.get(profileId);
}

/**
 * Finds the saved workspace a wake belongs to. A remembered server id wins
 * because it is the exact value the server stamps. Older clients/profiles fall
 * back to comparing the stored site/base/convex addresses, and a wake from a
 * deployment that used the literal `aulora` id resolves when there is only one
 * saved workspace. An ambiguous origin matches nothing.
 */
export function profileForServerId(
  profiles: readonly ServerProfile[],
  serverId: string,
): ServerProfile | undefined {
  const key = serverKey(serverId);
  const trimmed = serverId.trim();
  const rememberedId =
    trimmed.length > 0 && !workspaceServerIdIsAmbiguous(trimmed)
      ? profileIdByServerId.get(trimmed)
      : undefined;
  if (rememberedId !== undefined) {
    const remembered = profiles.find((profile) => profile.id === rememberedId);
    // A remembered id is only proof of ownership once every current saved
    // workspace has advertised one. Otherwise the cached match may have been
    // learned before a second workspace was read, and that peer could share
    // the same opaque `aulora`/custom id. Wait for the resolver to establish
    // uniqueness instead of routing on the partial cache.
    const everyIdentityKnown =
      profiles.length > 0 &&
      profiles.every((profile) => serverIdByProfileId.has(profile.id));
    if (remembered !== undefined && everyIdentityKnown) {
      return remembered;
    }
  }
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
  if (origin !== null) {
    const matches = profiles.filter((profile) =>
      keysOf(profile).some((entry) => originKey(entry) === origin),
    );
    if (matches.length === 1) {
      return matches[0];
    }
  }
  // A device only receives a wake for a workspace it registered with. With a
  // single saved workspace, any leftover id shape (including the old literal
  // `aulora`) can only mean that workspace.
  return profiles.length === 1 ? profiles[0] : undefined;
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
  scheduleWorkspaceNotificationSave();
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
  scheduleWorkspaceNotificationSave();
}

interface PendingTarget {
  readonly profileId: string;
  readonly channelId: string;
  readonly messageId: string | null;
  readonly kind: "message" | "call";
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
 * Marks the conversation an opened (or auto-switched) notification should land
 * in. The mounted chat for that workspace takes it; when the workspace must
 * switch first, the new chat takes it on mount.
 */
export function setWorkspaceNotificationTarget(
  profileId: string,
  channelId: string,
  messageId: string | null = null,
  kind: "message" | "call" = "message",
): void {
  pendingTarget = { profileId, channelId, messageId, kind };
  emitTarget();
}

/** Consumes the pending conversation once, and only for the workspace it names. */
export function takeWorkspaceNotificationTarget(
  profileId: string,
): WorkspaceNotificationTarget | undefined {
  if (pendingTarget === null || pendingTarget.profileId !== profileId) {
    return undefined;
  }
  const target = pendingTarget;
  pendingTarget = null;
  return target;
}

/** Async key/value storage the app's badge and identity state is persisted in. */
export interface WorkspaceNotificationStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export const WORKSPACE_NOTIFICATIONS_KEY = "aulora.workspaceNotifications.v1";

let resourceStore: WorkspaceNotificationStore | null = null;
let hydrated = false;
let hydration: Promise<void> | null = null;
let saveChain: Promise<void> = Promise.resolve();

/**
 * Installs the persistent store. The module stays usable without one (tests,
 * and a cold start before AsyncStorage is ready), in which case state is only
 * process memory.
 */
export function configureWorkspaceNotificationStore(
  store: WorkspaceNotificationStore | null,
): void {
  resourceStore = store;
  hydrated = false;
  hydration = null;
}

function positiveCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function applyPersistedState(raw: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!isRecord(parsed)) {
    return;
  }
  const serverIds = isRecord(parsed.serverIds) ? parsed.serverIds : {};
  for (const [profileId, value] of Object.entries(serverIds)) {
    if (typeof value === "string" && value.trim().length > 0) {
      rememberWorkspaceServerId(profileId, value);
    }
  }
  if (isRecord(parsed.unread)) {
    const next = new Map(unreadByProfile);
    for (const [profileId, value] of Object.entries(parsed.unread)) {
      const count = positiveCount(value);
      if (count > 0) {
        next.set(profileId, (next.get(profileId) ?? 0) + count);
      }
    }
    unreadByProfile = next;
    emitUnread();
  }
}

/**
 * Loads saved server ids and badges once. Callers await this before resolving
 * a notification that may have launched the process.
 */
export function ensureWorkspaceNotificationsLoaded(): Promise<void> {
  if (hydrated) {
    return Promise.resolve();
  }
  hydration ??= (async () => {
    const store = resourceStore;
    if (store === null) {
      hydrated = true;
      return;
    }
    try {
      const raw = await store.getItem(WORKSPACE_NOTIFICATIONS_KEY);
      if (raw !== null) {
        applyPersistedState(raw);
      }
    } catch {
      // Persistence is best-effort; in-memory state still works this launch.
    }
    hydrated = true;
  })();
  return hydration;
}

function scheduleWorkspaceNotificationSave(): void {
  const store = resourceStore;
  if (store === null) {
    return;
  }
  const payload = JSON.stringify({
    serverIds: Object.fromEntries(serverIdByProfileId),
    unread: Object.fromEntries(unreadByProfile),
  });
  saveChain = saveChain
    .catch(() => undefined)
    .then(() => store.setItem(WORKSPACE_NOTIFICATIONS_KEY, payload))
    .catch(() => undefined);
}

/** Awaits writes queued so far; used by callers/tests that need to observe them. */
export function workspaceNotificationWrites(): Promise<void> {
  return saveChain;
}

/** Persists a newly learned server id. Best-effort, like badge writes. */
export function rememberAndPersistWorkspaceServerId(profileId: string, serverId: string): void {
  if (rememberWorkspaceServerId(profileId, serverId)) {
    scheduleWorkspaceNotificationSave();
  }
}

/** Test seam: drops badge, target and identity state between cases. */
export function resetWorkspaceNotifications(): void {
  unreadByProfile = new Map();
  pendingTarget = null;
  profileIdByServerId.clear();
  serverIdByProfileId.clear();
  ambiguousServerIds.clear();
  hydrated = false;
  hydration = null;
  emitUnread();
  emitTarget();
}
