import type { ConvexReactClient } from "convex/react";
import { describe, expect, it, vi } from "vitest";
import { convexVoicePort } from "../lib/voice/convex-voice";

function portWith(mutation: ReturnType<typeof vi.fn>) {
  const client = { mutation } as unknown as ConvexReactClient;
  return convexVoicePort(client, "client-1");
}

describe("convexVoicePort.updateParticipant", () => {
  it("forwards the SFU capability so the roster can reach the SFU transport", async () => {
    const mutation = vi.fn().mockResolvedValue(null);
    await portWith(mutation).updateParticipant({ callId: "call-1", sfuCall: true });
    await portWith(mutation).updateParticipant({ callId: "call-1", sfuCall: false });

    expect(mutation).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ callId: "call-1", clientId: "client-1", sfuCall: true }),
    );
    expect(mutation).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ sfuCall: false }),
    );
  });

  it("omits fields the caller did not set", async () => {
    const mutation = vi.fn().mockResolvedValue(null);
    await portWith(mutation).updateParticipant({ callId: "call-1", muted: true });

    const args = mutation.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args).toMatchObject({ muted: true });
    expect("sfuCall" in args).toBe(false);
    expect("sfu" in args).toBe(false);
  });
});
