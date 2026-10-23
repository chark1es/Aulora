import { useQuery } from "convex/react";
import { useMemo } from "react";
import { api } from "../../../../packages/convex/convex/_generated/api";

/**
 * Display names of incoming webhooks, keyed by their author id. Webhooks post
 * messages but are not members, so the member list never carries them.
 */
export function useWebhookNames(): ReadonlyMap<string, string> {
  const identities = useQuery(api.webhooks.identities, {});
  return useMemo(
    () => new Map((identities ?? []).map((identity) => [identity.userId, identity.name])),
    [identities],
  );
}
