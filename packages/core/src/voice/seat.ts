import { callOnAnotherDevice } from "./state";
import type { CallView } from "./types";

/** Convex error code when the seat is held by a different client. */
export const CALL_ELSEWHERE = "call_elsewhere";

/**
 * Thrown by the voice port when joining would disconnect another device and
 * the caller has not confirmed that yet.
 */
export class CallElsewhereError extends Error {
  readonly code = CALL_ELSEWHERE;
  readonly callId: string;
  readonly channelId: string;

  constructor(callId: string, channelId: string) {
    super("You are already in a call on another device");
    this.name = "CallElsewhereError";
    this.callId = callId;
    this.channelId = channelId;
  }
}

export function isCallElsewhereError(error: unknown): error is CallElsewhereError {
  return error instanceof CallElsewhereError;
}

/** Pulls a `call_elsewhere` payload off a Convex (or similarly shaped) error. */
export function callElsewhereFromUnknown(error: unknown): CallElsewhereError | null {
  if (typeof error !== "object" || error === null || !("data" in error)) {
    return null;
  }
  const data = (error as { data: unknown }).data;
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const record = data as Record<string, unknown>;
  if (record.code !== CALL_ELSEWHERE) {
    return null;
  }
  if (typeof record.callId !== "string" || typeof record.channelId !== "string") {
    return null;
  }
  return new CallElsewhereError(record.callId, record.channelId);
}

/** Result of trying to take the single call seat. */
export type CallSeatResult =
  | { readonly status: "joined"; readonly callId: string }
  | { readonly status: "elsewhere"; readonly callId: string; readonly channelId: string }
  | { readonly status: "failed" }
  | { readonly status: "cancelled" };

/**
 * One user, one call. If another device already holds a seat, `confirm` must
 * accept before `run` is invoked with `takeover`. A rejection from the server
 * (the local roster was stale) asks again and retries once.
 */
export async function claimCallSeat(args: {
  readonly calls: readonly CallView[];
  readonly userId: string;
  readonly clientId: string | null;
  readonly confirm: () => Promise<boolean>;
  readonly run: (takeover: boolean) => Promise<Exclude<CallSeatResult, { status: "cancelled" }>>;
}): Promise<CallSeatResult> {
  let takeover = false;
  if (callOnAnotherDevice(args.calls, args.userId, args.clientId) !== null) {
    if (!(await args.confirm())) {
      return { status: "cancelled" };
    }
    takeover = true;
  }
  const result = await args.run(takeover);
  if (result.status !== "elsewhere") {
    return result;
  }
  if (!(await args.confirm())) {
    return { status: "cancelled" };
  }
  return await args.run(true);
}
