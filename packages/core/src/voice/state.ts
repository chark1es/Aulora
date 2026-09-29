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
  return call?.participants.some((participant) => participant.userId === userId) ?? false;
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
