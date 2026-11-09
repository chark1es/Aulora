import type { CallKind, CallParticipantView, CallStatus, CallView } from "./types";

/** Human label for a call's lifecycle state. */
export function callStatusLabel(status: CallStatus): string {
  switch (status) {
    case "ringing":
      return "Ringing";
    case "active":
      return "Live";
    case "ended":
      return "Ended";
  }
}

/** Human label for a call's kind. */
export function callKindLabel(kind: CallKind): string {
  return kind === "video" ? "Video call" : "Voice call";
}

/**
 * Formats an elapsed call duration as `h:mm:ss` (or `m:ss` under an hour).
 * Non-positive or non-finite input renders `0:00`.
 */
export function formatCallDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0:00";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => value.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Whether the caller is already a participant of the call. */
export function isParticipant(call: CallView | null, userId: string): boolean {
  return selfParticipant(call, userId) !== undefined;
}

/**
 * How long before a solo-call disconnect the in-call warning appears. The
 * server owns the actual deadline; this only decides when to surface it.
 */
export const CALL_ALONE_HINT_MS = 60_000;

/**
 * Milliseconds left on a solo-call deadline, or `null` when the warning should
 * stay hidden (no deadline, already passed, or more than a minute away).
 * `deadline` is a server timestamp, so a reconnect keeps the same countdown.
 */
export function callAloneRemainingMs(
  deadline: number | null | undefined,
  now: number,
): number | null {
  if (deadline === null || deadline === undefined || !Number.isFinite(deadline)) {
    return null;
  }
  const remaining = deadline - now;
  return remaining > 0 && remaining <= CALL_ALONE_HINT_MS ? remaining : null;
}

/**
 * The static sentence assistive technology hears when the solo-call warning
 * appears. The live countdown stays hidden from it, so this does not include
 * the ticking seconds.
 */
export const CALL_ALONE_HINT_MESSAGE =
  "You will be disconnected soon because nobody else is in the call. Press Stay to remain.";

/** A `m:ss` countdown label for {@link callAloneRemainingMs} (e.g. `0:45`). */
export function formatAloneCountdown(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Human duration for a solo-call notice, e.g. `5 minutes`. Falls back to a
 * non-numeric phrase when an older backend does not report the configured
 * window, so the UI never invents a timeout.
 */
export function callAloneTimeoutLabel(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return "a while";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) {
    return `${Math.max(1, Math.round(seconds))} seconds`;
  }
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/** The viewer's own row, if they are in the call. */
export function selfParticipant(
  call: CallView | null,
  userId: string,
): CallParticipantView | undefined {
  return call?.participants.find((participant) => participant.userId === userId);
}

/**
 * True when this device holds the seat. A missing client id (a seat from
 * before device tracking) counts as this device so a live call is not shown
 * as someone else's.
 */
export function isOnThisDevice(
  call: CallView | null,
  userId: string,
  clientId: string | null,
): boolean {
  const self = selfParticipant(call, userId);
  if (self === undefined) {
    return false;
  }
  // Unknown client (not loaded yet, or a pre-tracking seat) stays on this device.
  if (self.clientId === null || clientId === null || clientId.length === 0) {
    return true;
  }
  return self.clientId === clientId;
}

/** True when the user is in this call, but a different device holds the seat. */
export function isOnAnotherDevice(
  call: CallView | null,
  userId: string,
  clientId: string | null,
): boolean {
  if (clientId === null || clientId.length === 0) {
    return false;
  }
  const self = selfParticipant(call, userId);
  return self?.clientId != null && self.clientId !== clientId;
}

/**
 * The voice-channel pane should be the "joined elsewhere" screen.
 * This install is not the one connected (`localCallId`), including seats that
 * never recorded a client id. A missing id must not look like a local call.
 */
export function joinedElsewhere(
  call: CallView | null,
  userId: string,
  clientId: string | null,
  localCallId: string | null,
): boolean {
  if (call === null || call.status === "ended" || !isParticipant(call, userId)) {
    return false;
  }
  if (isOnAnotherDevice(call, userId, clientId)) {
    return true;
  }
  return localCallId !== call.id;
}

/** The live call this user is in from some other device, if any. */
export function callOnAnotherDevice(
  calls: readonly CallView[],
  userId: string,
  clientId: string | null,
): CallView | null {
  return (
    calls.find((call) => call.status !== "ended" && isOnAnotherDevice(call, userId, clientId)) ??
    null
  );
}

/** Whether the caller is currently being rung by this call. */
export function isRinging(call: CallView, userId: string): boolean {
  return call.status === "ringing" && call.ringingUserIds.includes(userId);
}

/** The participant sharing their screen, if any. */
export function screenSharer(call: CallView): CallParticipantView | undefined {
  if (call.screenShareUserId === null) {
    return undefined;
  }
  return call.participants.find((participant) => participant.userId === call.screenShareUserId);
}

/**
 * Sorting for participant tiles: screen sharers first, then video, then
 * everyone else; stable within a group by join time.
 */
export function sortParticipants(
  participants: readonly CallParticipantView[],
): readonly CallParticipantView[] {
  const rank = (participant: CallParticipantView): number => {
    if (participant.sharingScreen) {
      return 0;
    }
    if (participant.video) {
      return 1;
    }
    return 2;
  };
  return [...participants].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    return byRank !== 0 ? byRank : a.joinedAt - b.joinedAt;
  });
}

/**
 * The participant who should create the WebRTC offer for a given pair, using a
 * deterministic tie-break so both peers agree without extra signalling. The
 * lexicographically smaller id offers; the other answers.
 */
export function shouldOffer(selfUserId: string, remoteUserId: string): boolean {
  return selfUserId < remoteUserId;
}

/** A coarse network-quality bucket derived from packet loss and round-trip time. */
export function networkQuality(
  packetLoss: number,
  roundTripTimeMs: number,
): "good" | "fair" | "poor" {
  if (packetLoss > 0.08 || roundTripTimeMs > 400) {
    return "poor";
  }
  if (packetLoss > 0.03 || roundTripTimeMs > 200) {
    return "fair";
  }
  return "good";
}
