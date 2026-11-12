import { GUEST_LINK_GENERIC_ERROR, parseScheduledCallNotOpen } from "@aulora/core";

/** What the guest sees when asking to join fails, never more than the server meant to say. */
export type JoinFailure =
  /** The link is unusable: invalid, expired, revoked, used up, or removed. One message for all. */
  | { readonly kind: "unavailable" }
  | { readonly kind: "not-open"; readonly startsAt: number; readonly opensAt: number }
  | { readonly kind: "not-started" }
  | { readonly kind: "busy" }
  | { readonly kind: "rate-limited" }
  | { readonly kind: "invalid-input"; readonly message: string }
  | { readonly kind: "generic" };

/** Server messages that are safe and useful to show as they are: only the input rules. */
const INPUT_MESSAGE = /^(Display name must be|Affiliation must be)/u;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

/**
 * Classifies an error from the guest functions. An unknown error becomes a
 * generic one: its text is never shown, so nothing the server did not mean to
 * tell a guest can leak through the page.
 */
export function classifyJoinFailure(error: unknown): JoinFailure {
  const notOpen = parseScheduledCallNotOpen(error);
  if (notOpen !== null) {
    return { kind: "not-open", ...notOpen };
  }
  const message = messageOf(error);
  if (message.includes(GUEST_LINK_GENERIC_ERROR)) {
    return { kind: "unavailable" };
  }
  if (message.includes("The call hasn't started yet")) {
    return { kind: "not-started" };
  }
  if (message.includes("Too many people are waiting")) {
    return { kind: "busy" };
  }
  if (message.includes("Rate limit exceeded")) {
    return { kind: "rate-limited" };
  }
  const input = INPUT_MESSAGE.exec(message);
  if (input !== null) {
    const line = message.split("\n")[0] ?? message;
    return { kind: "invalid-input", message: line.slice(line.indexOf(input[0])).slice(0, 120) };
  }
  return { kind: "generic" };
}

export type LobbyStatus = "pending" | "admitted" | "denied" | "removed" | "left" | "expired";

/** The screen for each stage of a guest's visit. */
export type GuestScreen =
  | "loading"
  | "link-unavailable"
  | "form"
  | "waiting"
  | "in-call"
  | "denied"
  | "removed"
  | "ended"
  | "expired";

/**
 * Chooses the screen from what is known: whether a session exists, the lobby
 * status the server last reported, and whether the call is still live. The
 * server's status is the truth; this only maps it.
 */
export function screenFor(input: {
  readonly resolving: boolean;
  readonly linkOk: boolean | null;
  readonly hasSession: boolean;
  readonly lobby: LobbyStatus | "gone" | undefined;
  readonly callEnded: boolean;
  /**
   * The server reported this session as admitted at some point in this visit.
   * The server now reports a lapsed request, or an admitted session past its
   * cap, as `expired` without waiting for a sweep: only a session that had been
   * admitted is over *for them*; a request that never was simply timed out.
   */
  readonly wasAdmitted?: boolean;
}): GuestScreen {
  if (input.hasSession) {
    if (input.lobby === undefined) {
      return "loading";
    }
    switch (input.lobby) {
      case "pending":
        return "waiting";
      case "admitted":
        // The call going away under an admitted guest is the same ending for them.
        return input.callEnded ? "ended" : "in-call";
      case "denied":
        return "denied";
      case "removed":
        return "removed";
      case "expired":
        return input.wasAdmitted === true ? "ended" : "expired";
      case "left":
        return "ended";
      case "gone":
        return "link-unavailable";
    }
  }
  if (input.resolving || input.linkOk === null) {
    return "loading";
  }
  return input.linkOk ? "form" : "link-unavailable";
}

export interface PreviewView {
  readonly title: string;
  readonly open: boolean;
  readonly startsAt: number | null;
  readonly opensAt: number | null;
}

export type PreviewNotice =
  | { readonly kind: "open" }
  | { readonly kind: "opens-later"; readonly startsAt: number; readonly opensAt: number }
  | { readonly kind: "waiting-for-host" };

/** What the lobby form says about whether the call can be joined yet. */
export function previewNotice(preview: PreviewView, now: number): PreviewNotice {
  if (preview.open) {
    return { kind: "open" };
  }
  if (preview.startsAt !== null && preview.opensAt !== null && now < preview.opensAt) {
    return { kind: "opens-later", startsAt: preview.startsAt, opensAt: preview.opensAt };
  }
  return { kind: "waiting-for-host" };
}
