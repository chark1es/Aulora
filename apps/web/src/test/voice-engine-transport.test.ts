import {
  type CallView,
  DEFAULT_FEATURE_FLAGS,
  DEFAULT_VOICE_SETTINGS,
  type FeatureFlags,
  type SfuAccess,
  type TurnCredentials,
  type VoicePort,
  type VoiceSubscriptions,
} from "@aulora/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceEngine } from "../lib/voice/call-engine";

/**
 * Engine-level guards around the streaming-server hand-over and the relay
 * credential: the mesh and the SFU client are mocked so each test controls
 * exactly when the backend and the SFU answer.
 */
const mock = vi.hoisted(() => {
  const track = {
    kind: "audio",
    enabled: true,
    getSettings: () => ({ deviceId: "mic" }),
    stop: () => {},
  };
  return {
    track,
    stream: { getAudioTracks: () => [track], getTracks: () => [track] },
    meshAudio: [] as unknown[],
    remoteAudio: [] as boolean[],
    sfu: {
      connect: vi.fn(),
      setMic: vi.fn(async (_track: unknown) => {}),
      setCamera: vi.fn(async (_track: unknown) => {}),
      disconnect: vi.fn(async () => {}),
    },
  };
});

vi.mock("../lib/voice/mic-pipeline", () => ({
  openMicPipeline: async () => ({
    stream: mock.stream,
    enhanced: false,
    setSettings: () => {},
    stop: () => {},
  }),
  micProcessingKey: () => "processing",
}));

vi.mock("../lib/voice/media", () => ({
  createLevelMeter: () => () => {},
  applySinkId: async () => {},
}));

vi.mock("../lib/voice/peer-mesh", () => ({
  DEFAULT_ICE: [],
  PeerMesh: class {
    readonly remoteStreams = new Map();
    readonly remoteSpeaking = new Set<string>();
    reset(): void {}
    reconcile(): void {}
    setRemoteAudioEnabled(enabled: boolean): void {
      mock.remoteAudio.push(enabled);
    }
    async handleSignals(): Promise<void> {}
    async refreshVideo(): Promise<void> {}
    async applyAudioTrack(track: unknown): Promise<void> {
      mock.meshAudio.push(track);
    }
    async collectStats(): Promise<Map<string, unknown>> {
      return new Map();
    }
  },
}));

vi.mock("../lib/voice/sfu-call", () => ({
  SfuCall: class {
    readonly mediaStreams = new Map();
    connect = mock.sfu.connect;
    setMic = mock.sfu.setMic;
    setCamera = mock.sfu.setCamera;
    disconnect = mock.sfu.disconnect;
    attachVideo(): boolean {
      return false;
    }
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 12; turn += 1) {
    await Promise.resolve();
  }
}

const ACCESS: SfuAccess = { url: "wss://sfu.test", token: "t", canPublish: true };

/** A call large enough, and capable enough, to move onto the streaming server. */
function bigCall(status: string = "active"): CallView {
  const participants = ["me", "a", "b", "c", "d"].map((userId, index) => ({
    userId,
    muted: false,
    deafened: false,
    video: false,
    sharingScreen: false,
    sfu: true,
    sfuCall: true,
    joinedAt: index,
    clientId: userId === "me" ? "client-a" : null,
    session: 1,
    speaking: false,
    audioLevel: 0,
    connection: "connected",
  }));
  return {
    id: "call-1",
    channelId: "channel-1",
    kind: "voice",
    status,
    initiatorId: "me",
    ringingUserIds: [],
    screenShareUserId: null,
    participants,
  } as unknown as CallView;
}

interface Harness {
  readonly engine: VoiceEngine;
  readonly port: VoicePort;
  readonly watchCallById: ReturnType<typeof vi.fn>;
  emit(call: CallView | null): void;
}

function harness(
  overrides: Partial<VoicePort> = {},
  flags: { current: FeatureFlags } = { current: DEFAULT_FEATURE_FLAGS },
): Harness {
  let listener: ((call: CallView | null) => void) | null = null;
  const watchCallById = vi.fn((_id: string, next: (call: CallView | null) => void) => {
    listener = next;
    return () => {};
  });
  const port = {
    joinCall: vi.fn(async () => null),
    leaveCall: vi.fn(async () => null),
    endCall: vi.fn(async () => null),
    declineCall: vi.fn(async () => null),
    updateParticipant: vi.fn(async () => null),
    callHeartbeat: vi.fn(async () => null),
    sendSignal: vi.fn(async () => null),
    ackSignals: vi.fn(async () => null),
    startCall: vi.fn(async () => ({ callId: "call-1", created: true })),
    ...overrides,
  } as unknown as VoicePort;
  const subscriptions = {
    watchCall: () => () => {},
    watchCallById,
    watchSignals: () => () => {},
    watchIncoming: () => () => {},
    watchActiveCalls: () => () => {},
  } as unknown as VoiceSubscriptions;
  const engine = new VoiceEngine({
    port,
    subscriptions,
    userId: "me",
    clientId: "client-a",
    getSettings: () => DEFAULT_VOICE_SETTINGS,
    getFeatureFlags: () => flags.current,
  });
  return {
    engine,
    port,
    watchCallById,
    emit: (call) => {
      listener?.(call);
    },
  };
}

describe("relay credential before peers", () => {
  beforeEach(() => {
    mock.meshAudio.length = 0;
  });

  it("does not subscribe to the roster (which creates peers) until the credential arrives", async () => {
    const credentials = deferred<TurnCredentials | null>();
    const turnCredentials = vi.fn(() => credentials.promise);
    const { engine, watchCallById } = harness({ turnCredentials });

    const joined = engine.joinCall("call-1");
    await settle();
    expect(turnCredentials).toHaveBeenCalledTimes(1);
    expect(watchCallById).not.toHaveBeenCalled();

    credentials.resolve({
      urls: ["turn:relay.test:3478"],
      username: "u",
      credential: "c",
      ttlSeconds: 3600,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    await joined;
    expect(watchCallById).toHaveBeenCalledTimes(1);
    engine.dispose();
  });

  it("still joins when the backend has no relay", async () => {
    const { engine, watchCallById } = harness({ turnCredentials: async () => null });
    await engine.joinCall("call-1");
    expect(watchCallById).toHaveBeenCalledTimes(1);
    engine.dispose();
  });
});

describe("streaming-server hand-over", () => {
  beforeEach(() => {
    mock.meshAudio.length = 0;
    mock.remoteAudio.length = 0;
    mock.sfu.connect.mockReset();
    mock.sfu.setMic.mockReset();
    mock.sfu.setMic.mockImplementation(async () => {});
    mock.sfu.disconnect.mockClear();
  });

  it("does not open a room for a call that was left while its access request was pending", async () => {
    // The probe answers at once; the request made to connect is the one held.
    const held = deferred<SfuAccess | null>();
    let callScoped = 0;
    const sfuAccess = vi.fn(async (args: { callId: string; scope?: string }) => {
      if (args.scope !== "call") {
        return null;
      }
      callScoped += 1;
      return callScoped === 1 ? ACCESS : await held.promise;
    });
    const { engine, emit } = harness({ sfuAccess });
    await engine.joinCall("call-1");

    emit(bigCall());
    await settle();
    // Probe done, connect request in flight.
    expect(callScoped).toBe(2);

    await engine.leave();
    held.resolve(ACCESS);
    await settle();

    expect(mock.sfu.connect).not.toHaveBeenCalled();
    engine.dispose();
  });

  it("applies a mute made while the room was connecting", async () => {
    const connecting = deferred<boolean>();
    mock.sfu.connect.mockReturnValue(connecting.promise);
    const { engine, emit } = harness({ sfuAccess: async () => ACCESS });
    await engine.joinCall("call-1");

    emit(bigCall());
    await settle();
    expect(mock.sfu.connect).toHaveBeenCalledTimes(1);
    // The room was opened with the live microphone.
    expect(mock.sfu.connect.mock.calls[0]?.[1]).toMatchObject({ mic: mock.track });

    await engine.setMuted(true);
    connecting.resolve(true);
    await settle();

    expect(mock.sfu.setMic).toHaveBeenLastCalledWith(null);
    engine.dispose();
  });

  it("leaves the next call alone when the previous hand-over finishes after hang-up", async () => {
    const applying = deferred<void>();
    mock.sfu.connect.mockResolvedValue(true);
    mock.sfu.setMic.mockImplementationOnce(async () => await applying.promise);
    const { engine, emit } = harness({ sfuAccess: async () => ACCESS });
    await engine.joinCall("call-1");
    emit(bigCall());
    await settle();
    // The room is connected and the hand-over is waiting on the microphone.
    expect(mock.sfu.setMic).toHaveBeenCalledTimes(1);

    await engine.leave();
    await engine.joinCall("call-2");
    mock.remoteAudio.length = 0;
    mock.meshAudio.length = 0;

    applying.resolve();
    await settle();

    // Nothing from the finished hand-over touched the new call's mesh.
    expect(mock.remoteAudio).toEqual([]);
    expect(mock.meshAudio).not.toContain(null);
    engine.dispose();
  });

  it("keeps the microphone live when a mute made while connecting was undone", async () => {
    const connecting = deferred<boolean>();
    mock.sfu.connect.mockReturnValue(connecting.promise);
    const { engine, emit } = harness({ sfuAccess: async () => ACCESS });
    await engine.joinCall("call-1");
    emit(bigCall());
    await settle();

    await engine.setMuted(true);
    await settle();
    await engine.setMuted(false);
    connecting.resolve(true);
    await settle();

    expect(mock.sfu.setMic).toHaveBeenLastCalledWith(mock.track);
    engine.dispose();
  });
});

describe("kill switches", () => {
  beforeEach(() => {
    mock.meshAudio.length = 0;
    mock.sfu.connect.mockReset();
    mock.sfu.setMic.mockClear();
    mock.sfu.disconnect.mockClear();
  });

  it("keeps a large call on the mesh and advertises nothing when the transport is switched off", async () => {
    const sfuAccess = vi.fn(async (_args: { callId: string; scope?: string }) => ACCESS);
    const flags = { current: { ...DEFAULT_FEATURE_FLAGS, disableNewCallTransport: true } };
    const { engine, emit, port } = harness({ sfuAccess }, flags);
    await engine.joinCall("call-1");

    emit(bigCall());
    await settle();

    expect(sfuAccess.mock.calls.filter(([args]) => args.scope === "call")).toHaveLength(0);
    expect(mock.sfu.connect).not.toHaveBeenCalled();
    const updates = (port.updateParticipant as ReturnType<typeof vi.fn>).mock.calls;
    expect(updates.some(([args]) => "sfuCall" in (args as object))).toBe(false);
    engine.dispose();
  });

  it("returns a call in progress to the mesh when the switch is turned on", async () => {
    mock.sfu.connect.mockResolvedValue(true);
    const flags = { current: DEFAULT_FEATURE_FLAGS };
    const { engine, emit, port } = harness({ sfuAccess: async () => ACCESS }, flags);
    await engine.joinCall("call-1");
    emit(bigCall());
    await settle();
    expect(mock.sfu.connect).toHaveBeenCalledTimes(1);

    flags.current = { ...DEFAULT_FEATURE_FLAGS, disableNewCallTransport: true };
    engine.refreshFeatureFlags();
    await settle();

    expect(mock.sfu.disconnect).toHaveBeenCalled();
    // The mesh carries the microphone again, and the roster says this client left the server.
    expect(mock.meshAudio.at(-1)).toBe(mock.track);
    expect(port.updateParticipant).toHaveBeenLastCalledWith({ callId: "call-1", sfuCall: false });
    engine.dispose();
  });
});
