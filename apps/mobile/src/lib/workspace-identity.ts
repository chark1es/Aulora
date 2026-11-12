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

/**
 * Resolves a wake to a saved workspace, asking each older profile for its
 * advertised id when address matching is not enough. Profiles are few, and
 * this only runs when a notification names an id not yet remembered.
 */
export async function resolveWorkspaceProfile(
  profiles: readonly ServerProfile[],
  serverId: string,
): Promise<ServerProfile | undefined> {
  if (workspaceServerIdIsAmbiguous(serverId)) {
    return undefined;
  }
  const direct = profileForServerId(profiles, serverId);
  if (direct !== undefined) {
    return direct;
  }
  for (const profile of profiles) {
    const known = await backfillWorkspaceServerId(profile);
    if (known === serverId) {
      return profile;
    }
  }
  return undefined;
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
