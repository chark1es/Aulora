import {
  type CallSignalKind,
  type CallSignalRow,
  type CallView,
  callElsewhereFromUnknown,
  type VoicePort,
  type VoiceSubscriptions,
} from "@aulora/core";
import type { ConvexReactClient } from "convex/react";
import { api } from "../../../../../packages/convex/convex/_generated/api";

async function translate<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    const elsewhere = callElsewhereFromUnknown(error);
    if (elsewhere !== null) {
      throw elsewhere;
    }
    throw error;
  }
}

/**
 * Live Convex adapter for the voice contract (`@aulora/core`'s `VoicePort` and
 * `VoiceSubscriptions`). Only call state and WebRTC signalling cross this
 * boundary; media is peer-to-peer and never reaches the server.
 */
export function convexVoicePort(client: ConvexReactClient, clientId: string): VoicePort {
  return {
    async startCall(args) {
      return await translate(
        client.mutation(api.calls.start, {
          channelId: args.channelId as never,
          kind: args.kind,
          clientId,
          ...(args.takeover === true ? { takeover: true } : {}),
          ...(args.ringingUserIds !== undefined
            ? { ringingUserIds: [...args.ringingUserIds] }
            : {}),
        }),
      );
    },
    async joinCall(args) {
      await translate(
        client.mutation(api.calls.join, {
          callId: args.callId as never,
          clientId,
          ...(args.takeover === true ? { takeover: true } : {}),
        }),
      );
      return null;
    },
    async leaveCall(args) {
      await client.mutation(api.calls.leave, { callId: args.callId as never, clientId });
      return null;
    },
    async endCall(args) {
      await client.mutation(api.calls.end, { callId: args.callId as never });
      return null;
    },
    async declineCall(args) {
      await client.mutation(api.calls.decline, { callId: args.callId as never });
      return null;
    },
    async updateParticipant(args) {
      await client.mutation(api.calls.updateParticipant, {
        callId: args.callId as never,
        clientId,
        ...(args.muted !== undefined ? { muted: args.muted } : {}),
        ...(args.deafened !== undefined ? { deafened: args.deafened } : {}),
        ...(args.video !== undefined ? { video: args.video } : {}),
        ...(args.sharingScreen !== undefined ? { sharingScreen: args.sharingScreen } : {}),
      });
      return null;
    },
    async callHeartbeat(args) {
      await client.mutation(api.calls.heartbeat, { callId: args.callId as never, clientId });
      return null;
    },
    async sendSignal(args) {
      await client.mutation(api.calls.signal, {
        callId: args.callId as never,
        clientId,
        toUserId: args.toUserId,
        kind: args.kind as CallSignalKind,
        payload: args.payload,
      });
      return null;
    },
    async ackSignals(args) {
      await client.mutation(api.calls.ack, { signalIds: args.signalIds as never[] });
      return null;
    },
  };
}

export function convexVoiceSubscriptions(client: ConvexReactClient): VoiceSubscriptions {
  function watch<T>(
    query: Parameters<ConvexReactClient["watchQuery"]>[0],
    args: Record<string, unknown>,
    onChange: (value: T) => void,
  ): () => void {
    const handle = client.watchQuery(query as never, args as never);
    const emit = () => {
      const value = handle.localQueryResult();
      if (value !== undefined) {
        onChange(value as T);
      }
    };
    const unsubscribe = handle.onUpdate(emit);
    // A warm client can deliver before `onUpdate` is attached; read it once.
    emit();
    return () => {
      unsubscribe();
    };
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
