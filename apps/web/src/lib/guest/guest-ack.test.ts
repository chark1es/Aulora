import { type CallSignalRow, GUEST_SIGNAL_ACK_MAX } from "@aulora/core";
import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { PeerMesh, type PeerMeshHost } from "../voice/peer-mesh";
import { guestVoicePort } from "./guest-voice";

/** What the server enforces on `guestCalls.ack` (MAX_SIGNAL_BATCH). */
const SERVER_CAP = 32;

function server(options: { failCall?: (call: number) => boolean } = {}) {
  const calls: string[][] = [];
  const acked = new Set<string>();
  const client = {
    mutation: vi.fn((reference: Parameters<typeof getFunctionName>[0], args: unknown) => {
      expect(getFunctionName(reference)).toBe("guestCalls:ack");
      const ids = (args as { signalIds: string[] }).signalIds;
      calls.push(ids);
      if (ids.length > SERVER_CAP) {
        return Promise.reject(new Error("Too many signals"));
      }
      if (options.failCall?.(calls.length) === true) {
        return Promise.reject(new Error("network"));
      }
      for (const id of ids) {
        acked.add(id);
      }
      return Promise.resolve(null);
    }),
  };
  return { client, calls, acked };
}

/** The real mesh, acknowledging through the real guest port, as in a guest call. */
function meshOver(client: unknown): PeerMesh {
  const port = guestVoicePort(client as never, "ags_tok");
  const host: PeerMeshHost = {
    userId: "guest-self",
    getCallId: () => "call-1",
    getIceServers: () => [],
    sendSignal: () => Promise.resolve(null),
    ackSignals: (ids) => port.ackSignals({ signalIds: ids as never }),
    onError: () => undefined,
    onChange: () => undefined,
    getAudioTrack: () => null,
    getVideoTrack: () => null,
    isScreenSharing: () => false,
    getScreenProfile: () => ({ maxBitrate: 0, frameRate: 0 }),
    getCameraProfile: () => ({ maxBitrate: 0, frameRate: 0 }),
    getVideoCodec: () => "auto",
    onRemoteLevel: () => undefined,
  };
  return new PeerMesh(host);
}

function ice(count: number, from = 0): CallSignalRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `sig-${from + index}`,
    callId: "call-1",
    fromUserId: "member-key",
    toUserId: "guest-self",
    kind: "ice" as const,
    payload: "{}",
    createdAt: 1,
    session: 1,
  }));
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("guest signal acks respect the server's batch cap", () => {
  it("uses the shared cap, which equals the server's", () => {
    expect(GUEST_SIGNAL_ACK_MAX).toBe(SERVER_CAP);
  });

  it("acknowledges a burst of 64 signals in two calls of 32 covering every id", async () => {
    const { client, calls, acked } = server();
    const mesh = meshOver(client);
    await mesh.handleSignals(ice(64));
    await settle();
    expect(calls.map((ids) => ids.length)).toEqual([32, 32]);
    expect(acked.size).toBe(64);
    expect(Math.max(...calls.map((ids) => ids.length))).toBeLessThanOrEqual(SERVER_CAP);
  });

  it("never sends more than the cap in one call, whatever the burst", async () => {
    const { client, calls, acked } = server();
    const mesh = meshOver(client);
    await mesh.handleSignals(ice(100));
    await settle();
    expect(calls.map((ids) => ids.length)).toEqual([32, 32, 32, 4]);
    expect(acked.size).toBe(100);
  });

  it("keeps going when one chunk fails, and retries the failed ids with the next ack", async () => {
    const { client, calls, acked } = server({ failCall: (call) => call === 1 });
    const mesh = meshOver(client);
    await mesh.handleSignals(ice(64));
    await settle();
    // The second chunk still went out.
    expect(calls).toHaveLength(2);
    expect(acked.size).toBe(32);
    expect([...acked].every((id) => calls[1]?.includes(id))).toBe(true);
    // The next batch of signals carries the failed ids along.
    await mesh.handleSignals(ice(5, 1000));
    await settle();
    expect(acked.size).toBe(64 + 5);
    expect(calls.every((ids) => ids.length <= SERVER_CAP)).toBe(true);
  });
});
