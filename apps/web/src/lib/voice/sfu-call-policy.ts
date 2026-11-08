/**
 * Transport policy for calls, kept pure so it is testable without a browser.
 *
 * Calls are a full peer-to-peer mesh: each client encodes and uploads one copy
 * of its camera per remote participant. That is the lowest-latency path for a
 * small call, and it needs no media server. It stops scaling past a few people,
 * so a large call whose participants all support it moves audio and camera to
 * the workspace's streaming server (LiveKit). The mesh stays the default and
 * the fallback, and a single flag turns the SFU path off.
 */

/** Kill switch: flip to `false` to keep every call on the peer mesh. */
export const SFU_CALL_ENABLED = true;

/** Participant count above which the SFU carries the call. */
export const SFU_CALL_THRESHOLD = 4;

/** Capability a client advertises on its roster row for the SFU transport. */
export const SFU_CALL_CAPABILITY = "sfu-call";

export type CallTransport = "mesh" | "sfu";

export interface TransportDecisionInput {
  /** Participants currently in the call, including this client. */
  readonly participants: number;
  /** The workspace has a streaming server this client can reach. */
  readonly sfuConfigured: boolean;
  /** One capability list per participant, in roster order. */
  readonly capabilities: readonly (readonly string[])[];
  /** Defaults to {@link SFU_CALL_THRESHOLD}. */
  readonly threshold?: number;
}

/**
 * `sfu` only when the call is larger than the threshold, a server is
 * configured, and *every* participant advertises the capability. One mobile or
 * older client keeps the whole call on the mesh, so a mixed room never has
 * half its media on each path.
 */
export function decideTransport(input: TransportDecisionInput): CallTransport {
  const threshold = input.threshold ?? SFU_CALL_THRESHOLD;
  if (input.participants <= threshold) {
    return "mesh";
  }
  if (!input.sfuConfigured) {
    return "mesh";
  }
  if (input.capabilities.length !== input.participants) {
    return "mesh";
  }
  const everyone = input.capabilities.every((sources) => sources.includes(SFU_CALL_CAPABILITY));
  return everyone ? "sfu" : "mesh";
}

/** The capability lists for a roster, from the additive `sfuCall` flag. */
export function capabilitiesOf(
  participants: readonly { readonly sfuCall?: boolean }[],
): readonly (readonly string[])[] {
  return participants.map((participant) =>
    participant.sfuCall === true ? [SFU_CALL_CAPABILITY] : [],
  );
}
