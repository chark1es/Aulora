import type { ConvexReactClient } from "convex/react";
import { describe, expect, it, vi } from "vitest";
import { convexVoicePort } from "../lib/voice/convex-voice";

/** The shape the adapter uses; the fake records the calls made through it. */
type Mutation = (ref: unknown, args: unknown) => Promise<unknown>;

/** The adapter only needs `mutation` for signalling; the rest is unused here. */
function clientWith(mutation: Mutation): ConvexReactClient {
  return { mutation } as unknown as ConvexReactClient;
}

describe("convex voice signalling", () => {
  it("sends a pooled ICE batch in one mutation", async () => {
    const mutation = vi.fn<Mutation>(async () => null);
    const port = convexVoicePort(clientWith(mutation), "device-a");

    await port.sendSignal({
      callId: "call-1",
      toUserId: "them",
      kind: "ice",
      payload: "a",
      payloads: ["a", "b"],
    });

    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation.mock.calls[0]?.[1]).toMatchObject({
      payload: "a",
      payloads: ["a", "b"],
    });
  });

  it("sends a single payload without the batch field", async () => {
    const mutation = vi.fn<Mutation>(async () => null);
    const port = convexVoicePort(clientWith(mutation), "device-a");

    await port.sendSignal({
      callId: "call-1",
      toUserId: "them",
      kind: "offer",
      payload: "v=0",
    });

    expect(mutation).toHaveBeenCalledTimes(1);
    const args = mutation.mock.calls[0]?.[1];
    expect(args).toMatchObject({ payload: "v=0" });
    expect(args).not.toHaveProperty("payloads");
  });

  it("falls back to one mutation per payload when the backend rejects batching", async () => {
    const mutation = vi.fn<Mutation>(async () => null);
    mutation.mockRejectedValueOnce(new Error("extra field payloads"));
    const port = convexVoicePort(clientWith(mutation), "device-a");

    await port.sendSignal({
      callId: "call-1",
      toUserId: "them",
      kind: "ice",
      payload: "a",
      payloads: ["a", "b"],
    });

    // One rejected batch attempt, then the two payloads on their own.
    expect(mutation).toHaveBeenCalledTimes(3);
    expect(mutation.mock.calls[1]?.[1]).toMatchObject({ payload: "a" });
    expect(mutation.mock.calls[2]?.[1]).toMatchObject({ payload: "b" });
  });
});
