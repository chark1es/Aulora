import { callElsewhereFromUnknown } from "./seat";
import type { CallSignalKind, VoicePort } from "./types";

/**
 * Shared implementation of the Convex voice port.
 *
 * Web and mobile keep their own thin adapter for the pieces that differ (the
 * streaming-server and TURN grants are web-only), but every call-state mutation
 * is identical: the same arguments, the same `call_elsewhere` translation and
 * the same batched-signal fallback. Passing the mutation function and the
 * generated function references keeps this module free of a Convex dependency.
 */

export type VoiceMutation = (reference: unknown, args: Record<string, unknown>) => Promise<unknown>;

/** The generated `api.calls` mutation references the port needs. */
export interface VoiceCallMutationRefs {
  readonly start: unknown;
  readonly join: unknown;
  readonly leave: unknown;
  readonly end: unknown;
  readonly decline: unknown;
  readonly updateParticipant: unknown;
  readonly heartbeat: unknown;
  readonly stay: unknown;
  readonly signal: unknown;
  readonly ack: unknown;
}

/** Turns a `call_elsewhere` server error into the typed error the UI handles. */
export async function translateCallElsewhere<T>(work: Promise<unknown>): Promise<T> {
  try {
    return (await work) as T;
  } catch (error) {
    const elsewhere = callElsewhereFromUnknown(error);
    if (elsewhere !== null) {
      throw elsewhere;
    }
    throw error;
  }
}

/** Builds the platform-independent part of a Convex `VoicePort`. */
export function createVoicePortBase(
  clientId: string,
  calls: VoiceCallMutationRefs,
  mutation: VoiceMutation,
): VoicePort {
  return {
    async startCall(args) {
      return await translateCallElsewhere<{ callId: string; created: boolean }>(
        mutation(calls.start, {
          channelId: args.channelId,
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
      await translateCallElsewhere(
        mutation(calls.join, {
          callId: args.callId,
          clientId,
          ...(args.takeover === true ? { takeover: true } : {}),
        }),
      );
      return null;
    },
    async leaveCall(args) {
      await mutation(calls.leave, { callId: args.callId, clientId });
      return null;
    },
    async endCall(args) {
      await mutation(calls.end, { callId: args.callId });
      return null;
    },
    async declineCall(args) {
      await mutation(calls.decline, { callId: args.callId });
      return null;
    },
    async updateParticipant(args) {
      await mutation(calls.updateParticipant, {
        callId: args.callId,
        clientId,
        ...(args.muted !== undefined ? { muted: args.muted } : {}),
        ...(args.deafened !== undefined ? { deafened: args.deafened } : {}),
        ...(args.video !== undefined ? { video: args.video } : {}),
        ...(args.sharingScreen !== undefined ? { sharingScreen: args.sharingScreen } : {}),
        ...(args.sfu !== undefined ? { sfu: args.sfu } : {}),
        ...(args.sfuCall !== undefined ? { sfuCall: args.sfuCall } : {}),
      });
      return null;
    },
    async callHeartbeat(args) {
      await mutation(calls.heartbeat, { callId: args.callId, clientId });
      return null;
    },
    async stayInCall(args) {
      await mutation(calls.stay, { callId: args.callId, clientId });
      return null;
    },
    async sendSignal(args) {
      const signal = {
        callId: args.callId,
        clientId,
        toUserId: args.toUserId,
        kind: args.kind as CallSignalKind,
      };
      const payloads = args.payloads;
      if (payloads === undefined || payloads.length <= 1) {
        await mutation(calls.signal, { ...signal, payload: args.payload });
        return null;
      }
      try {
        await mutation(calls.signal, {
          ...signal,
          payload: payloads[0] ?? args.payload,
          payloads: [...payloads],
        });
      } catch {
        // A backend from before batched signalling rejects the extra field (or
        // the batch failed): fall back to one envelope per candidate so a
        // roll-out in either order still connects the call.
        await Promise.all(
          payloads.map((payload) => mutation(calls.signal, { ...signal, payload })),
        );
      }
      return null;
    },
    async ackSignals(args) {
      await mutation(calls.ack, { signalIds: args.signalIds });
      return null;
    },
  };
}
