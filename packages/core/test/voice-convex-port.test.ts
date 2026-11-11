import { describe, expect, it, vi } from "vitest";
import { createVoicePortBase, type VoiceCallMutationRefs } from "../src/voice/convex-port";
import { CallElsewhereError } from "../src/voice/seat";

const calls: VoiceCallMutationRefs = {
  start: "calls.start",
  join: "calls.join",
  leave: "calls.leave",
  end: "calls.end",
  decline: "calls.decline",
  updateParticipant: "calls.updateParticipant",
  heartbeat: "calls.heartbeat",
  stay: "calls.stay",
  signal: "calls.signal",
  ack: "calls.ack",
};

function recorder(result: unknown = null) {
  const recorded: Array<{ ref: unknown; args: Record<string, unknown> }> = [];
  const mutation = vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
    recorded.push({ ref, args });
    return result;
  });
  return { recorded, mutation };
}

describe("createVoicePortBase", () => {
  it("starts a call with the client id and optional ringing users", async () => {
    const { recorded, mutation } = recorder({ callId: "call-1", created: true });
    const port = createVoicePortBase("device-1", calls, mutation);
    await expect(
      port.startCall({ channelId: "c1", kind: "voice", ringingUserIds: ["u1"] }),
    ).resolves.toEqual({ callId: "call-1", created: true });
    expect(recorded[0]).toEqual({
      ref: "calls.start",
      args: { channelId: "c1", kind: "voice", clientId: "device-1", ringingUserIds: ["u1"] },
    });
  });

  it("omits absent participant flags", async () => {
    const { recorded, mutation } = recorder();
    const port = createVoicePortBase("device-1", calls, mutation);
    await port.updateParticipant({ callId: "call-1", muted: true });
    expect(recorded[0]?.args).toEqual({ callId: "call-1", clientId: "device-1", muted: true });
  });

  it("translates a call_elsewhere error", async () => {
    const mutation = vi.fn(async () => {
      const error = new Error("elsewhere") as Error & { data: unknown };
      error.data = { code: "call_elsewhere", callId: "call-1", channelId: "c1" };
      throw error;
    });
    const port = createVoicePortBase("device-1", calls, mutation);
    await expect(port.joinCall({ callId: "call-1" })).rejects.toBeInstanceOf(CallElsewhereError);
  });

  it("sends one envelope when the signal has no batch", async () => {
    const { recorded, mutation } = recorder();
    const port = createVoicePortBase("device-1", calls, mutation);
    await port.sendSignal({
      callId: "call-1",
      toUserId: "u2",
      kind: "ice",
      payload: "single",
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.args.payload).toBe("single");
  });

  it("retries batched signals one envelope at a time when the server rejects the batch", async () => {
    const recorded: Array<Record<string, unknown>> = [];
    const mutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      recorded.push(args);
      if (recorded.length === 1) throw new Error("extra field");
      return null;
    });
    const port = createVoicePortBase("device-1", calls, mutation);
    await port.sendSignal({
      callId: "call-1",
      toUserId: "u2",
      kind: "ice",
      payload: "a",
      payloads: ["a", "b"],
    });
    expect(recorded).toHaveLength(3);
    expect(recorded[1]?.payload).toBe("a");
    expect(recorded[2]?.payload).toBe("b");
  });
});
