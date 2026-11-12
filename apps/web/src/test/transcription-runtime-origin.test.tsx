import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTICE_GRACE_MS, TranscriptionRuntime } from "../components/voice/TranscriptionRuntime";
import { transcriptionClient } from "../lib/transcription/client-state";
import type { SocketLike } from "../lib/transcription/streamer";

/**
 * The REAL streamer and runtime, with only the browser edges (WebSocket and the
 * audio worklet) replaced: a change of origin while a session is live must not
 * drop the session or stop this device's audio; it only changes where the next
 * connect goes.
 */
const net = vi.hoisted(() => ({
  urls: [] as string[],
  sockets: [] as { url: string; closed: boolean; adapter: SocketLike }[],
  captures: 0,
  captureStops: 0,
}));

vi.mock("../lib/transcription/web-socket", () => ({
  openWebSocket: (url: string): SocketLike => {
    net.urls.push(url);
    const record = { url, closed: false, adapter: null as unknown as SocketLike };
    net.sockets.push(record);
    const adapter: SocketLike = {
      binaryType: "blob",
      readyState: 1,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: () => undefined,
      close: () => {
        record.closed = true;
      },
    };
    record.adapter = adapter;
    return adapter;
  },
}));

vi.mock("../lib/transcription/capture", () => ({
  openPcmCapture: () => {
    net.captures += 1;
    return Promise.resolve({
      setGate: () => undefined,
      stop: () => {
        net.captureStops += 1;
      },
    });
  },
}));

const mic = {} as MediaStream;
const mint = vi.fn(() => Promise.resolve({ token: "tok", wsPath: "/transcribe/" }));

function runtime(origin: string, sessionId: string | null = "s1") {
  return (
    <TranscriptionRuntime
      sessionId={sessionId}
      micStream={mic}
      transmitting
      origin={origin}
      mint={mint}
    />
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  net.urls.length = 0;
  net.sockets.length = 0;
  net.captures = 0;
  net.captureStops = 0;
  transcriptionClient.setSession(null);
});
afterEach(() => {
  vi.useRealTimers();
});

const live = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(NOTICE_GRACE_MS + 50);
  });
};

describe("TranscriptionRuntime across an origin change", () => {
  it("keeps the live session and streaming intent when the origin changes while streaming", async () => {
    const view = render(runtime("https://old.example.com"));
    await live();
    expect(net.urls).toEqual(["wss://old.example.com/transcribe/ws"]);
    expect(transcriptionClient.getSnapshot()).toMatchObject({ sessionId: "s1", phase: "live" });

    view.rerender(runtime("https://chat.example.com"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    // The session was not reset, nothing was torn down, and audio is not interrupted.
    expect(transcriptionClient.getSnapshot()).toMatchObject({ sessionId: "s1", phase: "live" });
    expect(net.sockets.map((socket) => socket.closed)).toEqual([false]);
    expect(net.captureStops).toBe(0);
    expect(net.captures).toBe(1);
  });

  it("starts streaming once the desktop origin turns from empty into the workspace URL", async () => {
    const view = render(runtime(""));
    await live();
    // No usable origin yet: no socket, and the person is told why.
    expect(net.urls).toEqual([]);
    expect(transcriptionClient.getSnapshot().stream).toMatchObject({ kind: "error" });
    expect(transcriptionClient.getSnapshot()).toMatchObject({ sessionId: "s1", phase: "live" });

    view.rerender(runtime("https://chat.example.com"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    // The session is still the same one, and the reconnect uses the new origin.
    expect(transcriptionClient.getSnapshot()).toMatchObject({ sessionId: "s1", phase: "live" });
    expect(net.urls).toEqual(["wss://chat.example.com/transcribe/ws"]);
    expect(transcriptionClient.getSnapshot().stream).toMatchObject({ kind: "connecting" });
  });

  it("uses the new origin for a later reconnect, without rebuilding the streamer", async () => {
    const view = render(runtime("https://old.example.com"));
    await live();
    const first = net.sockets[0];
    first?.adapter.onmessage?.({
      data: JSON.stringify({ type: "ready", sessionId: "s1", speakerKey: "user:u" }),
    });
    view.rerender(runtime("https://chat.example.com"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    // The server ends the (idle) stream; the streamer reconnects on demand.
    await act(async () => {
      first?.adapter.onclose?.({ code: 1000 });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(net.urls).toEqual([
      "wss://old.example.com/transcribe/ws",
      "wss://chat.example.com/transcribe/ws",
    ]);
    expect(net.captures).toBe(1);
    expect(transcriptionClient.getSnapshot().sessionId).toBe("s1");
  });

  it("still ends everything when the runtime unmounts", async () => {
    const view = render(runtime("https://chat.example.com"));
    await live();
    view.unmount();
    expect(transcriptionClient.getSnapshot()).toMatchObject({ sessionId: null, phase: "off" });
    expect(net.sockets.every((socket) => socket.closed)).toBe(true);
    expect(net.captureStops).toBeGreaterThan(0);
  });
});
