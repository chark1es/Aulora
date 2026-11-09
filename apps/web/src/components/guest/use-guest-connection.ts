import { fetchWellKnown } from "@aulora/core";
import { ConvexReactClient } from "convex/react";
import { useEffect, useState } from "react";
import { guestPageOrigin } from "../../lib/public-origin";

export type GuestConnection =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly status: "ready"; readonly client: ConvexReactClient; readonly convexUrl: string };

/**
 * Connects the guest page to the workspace it was opened from. A guest has no
 * saved server profile: the page is served by the workspace itself, so its own
 * origin is asked for the public `.well-known` document, and the Convex client
 * made from it carries no identity and no auth.
 */
export function useGuestConnection(attempt: number): GuestConnection {
  const [state, setState] = useState<GuestConnection>({ status: "loading" });
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the connection when the guest retries
  useEffect(() => {
    const controller = new AbortController();
    let client: ConvexReactClient | null = null;
    setState({ status: "loading" });
    void fetchWellKnown(guestPageOrigin(), { signal: controller.signal })
      .then((wellKnown) => {
        if (controller.signal.aborted) {
          return;
        }
        client = new ConvexReactClient(wellKnown.convexUrl);
        setState({ status: "ready", client, convexUrl: wellKnown.convexUrl });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ status: "error" });
        }
      });
    return () => {
      controller.abort();
      void client?.close();
    };
  }, [attempt]);
  return state;
}
