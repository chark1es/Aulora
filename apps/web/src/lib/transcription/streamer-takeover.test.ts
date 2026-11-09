import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureHandle } from "./capture";
import { type SocketLike, type StreamStatus, TranscriptionStreamer } from "./streamer";

/**
 * Two real streamers (two tabs of one account) against a fake transcriber that
 * models the server: the first auth frame for an identity owns the stream, and a
 * later one evicts the older socket with `evictionCode`. Nothing about the
 * streamer is stubbed; only the socket layer is.
 */

class ServerSocket implements SocketLike {
  binaryType = "blob";
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onclose: ((event: { readonly code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(
    private readonly server: FakeTranscriber,
    readonly owner: string,
  ) {
    // The browser opens the connection a tick later.
    queueMicrotask(() => {
      if (!this.closed) {
        this.readyState = 1;
        this.onopen?.();
      }
    });
  }

  send(data: string | ArrayBuffer): void {
    if (typeof data === "string" && (JSON.parse(data) as { type?: string }).type === "auth") {
      this.server.authenticate(this);
    }
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.server.release(this);
  }

  /** The server ends this socket. */
  serverClose(code: number): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({ code });
  }

  ready(): void {
    this.onmessage?.({
      data: JSON.stringify({ type: "ready", sessionId: "s1", speakerKey: "user:u" }),
    });
  }
}

class FakeTranscriber {
  /** The socket that currently owns the identity's stream. */
  active: ServerSocket | null = null;
  readonly connects: Record<string, number> = {};
  readonly sockets: ServerSocket[] = [];

  constructor(private readonly evictionCode: number) {}

  connect(owner: string): ServerSocket {
    this.connects[owner] = (this.connects[owner] ?? 0) + 1;
    const socket = new ServerSocket(this, owner);
    this.sockets.push(socket);
    return socket;
  }

  authenticate(socket: ServerSocket): void {
    const previous = this.active;
    this.active = socket;
    if (previous !== null && previous !== socket) {
      previous.serverClose(this.evictionCode);
    }
    socket.ready();
  }

  release(socket: ServerSocket): void {
    if (this.active === socket) {
      this.active = null;
    }
  }
}

function client(name: string, server: FakeTranscriber, captures: { stops: number } = { stops: 0 }) {
  const statuses: StreamStatus[] = [];
  const streamer = new TranscriptionStreamer({
    origin: "https://chat.example.com",
    mintToken: () => Promise.resolve({ token: `tok-${name}`, wsPath: "/transcribe/" }),
    createSocket: () => server.connect(name),
    openCapture: () =>
      Promise.resolve<CaptureHandle>({
        setGate: () => undefined,
        stop: () => {
          captures.stops += 1;
        },
      }),
    onStatus: (status) => statuses.push(status),
    random: () => 0.999,
  });
  const stream = {} as MediaStream;
  const target = (transmitting: boolean) => ({
    active: true,
    optedOut: false,
    transmitting,
    stream,
  });
  return { name, streamer, statuses, target, last: () => statuses.at(-1) };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const settle = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("two tabs on one account (server evicts the older socket with 4410)", () => {
  it("converges to exactly one active socket, and the loser never connects again", async () => {
    const server = new FakeTranscriber(4410);
    const a = client("A", server);
    const b = client("B", server);
    a.streamer.update(a.target(true));
    await flush();
    expect(server.active?.owner).toBe("A");
    b.streamer.update(b.target(true));
    await flush();

    // B took over; A was told it was replaced and paused.
    expect(server.active?.owner).toBe("B");
    expect(a.last()).toMatchObject({ kind: "error", resumable: true });
    expect((a.last() as { message: string }).message).toMatch(/another device or tab/u);

    const before = { ...server.connects };
    await settle(10 * 60_000);
    // No further connects from either: exactly one socket, no storm.
    expect(server.connects).toEqual(before);
    expect(server.connects).toEqual({ A: 1, B: 1 });
    expect(server.active?.owner).toBe("B");
    a.streamer.stop();
    b.streamer.stop();
  });

  it("lets the loser take over with unmute or Resume, once, and the former winner then pauses", async () => {
    const server = new FakeTranscriber(4410);
    const a = client("A", server);
    const b = client("B", server);
    a.streamer.update(a.target(true));
    await flush();
    b.streamer.update(b.target(true));
    await flush();
    expect(server.active?.owner).toBe("B");

    // A: explicit Resume.
    a.streamer.resume();
    await flush();
    expect(server.active?.owner).toBe("A");
    expect(b.last()).toMatchObject({ kind: "error", resumable: true });
    expect(server.connects).toEqual({ A: 2, B: 1 });
    await settle(10 * 60_000);
    expect(server.connects).toEqual({ A: 2, B: 1 });

    // B: mute then unmute is also a deliberate take-over.
    b.streamer.update(b.target(false));
    b.streamer.update(b.target(true));
    await flush();
    expect(server.active?.owner).toBe("B");
    expect(a.last()).toMatchObject({ kind: "error", resumable: true });
    expect(server.connects).toEqual({ A: 2, B: 2 });
    await settle(10 * 60_000);
    expect(server.connects).toEqual({ A: 2, B: 2 });
    a.streamer.stop();
    b.streamer.stop();
  });

  it("does nothing on Resume when the stream was not replaced", async () => {
    const server = new FakeTranscriber(4410);
    const a = client("A", server);
    a.streamer.update(a.target(true));
    await flush();
    a.streamer.resume();
    await flush();
    expect(server.connects).toEqual({ A: 1 });
    a.streamer.stop();
  });

  it("ignores close events from a socket that is no longer the current one", async () => {
    const server = new FakeTranscriber(4410);
    const a = client("A", server);
    a.streamer.update(a.target(true));
    await flush();
    const first = server.sockets[0] as ServerSocket;
    // The first socket closes normally (idle) and the streamer reconnects.
    first.serverClose(1000);
    await flush();
    expect(server.connects.A).toBe(2);
    const second = server.sockets[1] as ServerSocket;
    // Stale events from the dead socket must never trigger another reconnect...
    first.closed = false;
    first.onclose?.({ code: 1000 });
    first.onclose?.({ code: 4429 });
    first.onerror?.();
    await settle(60_000);
    expect(server.connects.A).toBe(2);
    expect(server.active).toBe(second);
    a.streamer.stop();
  });
});

describe("reconnect-storm breaker", () => {
  it("trips on repeated normal closes while the session is active, instead of looping", async () => {
    const server = new FakeTranscriber(1000);
    const a = client("A", server);
    a.streamer.update(a.target(true));
    await flush();
    // Something keeps ending the stream with a normal close right after it is ready.
    for (let round = 0; round < 12; round += 1) {
      server.active?.serverClose(1000);
      await flush();
    }
    const last = a.last();
    expect(last).toMatchObject({ kind: "error", resumable: true });
    // Bounded: a handful of connects, not one per close.
    expect(server.connects.A).toBeLessThanOrEqual(7);
    const count = server.connects.A;
    await settle(5 * 60_000);
    expect(server.connects.A).toBe(count);
    a.streamer.stop();
  });

  it("does not trip on the occasional idle close followed by speech", async () => {
    const server = new FakeTranscriber(1000);
    const a = client("A", server);
    a.streamer.update(a.target(true));
    await flush();
    for (let round = 0; round < 4; round += 1) {
      await settle(40_000);
      server.active?.serverClose(1000);
      await flush();
    }
    expect(a.last()).toMatchObject({ kind: "streaming" });
    expect(server.connects.A).toBe(5);
    a.streamer.stop();
  });
});

describe("the transcription session ends on the server (close 4411)", () => {
  it("stops capture, shows no error, and never reconnects", async () => {
    const server = new FakeTranscriber(4410);
    const captures = { stops: 0 };
    const a = client("A", server, captures);
    a.streamer.update(a.target(true));
    await flush();
    expect(server.connects.A).toBe(1);

    // The session ended under the stream: the server closes it for good.
    server.active?.serverClose(4411);
    await flush();
    expect(a.last()).toEqual({ kind: "idle" });
    expect(a.statuses.some((status) => status.kind === "error")).toBe(false);
    expect(captures.stops).toBe(1);

    // The roster may lag behind: still active, mic live, even an unmute: no reconnect.
    a.streamer.update(a.target(true));
    a.streamer.update(a.target(false));
    a.streamer.update(a.target(true));
    await settle(10 * 60_000);
    expect(server.connects.A).toBe(1);
    expect(a.last()).toEqual({ kind: "idle" });

    // Once the session is over here too, a later session starts cleanly.
    a.streamer.update({ ...a.target(true), active: false });
    a.streamer.update(a.target(true));
    await flush();
    expect(server.connects.A).toBe(2);
    a.streamer.stop();
  });
});
