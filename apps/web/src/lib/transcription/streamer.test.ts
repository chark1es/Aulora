import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureHandle } from "./capture";
import { type SocketLike, type StreamStatus, TranscriptionStreamer } from "./streamer";

class FakeSocket implements SocketLike {
  binaryType = "blob";
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onclose: ((event: { readonly code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: (string | ArrayBuffer)[] = [];
  closedWith: number | undefined;

  constructor(readonly url: string) {}

  send(data: string | ArrayBuffer): void {
    this.sent.push(data);
  }

  close(code?: number): void {
    this.readyState = 3;
    this.closedWith = code;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  ready(): void {
    this.onmessage?.({
      data: JSON.stringify({ type: "ready", sessionId: "s1", speakerKey: "user:u" }),
    });
  }

  drop(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  get binary(): ArrayBuffer[] {
    return this.sent.filter((frame): frame is ArrayBuffer => typeof frame !== "string");
  }

  get text(): string[] {
    return this.sent.filter((frame): frame is string => typeof frame === "string");
  }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const captures: { stops: number; gates: boolean[]; push: (frame: ArrayBuffer) => void }[] = [];
  const statuses: StreamStatus[] = [];
  let mints = 0;
  const streamer = new TranscriptionStreamer({
    origin: "https://chat.example.com",
    mintToken: () => {
      mints += 1;
      return Promise.resolve({ token: `tok-${mints}`, wsPath: "/transcribe/" });
    },
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    openCapture: (_stream, onFrame) => {
      const record = { stops: 0, gates: [] as boolean[], push: onFrame };
      captures.push(record);
      const handle: CaptureHandle = {
        setGate: (open) => {
          record.gates.push(open);
        },
        stop: () => {
          record.stops += 1;
        },
      };
      return Promise.resolve(handle);
    },
    onStatus: (status) => {
      statuses.push(status);
    },
    random: () => 0.999,
  });
  const stream = {} as MediaStream;
  return { streamer, sockets, captures, statuses, stream, mints: () => mints };
}

const FRAME = new ArrayBuffer(3_200);

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

async function connect(env: ReturnType<typeof setup>) {
  env.streamer.update({ active: true, optedOut: false, transmitting: true, stream: env.stream });
  await flush();
  const socket = env.sockets.at(-1) as FakeSocket;
  socket.open();
  socket.ready();
  return socket;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("TranscriptionStreamer", () => {
  it("sends the auth frame first, then audio only after ready", async () => {
    const env = setup();
    env.streamer.update({ active: true, optedOut: false, transmitting: true, stream: env.stream });
    await flush();
    const socket = env.sockets[0] as FakeSocket;
    expect(socket.url).toBe("wss://chat.example.com/transcribe/ws");
    expect(socket.binaryType).toBe("arraybuffer");
    // A frame produced before the socket is ready is held, not sent.
    env.captures[0]?.push(FRAME);
    socket.open();
    expect(JSON.parse(socket.text[0] ?? "{}")).toEqual({ type: "auth", token: "tok-1" });
    expect(socket.binary).toHaveLength(0);
    socket.ready();
    expect(socket.binary).toHaveLength(1);
    env.captures[0]?.push(FRAME);
    expect(socket.binary).toHaveLength(2);
    expect(env.statuses.at(-1)).toEqual({ kind: "streaming", sending: true });
  });

  it("never captures or connects while opted out", async () => {
    const env = setup();
    env.streamer.update({ active: true, optedOut: true, transmitting: true, stream: env.stream });
    await flush();
    expect(env.captures).toHaveLength(0);
    expect(env.sockets).toHaveLength(0);
    expect(env.mints()).toBe(0);
    expect(env.statuses.at(-1)).toBeUndefined();
  });

  it("opting out mid-call flushes with end, closes and destroys the capture", async () => {
    const env = setup();
    const socket = await connect(env);
    env.streamer.update({ active: true, optedOut: true, transmitting: true, stream: env.stream });
    expect(socket.text.at(-1)).toBe('{"type":"end"}');
    expect(socket.closedWith).toBe(1000);
    expect(env.captures[0]?.stops).toBe(1);
    expect(env.statuses.at(-1)).toEqual({ kind: "idle" });
    // Late frames from the dead capture reach nothing.
    env.captures[0]?.push(FRAME);
    expect(socket.binary).toHaveLength(0);
  });

  it("stops sending the moment the microphone is muted and resumes without reconnecting", async () => {
    const env = setup();
    const socket = await connect(env);
    env.captures[0]?.push(FRAME);
    expect(socket.binary).toHaveLength(1);
    env.streamer.update({ active: true, optedOut: false, transmitting: false, stream: env.stream });
    expect(env.captures[0]?.gates.at(-1)).toBe(false);
    env.captures[0]?.push(FRAME);
    expect(socket.binary).toHaveLength(1);
    expect(env.statuses.at(-1)).toEqual({ kind: "streaming", sending: false });
    env.streamer.update({ active: true, optedOut: false, transmitting: true, stream: env.stream });
    await flush();
    expect(env.sockets).toHaveLength(1);
    expect(env.captures).toHaveLength(1);
    env.captures[0]?.push(FRAME);
    expect(socket.binary).toHaveLength(2);
  });

  it("tears the capture graph down after a lingering mute", async () => {
    const env = setup();
    await connect(env);
    env.streamer.update({ active: true, optedOut: false, transmitting: false, stream: env.stream });
    expect(env.captures[0]?.stops).toBe(0);
    await vi.advanceTimersByTimeAsync(3_100);
    expect(env.captures[0]?.stops).toBe(1);
    // Unmuting builds a fresh capture; the socket is reused.
    env.streamer.update({ active: true, optedOut: false, transmitting: true, stream: env.stream });
    await flush();
    expect(env.captures).toHaveLength(2);
    expect(env.sockets).toHaveLength(1);
  });

  it("leaving (stop) ends the stream and closes everything", async () => {
    const env = setup();
    const socket = await connect(env);
    env.streamer.stop();
    expect(socket.text.at(-1)).toBe('{"type":"end"}');
    expect(env.captures[0]?.stops).toBe(1);
    env.streamer.update({ active: true, optedOut: false, transmitting: true, stream: env.stream });
    await flush();
    expect(env.sockets).toHaveLength(1);
  });

  it("ending the transcription session stops capture", async () => {
    const env = setup();
    await connect(env);
    env.streamer.update({ active: false, optedOut: false, transmitting: true, stream: env.stream });
    expect(env.captures[0]?.stops).toBe(1);
    expect(env.statuses.at(-1)).toEqual({ kind: "idle" });
  });

  it("reconnects with a fresh token and backoff after a dropped connection", async () => {
    const env = setup();
    const first = await connect(env);
    first.drop(1006);
    expect(env.statuses.at(-1)).toEqual({ kind: "reconnecting", attempt: 1 });
    await vi.advanceTimersByTimeAsync(900);
    expect(env.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(env.sockets).toHaveLength(2);
    expect(env.mints()).toBe(2);
    const second = env.sockets[1] as FakeSocket;
    second.open();
    expect(JSON.parse(second.text[0] ?? "{}")).toEqual({ type: "auth", token: "tok-2" });
    second.ready();
    expect(env.statuses.at(-1)).toEqual({ kind: "streaming", sending: true });
  });

  it("backs off further on repeated failures and eventually gives up", async () => {
    const env = setup();
    env.streamer.update({ active: true, optedOut: false, transmitting: true, stream: env.stream });
    await flush();
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const socket = env.sockets.at(-1) as FakeSocket;
      socket.drop(1006);
      await vi.advanceTimersByTimeAsync(31_000);
    }
    const last = env.statuses.at(-1);
    expect(last?.kind).toBe("error");
    const count = env.sockets.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(env.sockets).toHaveLength(count);
  });

  it("does not retry when the server refuses with a final close code", async () => {
    const env = setup();
    const socket = await connect(env);
    socket.drop(4503);
    expect(env.statuses.at(-1)?.kind).toBe("error");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(env.sockets).toHaveLength(1);
    expect(env.captures[0]?.stops).toBe(1);
  });

  it("retries with backoff, with a fresh token, when the identity is already streaming (4429)", async () => {
    const env = setup();
    const first = await connect(env);
    first.drop(4429);
    // Not fatal: reconnecting, capture kept, nothing reported as an error.
    expect(env.statuses.at(-1)).toEqual({ kind: "reconnecting", attempt: 1 });
    expect(env.captures[0]?.stops).toBe(0);
    await vi.advanceTimersByTimeAsync(900);
    expect(env.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(env.sockets).toHaveLength(2);
    expect(env.mints()).toBe(2);
    const second = env.sockets[1] as FakeSocket;
    second.open();
    expect(JSON.parse(second.text[0] ?? "{}")).toEqual({ type: "auth", token: "tok-2" });
    second.ready();
    expect(env.statuses.at(-1)).toEqual({ kind: "streaming", sending: true });
  });

  it("gives up after a few conflicts with a clear message, then retries on the next unmute", async () => {
    const env = setup();
    env.streamer.update({ active: true, optedOut: false, transmitting: true, stream: env.stream });
    await flush();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const socket = env.sockets.at(-1) as FakeSocket;
      socket.drop(4429);
      await vi.advanceTimersByTimeAsync(31_000);
    }
    const last = env.statuses.at(-1);
    expect(last?.kind).toBe("error");
    expect(last?.kind === "error" ? last.message : "").toMatch(/another device or tab/u);
    // Bounded: it stopped well before the generic drop budget (8) was spent.
    expect(env.sockets.length).toBeLessThanOrEqual(5);
    const count = env.sockets.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(env.sockets).toHaveLength(count);
    expect(env.captures[0]?.stops).toBe(1);

    // Still "live": nothing changes. Mute then unmute is a fresh attempt.
    env.streamer.update({ active: true, optedOut: false, transmitting: true, stream: env.stream });
    await flush();
    expect(env.sockets).toHaveLength(count);
    env.streamer.update({ active: true, optedOut: false, transmitting: false, stream: env.stream });
    env.streamer.update({ active: true, optedOut: false, transmitting: true, stream: env.stream });
    await flush();
    expect(env.sockets).toHaveLength(count + 1);
    const fresh = env.sockets.at(-1) as FakeSocket;
    fresh.open();
    fresh.ready();
    expect(env.statuses.at(-1)).toEqual({ kind: "streaming", sending: true });
  });

  it("keeps the conflict budget across quick reconnects but resets after a healthy stream", async () => {
    const env = setup();
    const first = await connect(env);
    await vi.advanceTimersByTimeAsync(11_000);
    first.drop(4429);
    // Healthy for >10 s, so the earlier stream does not count against the budget.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await vi.advanceTimersByTimeAsync(31_000);
      const socket = env.sockets.at(-1) as FakeSocket;
      socket.drop(4429);
    }
    expect(env.statuses.at(-1)?.kind).not.toBe("error");
  });

  it("stops capture at once on mute, opt-out and session end even while reconnecting after a conflict", async () => {
    const env = setup();
    const socket = await connect(env);
    socket.drop(4429);
    // Muting while waiting to reconnect closes the gate; no frame is buffered afterwards.
    env.streamer.update({ active: true, optedOut: false, transmitting: false, stream: env.stream });
    expect(env.captures[0]?.gates.at(-1)).toBe(false);
    env.captures[0]?.push(FRAME);
    await vi.advanceTimersByTimeAsync(5_000);
    // The retry fires but the participant is muted: no new socket, no audio.
    expect(env.sockets).toHaveLength(1);
    env.streamer.update({ active: false, optedOut: false, transmitting: true, stream: env.stream });
    expect(env.captures[0]?.stops).toBe(1);
    expect(env.statuses.at(-1)).toEqual({ kind: "idle" });
  });

  it("reconnects on demand, not eagerly, after an idle close", async () => {
    const env = setup();
    const socket = await connect(env);
    env.streamer.update({ active: true, optedOut: false, transmitting: false, stream: env.stream });
    socket.drop(1000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(env.sockets).toHaveLength(1);
    env.streamer.update({ active: true, optedOut: false, transmitting: true, stream: env.stream });
    await flush();
    expect(env.sockets).toHaveLength(2);
  });

  it("keeps only a bounded buffer while connecting", async () => {
    const env = setup();
    env.streamer.update({ active: true, optedOut: false, transmitting: true, stream: env.stream });
    await flush();
    const socket = env.sockets[0] as FakeSocket;
    for (let index = 0; index < 50; index += 1) {
      env.captures[0]?.push(FRAME);
    }
    socket.open();
    socket.ready();
    expect(socket.binary).toHaveLength(20);
  });
});
