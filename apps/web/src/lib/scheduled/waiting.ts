import { type ScheduledCallStatus, scheduledJoinState } from "@aulora/core";

/** One of the caller's own waiting-room rows, as `scheduledCalls.mine` returns it. */
export interface MyWaiting {
  readonly id: string;
  readonly scheduledCallId: string;
  readonly title: string;
  readonly kind: "early" | "knock";
  readonly state: "waiting" | "admitted" | "declined";
  readonly callStatus: ScheduledCallStatus;
  readonly opensAt: number;
  readonly startsAt: number;
  readonly expiresAt: number;
}

/**
 * True when the member can walk in now: a host admitted them, or they are an
 * early arrival and the call has opened (by its status or by the clock). The
 * server re-checks on the join itself.
 */
export function waitingReady(waiting: MyWaiting, now: number): boolean {
  if (waiting.state === "admitted") {
    return true;
  }
  return (
    waiting.state === "waiting" &&
    waiting.kind === "early" &&
    (waiting.callStatus === "open" || now >= waiting.opensAt)
  );
}

/** The fields of a scheduled call the join button depends on. */
export interface JoinableCall {
  readonly status: ScheduledCallStatus;
  readonly startsAt: number;
  readonly openLeadMinutes: number;
  readonly canJoin?: boolean;
  readonly canJoinEarly?: boolean;
  /** Absent on a server from before the waiting room. */
  readonly inviteOnly?: boolean;
  readonly invited?: boolean;
}

export type RowMode =
  | { readonly kind: "closed" }
  /** Join now. `ready` is true when the waiting room is what let the member in. */
  | { readonly kind: "join"; readonly ready: boolean }
  /** An administrator joining before the open time. */
  | { readonly kind: "join-early" }
  /** Allowed in, but not open yet: wait in the waiting room. */
  | { readonly kind: "wait" }
  /** Not on the list of an invite-only call: ask a host. */
  | { readonly kind: "ask" }
  | { readonly kind: "waiting"; readonly waitingKind: "early" | "knock"; readonly opensAt: number }
  | { readonly kind: "declined" }
  /** A server without the waiting room: the plain disabled Join. */
  | { readonly kind: "not-open" };

/** What a Scheduled-tab row offers this viewer right now. */
export function rowMode(call: JoinableCall, waiting: MyWaiting | undefined, now: number): RowMode {
  const state = scheduledJoinState(call, now);
  if (state.kind === "cancelled" || state.kind === "ended") {
    return { kind: "closed" };
  }
  if (waiting?.state === "declined") {
    return { kind: "declined" };
  }
  if (waiting !== undefined && waitingReady(waiting, now)) {
    return { kind: "join", ready: true };
  }
  if (waiting?.state === "waiting") {
    return { kind: "waiting", waitingKind: waiting.kind, opensAt: waiting.opensAt };
  }
  if (call.inviteOnly === true && call.invited === false) {
    return { kind: "ask" };
  }
  if (state.kind === "open") {
    return { kind: "join", ready: false };
  }
  if (call.canJoinEarly === true) {
    return { kind: "join-early" };
  }
  return call.invited === true ? { kind: "wait" } : { kind: "not-open" };
}

/** Index waiting rows by call. */
export function waitingByCall(rows: readonly MyWaiting[] | undefined): Map<string, MyWaiting> {
  const map = new Map<string, MyWaiting>();
  for (const row of rows ?? []) {
    map.set(row.scheduledCallId, row);
  }
  return map;
}

/** Calls this far from opening (or already open) show the host a waiting count. */
export const WAITING_WATCH_WINDOW_MS = 24 * 60 * 60_000;
