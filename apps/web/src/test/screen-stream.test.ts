import { DEFAULT_VOICE_SETTINGS, type SfuAccess } from "@aulora/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DisplayCapture } from "../lib/voice/display";
import { ScreenStreamer, type ScreenStreamHost } from "../lib/voice/screen-stream";
import type { SfuConnection, SfuConnector, SfuHandlers } from "../lib/voice/sfu-room";

const ACCESS: SfuAccess = { url: "wss://stream.example.com", token: "t", canPublish: true };

const capture: DisplayCapture = {
  video: { kind: "video" } as MediaStreamTrack,
  audio: null,
  stop: () => undefined,
};

interface Harness {
  readonly streamer: ScreenStreamer;
  readonly host: ScreenStreamHost & {
    capable: boolean[];
    lost: number;
    screens: ReadonlyMap<string, MediaStream>[];
  };
  readonly connection: SfuConnection & { publish: ReturnType<typeof vi.fn> };
  readonly connector: ReturnType<typeof vi.fn>;
  handlers(): SfuHandlers;
}

function harness(
  options: { access?: SfuAccess | null | Error; connectError?: Error; publishError?: Error } = {},
): Harness {
  let captured: SfuHandlers | null = null;
  const connection = {
    publish: vi.fn(async () => {
      if (options.publishError !== undefined) {
        throw options.publishError;
      }
    }),
    unpublish: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
  };
  const connector = vi.fn(async (_access: SfuAccess, handlers: SfuHandlers) => {
    if (options.connectError !== undefined) {
      throw options.connectError;
    }
    captured = handlers;
    return connection;
  });
  const host = {
    capable: [] as boolean[],
    lost: 0,
    screens: [] as ReadonlyMap<string, MediaStream>[],
    fetchAccess: async () => {
      if (options.access instanceof Error) {
        throw options.access;
      }
      return options.access === undefined ? ACCESS : options.access;
    },
    reportCapable(value: boolean) {
      host.capable.push(value);
    },
    onScreens(screens: ReadonlyMap<string, MediaStream>) {
      host.screens.push(screens);
    },
    onPublishLost() {
      host.lost += 1;
    },
  };
  return {
    streamer: new ScreenStreamer(host, connector as unknown as SfuConnector),
    host,
    connection,
    connector,
    handlers() {
      if (captured === null) {
        throw new Error("not connected");
      }
      return captured;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ScreenStreamer.probe", () => {
  it("reports capable when the workspace has a streaming server", async () => {
    const h = harness();
    expect(await h.streamer.probe()).toBe(true);
    expect(h.streamer.capable).toBe(true);
    expect(h.host.capable).toEqual([true]);
  });

  it("reports not capable when there is no server", async () => {
    const h = harness({ access: null });
    expect(await h.streamer.probe()).toBe(false);
    expect(h.streamer.capable).toBe(false);
    expect(h.host.capable).toEqual([false]);
  });

  it("treats a failed lookup as not capable instead of throwing", async () => {
    const h = harness({ access: new Error("offline") });
    await expect(h.streamer.probe()).resolves.toBe(false);
    expect(h.host.capable).toEqual([false]);
  });

  it("ignores a lookup that finishes after the call ended", async () => {
    const h = harness();
    const pending = h.streamer.probe();
    await h.streamer.reset();
    expect(await pending).toBe(false);
    expect(h.streamer.capable).toBe(false);
    expect(h.host.capable).toEqual([]);
  });
});

describe("ScreenStreamer.publish", () => {
  it("publishes through the server and reports success", async () => {
    const h = harness();
    await h.streamer.probe();
    expect(await h.streamer.publish(capture, DEFAULT_VOICE_SETTINGS)).toBe(true);
    expect(h.connection.publish).toHaveBeenCalledWith(
      capture,
      expect.objectContaining({ codec: "auto" }),
    );
  });

  it("declines when the user may not publish, leaving the share to the mesh", async () => {
    const h = harness({ access: { ...ACCESS, canPublish: false } });
    await h.streamer.probe();
    expect(await h.streamer.publish(capture, DEFAULT_VOICE_SETTINGS)).toBe(false);
    expect(h.connector).not.toHaveBeenCalled();
  });

  it("declines before a probe has found a server", async () => {
    const h = harness();
    expect(await h.streamer.publish(capture, DEFAULT_VOICE_SETTINGS)).toBe(false);
  });

  it("falls back, and tells the roster, when the server cannot be reached", async () => {
    const h = harness({ connectError: new Error("refused") });
    await h.streamer.probe();
    expect(await h.streamer.publish(capture, DEFAULT_VOICE_SETTINGS)).toBe(false);
    expect(h.host.capable).toEqual([true, false]);
  });

  it("falls back and disconnects when the publish itself fails", async () => {
    const h = harness({ publishError: new Error("no permission") });
    await h.streamer.probe();
    expect(await h.streamer.publish(capture, DEFAULT_VOICE_SETTINGS)).toBe(false);
    expect(h.connection.disconnect).toHaveBeenCalled();
    expect(h.host.capable.at(-1)).toBe(false);
  });

  it("tells the engine when a live stream is lost so it can resume on the mesh", async () => {
    const h = harness();
    await h.streamer.probe();
    await h.streamer.publish(capture, DEFAULT_VOICE_SETTINGS);
    h.handlers().onClosed();
    expect(h.host.lost).toBe(1);
    expect(h.host.capable.at(-1)).toBe(false);
  });

  it("does not report a loss for a viewer-only connection", async () => {
    const h = harness();
    await h.streamer.probe();
    await h.streamer.watch();
    h.handlers().onClosed();
    expect(h.host.lost).toBe(0);
    // Still tells the roster, so a sharer sends this viewer the mesh copy.
    expect(h.host.capable.at(-1)).toBe(false);
  });

  it("reports itself reachable again after a dropped viewer reconnects", async () => {
    const h = harness();
    await h.streamer.probe();
    await h.streamer.watch();
    h.handlers().onClosed();
    vi.advanceTimersByTime(5_001);
    await h.streamer.watch();
    expect(h.host.capable).toEqual([true, false, true]);
  });

  it("unpublishes only what it published", async () => {
    const h = harness();
    await h.streamer.probe();
    await h.streamer.unpublish();
    expect(h.connection.unpublish).not.toHaveBeenCalled();
    await h.streamer.publish(capture, DEFAULT_VOICE_SETTINGS);
    await h.streamer.unpublish();
    expect(h.connection.unpublish).toHaveBeenCalledTimes(1);
  });
});

describe("ScreenStreamer.watch", () => {
  it("connects once however often it is asked", async () => {
    const h = harness();
    await h.streamer.probe();
    await Promise.all([h.streamer.watch(), h.streamer.watch(), h.streamer.watch()]);
    await h.streamer.watch();
    expect(h.connector).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a streaming server", async () => {
    const h = harness({ access: null });
    await h.streamer.probe();
    await h.streamer.watch();
    expect(h.connector).not.toHaveBeenCalled();
  });

  it("waits before retrying a connection that failed", async () => {
    const h = harness({ connectError: new Error("refused") });
    await h.streamer.probe();
    await h.streamer.watch();
    await h.streamer.watch();
    expect(h.connector).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_001);
    await h.streamer.watch();
    expect(h.connector).toHaveBeenCalledTimes(2);
  });

  it("exposes the relayed screens and clears them when it disconnects", async () => {
    const h = harness();
    await h.streamer.probe();
    await h.streamer.watch();
    const stream = {} as MediaStream;
    h.handlers().onScreens(new Map([["user-2", stream]]));
    expect(h.streamer.relayed.get("user-2")).toBe(stream);
    await h.streamer.idle();
    expect(h.streamer.relayed.size).toBe(0);
    expect(h.connection.disconnect).toHaveBeenCalled();
  });

  it("stays connected while it is the one publishing", async () => {
    const h = harness();
    await h.streamer.probe();
    await h.streamer.publish(capture, DEFAULT_VOICE_SETTINGS);
    await h.streamer.idle();
    expect(h.connection.disconnect).not.toHaveBeenCalled();
  });

  it("disconnects a connection that finished opening after the call ended", async () => {
    const h = harness();
    await h.streamer.probe();
    const opening = h.streamer.watch();
    await h.streamer.reset();
    await opening;
    expect(h.connection.disconnect).toHaveBeenCalled();
    expect(h.streamer.relayed.size).toBe(0);
  });
});
