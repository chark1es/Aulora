import {
  type CallSignalRow,
  type CallView,
  createVoicePortBase,
  type VoicePort,
  type VoiceSubscriptions,
  watchLocalQuery,
} from "@aulora/core";
import type { ConvexReactClient } from "convex/react";
import { api } from "../../../../../packages/convex/convex/_generated/api";

/**
 * Live Convex adapter for `@aulora/core`'s `VoicePort` and `VoiceSubscriptions`.
 * The call-state mutations and the subscription glue are shared with web in
 * `@aulora/core`; mobile omits the streaming-server and TURN grants it does not
 * use. Media is peer-to-peer and never reaches the server.
 */
export function convexVoicePort(client: ConvexReactClient, clientId: string): VoicePort {
  return createVoicePortBase(clientId, api.calls, (reference, args) =>
    client.mutation(reference as never, args as never),
  );
}

export function convexVoiceSubscriptions(client: ConvexReactClient): VoiceSubscriptions {
  function watch<T>(
    query: Parameters<ConvexReactClient["watchQuery"]>[0],
    args: Record<string, unknown>,
    onChange: (value: T) => void,
  ): () => void {
    return watchLocalQuery(client.watchQuery(query as never, args as never), onChange);
  }

  return {
    watchCall(channelId, onChange) {
      return watch<CallView | null>(api.calls.forChannel, { channelId }, onChange);
    },
    watchCallById(callId, onChange) {
      return watch<CallView | null>(api.calls.get, { callId }, onChange);
    },
    watchSignals(callId, onChange) {
      return watch<CallSignalRow[]>(api.calls.signals, { callId }, onChange);
    },
    watchIncoming(onChange) {
      return watch<CallView[]>(api.calls.incoming, {}, onChange);
    },
    watchActiveCalls(onChange) {
      return watch<CallView[]>(api.calls.activeCalls, {}, onChange);
    },
  };
}
