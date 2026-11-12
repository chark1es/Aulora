/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import {
  type CallSignalKind,
  type CallSignalRow,
  type CallView,
  GUEST_SIGNAL_ACK_MAX,
  type VoicePort,
  type VoiceSubscriptions,
} from "@aulora/core";
import type { ConvexReactClient } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import type { LobbyStatus } from "./page-state";

/** The part of `guestCalls.roster` the call engine needs. */
export interface GuestRoster {
  readonly callId: string;
  readonly callStatus: "ringing" | "active" | "ended";
  readonly scheduledCallId: string | null;
  readonly transcribing: boolean;
  readonly transcriptionSessionId: string | null;
  readonly participants: readonly {
    readonly participantKey: string;
    readonly isGuest: boolean;
    readonly displayName: string;
    readonly muted: boolean;
    readonly video: boolean;
    readonly joinedAt: number;
    readonly session: number;
    /**
     * Member rows only: true when this guest must create the offer toward that
     * member. The server computes it as `!shouldOffer(memberAccountId, guestSessionId)`
     * so it agrees with the legacy election mobile and released clients use.
     * Absent on guest rows and on an older server.
     */
    readonly shouldOffer?: boolean;
  }[];
}

type Assignable<Actual extends Expected, Expected> = Actual;

/**
 * Compile-time drift guards: what the page reads must be assignable from what
 * `guestCalls` returns. If the backend renames or retypes a field the page
 * needs, typecheck fails here instead of the guest page misbehaving at runtime.
 */
export type ServerRosterMatchesPage = Assignable<
  FunctionReturnType<typeof api.guestCalls.roster>,
  GuestRoster
>;
export type ServerLobbyMatchesPage = Assignable<
  FunctionReturnType<typeof api.guestCalls.lobby>,
  { status: LobbyStatus; guestSessionId: string; callId: string | null }
>;

export interface GuestSignal {
  readonly id: string;
  /** The sender's roster `participantKey`: a member's opaque key, or a guest's session id. */
  readonly fromParticipantKey: string;
  readonly kind: CallSignalKind;
  readonly payload: string;
  readonly session: number;
  readonly createdAt: number;
}

export type ServerSignalsMatchPage = Assignable<
  FunctionReturnType<typeof api.guestCalls.signals>,
  readonly GuestSignal[]
>;

/**
 * Maps the guest's reduced roster onto the call view the engine and grid draw.
 * Guests never learn a member's account id: every row is addressed by its
 * `participantKey`, which the engine uses as the peer id. Per the server
 * contract a guest's row is keyed by that guest's own session id (the
 * `guestSessionId` from `guestCalls.lobby`, which is also the engine's identity,
 * so the engine finds its own seat and the grid marks the self tile), and a
 * member's row by an opaque key. `guestCalls.signals` uses the same keys.
 */
export function rosterToCallView(roster: GuestRoster): CallView {
  const startedAt = roster.participants.reduce(
    (earliest, participant) => Math.min(earliest, participant.joinedAt),
    Number.POSITIVE_INFINITY,
  );
  return {
    id: roster.callId,
    channelId: null,
    kind: "video",
    status: roster.callStatus,
    initiatorId: "",
    ringingUserIds: [],
    screenShareUserId: null,
    startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
    participants: roster.participants.map((participant) => ({
      userId: participant.participantKey,
      // The server's election decision for a member seat; the mesh reads it.
      ...(participant.shouldOffer !== undefined ? { shouldOffer: participant.shouldOffer } : {}),
      guestId: participant.isGuest ? participant.participantKey : null,
      isGuest: participant.isGuest,
      displayName: participant.displayName,
      muted: participant.muted,
      deafened: false,
      video: participant.video,
      sharingScreen: false,
      sfu: false,
      joinedAt: participant.joinedAt,
      clientId: null,
      session: participant.session,
      speaking: false,
      audioLevel: 0,
      connection: "connecting",
    })),
    transcribing: roster.transcribing,
    transcriptionSessionId: roster.transcriptionSessionId,
    scheduledCallId: roster.scheduledCallId,
    standalone: true,
    guestCount: roster.participants.filter((participant) => participant.isGuest).length,
    aloneDeadline: null,
  };
}

/** Maps the guest's signal rows onto the engine's, addressed to the guest's own key. */
export function signalsToRows(
  signals: readonly GuestSignal[],
  callId: string,
  selfKey: string,
): CallSignalRow[] {
  return signals.map((signal) => ({
    id: signal.id,
    callId,
    fromUserId: signal.fromParticipantKey,
    toUserId: selfKey,
    kind: signal.kind,
    payload: signal.payload,
    createdAt: signal.createdAt,
    session: signal.session,
  }));
}

/** Ids whose ack failed are kept (bounded) and sent again with the next ack. */
const MAX_UNACKED_RETRY = 256;

function unsupported(what: string): never {
  throw new Error(`Guests cannot ${what}`);
}

/**
 * The call engine's backend for a guest: the same contract as members use, over
 * `guestCalls.*`, authenticated by the session token argument alone. Everything
 * a guest may not do (start, end, decline, share a screen, deafen) is refused
 * here as well as on the server.
 */
export function guestVoicePort(client: ConvexReactClient, sessionToken: string): VoicePort {
  // Acks that failed, so a later ack call retries them instead of losing them.
  let unacked: string[] = [];
  return {
    startCall: () => unsupported("start a call"),
    joinCall: () => unsupported("join a call without being admitted"),
    declineCall: () => unsupported("decline a call"),
    endCall: () => unsupported("end a call"),
    async leaveCall() {
      await client.mutation(api.guestCalls.leave, { sessionToken });
      return null;
    },
    async updateParticipant(args) {
      if (args.muted === undefined && args.video === undefined) {
        // Deafen, streaming-server flags and screen sharing do not exist for guests.
        return null;
      }
      await client.mutation(api.guestCalls.updateParticipant, {
        sessionToken,
        ...(args.muted !== undefined ? { muted: args.muted } : {}),
        ...(args.video !== undefined ? { video: args.video } : {}),
      });
      return null;
    },
    async turnCredentials() {
      return await client.mutation(api.guestCalls.turnCredentials, { sessionToken });
    },
    async callHeartbeat() {
      await client.mutation(api.guestCalls.heartbeat, { sessionToken });
      return null;
    },
    async sendSignal(args) {
      const base = {
        sessionToken,
        toParticipantKey: args.toUserId,
        kind: args.kind,
      };
      const payloads = args.payloads;
      if (payloads === undefined || payloads.length <= 1) {
        await client.mutation(api.guestCalls.signal, { ...base, payload: args.payload });
        return null;
      }
      await client.mutation(api.guestCalls.signal, {
        ...base,
        payload: payloads[0] ?? args.payload,
        payloads: [...payloads],
      });
      return null;
    },
    async ackSignals(args) {
      // Newly received ids plus any earlier failures, once each, in chunks the
      // server accepts. A failed chunk never blocks the rest.
      const ids = [...new Set([...unacked, ...(args.signalIds as readonly string[])])];
      const failed: string[] = [];
      for (let start = 0; start < ids.length; start += GUEST_SIGNAL_ACK_MAX) {
        const chunk = ids.slice(start, start + GUEST_SIGNAL_ACK_MAX);
        try {
          await client.mutation(api.guestCalls.ack, {
            sessionToken,
            signalIds: chunk as never[],
          });
        } catch {
          failed.push(...chunk);
        }
      }
      unacked = failed.slice(-MAX_UNACKED_RETRY);
      return null;
    },
  };
}

/** Live roster and signalling for a guest. A failed query means the call is over for them. */
export function guestVoiceSubscriptions(
  client: ConvexReactClient,
  sessionToken: string,
  selfKey: string,
): VoiceSubscriptions {
  function watch<T>(
    query: Parameters<ConvexReactClient["watchQuery"]>[0],
    onValue: (value: T) => void,
    onFailure: () => void,
  ): () => void {
    const handle = client.watchQuery(query as never, { sessionToken } as never);
    const emit = () => {
      try {
        const value = handle.localQueryResult();
        if (value !== undefined) {
          onValue(value as T);
        }
      } catch {
        // The server refused the read: the call ended or the guest was removed.
        onFailure();
      }
    };
    const unsubscribe = handle.onUpdate(emit);
    emit();
    return unsubscribe;
  }

  const none = () => () => undefined;
  return {
    watchCallById(_callId, onChange) {
      return watch<GuestRoster>(
        api.guestCalls.roster,
        (roster) => {
          onChange(rosterToCallView(roster));
        },
        () => {
          onChange(null);
        },
      );
    },
    watchSignals(callId, onChange) {
      return watch<readonly GuestSignal[]>(
        api.guestCalls.signals,
        (signals) => {
          onChange(signalsToRows(signals, callId, selfKey));
        },
        () => undefined,
      );
    },
    watchCall: none,
    watchIncoming: none,
    watchActiveCalls: none,
  };
}
