import type { PresenceRow, TypingRow } from "@aulora/core";

export type PresenceStatus = PresenceRow["status"];

const PRESENCE_LABELS: Record<PresenceStatus, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do not disturb",
  offline: "Offline",
};

/** Human label for a presence status. */
export function presenceLabel(status: string): string {
  return PRESENCE_LABELS[status as PresenceStatus] ?? "Offline";
}

/** True when the status should render as active (a filled presence dot). */
export function isActivePresence(status: string): boolean {
  return status === "online" || status === "idle" || status === "dnd";
}

/**
 * Builds the "who is typing" line. Typers older than `now` (an expired row)
 * are ignored, and the current user is omitted. Returns `null` when nobody is
 * typing.
 */
export function typingLabel(
  typers: readonly TypingRow[],
  ownUserId: string,
  nameOf: (userId: string) => string,
  now: number = Date.now(),
): string | null {
  const active = typers.filter((typer) => typer.expiresAt > now && typer.userId !== ownUserId);
  if (active.length === 0) {
    return null;
  }
  const names = active.map((typer) => nameOf(typer.userId));
  if (names.length === 1) {
    return `${names[0]} is typing…`;
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]} are typing…`;
  }
  return `${names.length} people are typing…`;
}
