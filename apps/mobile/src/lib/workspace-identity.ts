import type { ServerProfile } from "@aulora/core";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ConvexReactClient } from "convex/react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import {
  configureWorkspaceNotificationStore,
  profileForServerId,
  rememberAndPersistWorkspaceServerId,
  workspaceServerIdForProfile,
  workspaceServerIdFromConfig,
  workspaceServerIdIsAmbiguous,
} from "./workspace-notifications";

/**
 * Wires the pure badge/identity module to the device's AsyncStorage once, at
 * module load. Import this module (rather than `workspace-notifications`
 * directly) from screens and effects so a notification badge learned before
 * the app was killed is still there after a cold start.
 */
configureWorkspaceNotificationStore(AsyncStorage);

/** Reads a workspace's public config and returns the id it stamps on wakes. */
export async function fetchWorkspaceServerId(convexUrl: string): Promise<string | null> {
  let client: ConvexReactClient;
  try {
    client = new ConvexReactClient(convexUrl);
  } catch {
    return null;
  }
  try {
    const config = await client.query(api.server.publicConfig, {});
    return workspaceServerIdFromConfig(config);
  } catch {
    return null;
  } finally {
    try {
      void client.close();
    } catch {
      // Closing twice or after a failed connect is not this module's problem.
    }
  }
}

/**
 * Learns and persists a saved workspace's wake id when it is missing. Returns
 * the known id, or null when the server is unreachable or too old to advertise
 * one. Best-effort: notification routing must never throw.
 */
export async function backfillWorkspaceServerId(profile: ServerProfile): Promise<string | null> {
  const known = workspaceServerIdForProfile(profile.id);
  if (known !== undefined) {
    return known;
  }
  const serverId = await fetchWorkspaceServerId(profile.convexUrl);
  if (serverId !== null) {
    rememberAndPersistWorkspaceServerId(profile.id, serverId);
  }
  return serverId;
}

/** Bound identity probing for a wake that is not yet cached. */
const MAX_IDENTITY_CANDIDATES = 8;

interface IdentityCandidate {
  readonly profile: ServerProfile;
  /** The advertised id, or `null` when the server could not be read. */
  readonly serverId: string | null;
}

/**
 * Resolves a wake to a saved workspace, asking older profiles for their
 * advertised id when address matching is not enough. Profiles are few, and
 * this only runs when a notification names an id not yet remembered.
 *
 * Every candidate identity is learned before a match is accepted. Returning
 * the first profile whose fetched id matched let two older deployments that
 * both advertised the historical `aulora` fallback (or a duplicated custom id)
 * route to whichever config was read first, before the other was known and
 * marked ambiguous. An identity we could not read is treated the same way: it
 * might advertise the same id, so the wake stays pending rather than choosing
 * an arbitrary workspace.
 */
export async function resolveWorkspaceProfile(
  profiles: readonly ServerProfile[],
  serverId: string,
): Promise<ServerProfile | undefined> {
  if (workspaceServerIdIsAmbiguous(serverId)) {
    return undefined;
  }
  // This only returns a remembered id when every current saved workspace has a
  // known identity (or the id is an unambiguous workspace address). A partial
  // cache is deliberately not a routing answer: the unread peer might advertise
  // the same opaque id.
  const direct = profileForServerId(profiles, serverId);
  if (direct !== undefined) {
    return direct;
  }
  if (profiles.length === 0 || profiles.length > MAX_IDENTITY_CANDIDATES) {
    return undefined;
  }
  const unresolvedBeforeFetch = profiles.some(
    (profile) => workspaceServerIdForProfile(profile.id) === undefined,
  );
  if (!unresolvedBeforeFetch) {
    // Every identity is known and the complete lookup above found no unique
    // owner, so another network round can only repeat that answer.
    return undefined;
  }
  const candidates: IdentityCandidate[] = await Promise.all(
    profiles.map(async (profile) => ({
      profile,
      serverId: await backfillWorkspaceServerId(profile).catch(() => null),
    })),
  );
  for (const candidate of candidates) {
    if (candidate.serverId !== null) {
      rememberAndPersistWorkspaceServerId(candidate.profile.id, candidate.serverId);
    }
  }
  const matches = candidates.filter((candidate) => candidate.serverId === serverId);
  const unresolved = candidates.some((candidate) => candidate.serverId === null);
  if (matches.length !== 1 || unresolved) {
    return undefined;
  }
  return matches[0]?.profile;
}

export type {
  WorkspaceNotificationHint,
  WorkspaceNotificationStore,
  WorkspaceNotificationTarget,
} from "./workspace-notifications";
export {
  clearWorkspaceUnread,
  ensureWorkspaceNotificationsLoaded,
  profileForServerId,
  readWorkspaceNotificationHint,
  recordWorkspaceUnread,
  rememberAndPersistWorkspaceServerId,
  rememberWorkspaceServerId,
  resetWorkspaceNotifications,
  setWorkspaceNotificationTarget,
  subscribeWorkspaceNotificationTargets,
  subscribeWorkspaceUnread,
  takeWorkspaceNotificationTarget,
  workspaceNotificationWrites,
  workspaceServerIdForProfile,
  workspaceServerIdFromConfig,
  workspaceServerIdIsAmbiguous,
  workspaceUnreadSnapshot,
} from "./workspace-notifications";
