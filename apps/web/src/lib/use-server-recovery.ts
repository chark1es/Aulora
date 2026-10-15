/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { ServerProfile } from "@aulora/core";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import type { ConnectionRecoveryActionsProps } from "../components/ConnectionRecoveryActions";
import { useProfiles } from "../providers/ProfileProvider";

export interface ServerRecovery {
  /** Props for {@link ConnectionRecoveryActions}, wired to this profile. */
  readonly recovery: ConnectionRecoveryActionsProps;
  readonly switchServer: () => void;
}

/**
 * Recovery actions for the active saved server: retry (caller-supplied),
 * remove it from this device, or return to the connect screen. Removal reuses
 * the profile store, then sends the person back to the connect screen.
 */
export function useServerRecovery(profile: ServerProfile, onRetry: () => void): ServerRecovery {
  const { profiles, remove } = useProfiles();
  const navigate = useNavigate();
  const canRemoveServer = profiles.some((entry) => entry.id === profile.id);
  const switchServer = useCallback(() => {
    void navigate({ to: "/connect" });
  }, [navigate]);
  const removeServer = useCallback(() => {
    void (async () => {
      await remove(profile.id);
      void navigate({ to: "/connect" });
    })();
  }, [remove, profile.id, navigate]);

  return {
    recovery: {
      serverName: profile.name,
      canRemoveServer,
      onRetry,
      onSwitchServer: switchServer,
      onRemoveServer: removeServer,
    },
    switchServer,
  };
}
