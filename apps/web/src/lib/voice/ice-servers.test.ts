import type { TurnCredentials } from "@aulora/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IceServerSource, mergeIceServers, TURN_REFRESH_MARGIN_SECONDS } from "./ice-servers";

const STUN: RTCIceServer = { urls: ["stun:stun.example.com:3478"] };
const DEPLOYMENT_TURN: RTCIceServer = {
  urls: "turn:relay.example.com:3478",
  username: "operator",
  credential: "long-lived",
};

function turn(overrides: Partial<TurnCredentials> = {}): TurnCredentials {
  return {
    urls: ["turn:relay.example.com:3478", "turns:relay.example.com:5349"],
    username: "1800000000:user-1",
    credential: "signed",
    ttlSeconds: 900,
    expiresAt: 1_800_000_000,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("mergeIceServers", () => {
  it("leaves the deployment list untouched without a TURN credential", () => {
    expect(mergeIceServers([STUN], null)).toEqual([STUN]);
    expect(mergeIceServers([], null)).toEqual([]);
  });

  it("appends the ephemeral credential as one server entry", () => {
    const merged = mergeIceServers([STUN], turn());
    expect(merged).toEqual([
      STUN,
      {
        urls: ["turn:relay.example.com:3478", "turns:relay.example.com:5349"],
        username: "1800000000:user-1",
        credential: "signed",
      },
    ]);
  });

  it("drops a configured URL the ephemeral credential also covers", () => {
    const merged = mergeIceServers([STUN, DEPLOYMENT_TURN], turn());
    expect(merged).toHaveLength(2);
    expect(merged[0]).toBe(STUN);
    expect(merged[1]?.username).toBe("1800000000:user-1");
  });

  it("keeps a configured TURN server for a URL the credential does not cover", () => {
    const other: RTCIceServer = {
      urls: ["turn:other.example.com:3478"],
      username: "operator",
      credential: "long-lived",
    };
    const merged = mergeIceServers([other], turn());
    expect(merged.map((server) => server.urls)).toEqual([
      ["turn:other.example.com:3478"],
      ["turn:relay.example.com:3478", "turns:relay.example.com:5349"],
    ]);
  });
});

describe("IceServerSource", () => {
  it("fetches once and refreshes before the credential expires", async () => {
    vi.useFakeTimers();
    const fetchTurn = vi
      .fn<() => Promise<TurnCredentials | null>>()
      .mockResolvedValueOnce(turn())
      .mockResolvedValueOnce(turn({ username: "1800001500:user-1" }));
    const source = new IceServerSource({ base: () => [STUN], fetchTurn });

    await source.load();
    await source.load();
    expect(fetchTurn).toHaveBeenCalledTimes(1);
    expect(source.current()[1]?.username).toBe("1800000000:user-1");

    await vi.advanceTimersByTimeAsync((900 - TURN_REFRESH_MARGIN_SECONDS) * 1000);
    expect(fetchTurn).toHaveBeenCalledTimes(2);
    expect(source.current()[1]?.username).toBe("1800001500:user-1");
    source.dispose();
  });

  it("does not schedule a refresh when the deployment has no TURN server", async () => {
    vi.useFakeTimers();
    const fetchTurn = vi.fn<() => Promise<TurnCredentials | null>>().mockResolvedValue(null);
    const onChange = vi.fn();
    const source = new IceServerSource({ base: () => [STUN], fetchTurn, onChange });

    await source.load();
    expect(fetchTurn).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(fetchTurn).toHaveBeenCalledTimes(1);
    expect(source.current()).toEqual([STUN]);
    source.dispose();
  });

  it("keeps the previous credential and retries after a failed refresh", async () => {
    vi.useFakeTimers();
    const fetchTurn = vi
      .fn<() => Promise<TurnCredentials | null>>()
      .mockResolvedValueOnce(turn())
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(turn({ username: "1800003000:user-1" }));
    const source = new IceServerSource({ base: () => [], fetchTurn });

    await source.load();
    await vi.advanceTimersByTimeAsync((900 - TURN_REFRESH_MARGIN_SECONDS) * 1000);
    expect(fetchTurn).toHaveBeenCalledTimes(2);
    // Still the old, still-valid credential.
    expect(source.current()[0]?.username).toBe("1800000000:user-1");

    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(fetchTurn).toHaveBeenCalledTimes(3);
    expect(source.current()[0]?.username).toBe("1800003000:user-1");
    source.dispose();
  });

  it("stops refreshing after dispose", async () => {
    vi.useFakeTimers();
    const fetchTurn = vi.fn<() => Promise<TurnCredentials | null>>().mockResolvedValue(turn());
    const source = new IceServerSource({ base: () => [STUN], fetchTurn });

    await source.load();
    source.dispose();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(fetchTurn).toHaveBeenCalledTimes(1);
    expect(source.current()).toEqual([STUN]);
  });
});
