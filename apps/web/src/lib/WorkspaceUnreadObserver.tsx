import type { Dispatch, SetStateAction } from "react";
import { useEffect } from "react";
import { useWorkspaceUnreadCounts, type WorkspaceUnreadOptions } from "./use-workspace-unread";

/** Loads cross-workspace auth/socket subscriptions outside the initial graph. */
export function WorkspaceUnreadObserver({
  profiles,
  activeProfileId,
  onChange,
}: WorkspaceUnreadOptions & {
  readonly onChange: Dispatch<SetStateAction<ReadonlyMap<string, number>>>;
}) {
  const counts = useWorkspaceUnreadCounts({ profiles, activeProfileId });
  useEffect(() => {
    onChange(counts);
  }, [counts, onChange]);
  return null;
}
