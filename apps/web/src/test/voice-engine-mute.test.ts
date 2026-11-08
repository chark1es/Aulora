import { DEFAULT_VOICE_SETTINGS, type VoicePort, type VoiceSubscriptions } from "@aulora/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceEngine } from "../lib/voice/call-engine";

/**
 * The engine's media path is mocked down to the sender swaps: what matters here
 * is that a muted microphone is detached from every transceiver instead of
 * sending a silent, still-encoded stream.
 */
const mock = vi.hoisted(() => {
  const track = {
    kind: "audio",
    enabled: true,
    getSettings: () => ({ deviceId: "mic" }),
    stop: () => {},
  };
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  };
  return {
    track,
    stream,
    levels: [] as ((level: number) => void)[],
    applied: [] as unknown[],
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
  createLevelMeter: (_stream: unknown, onLevel: (level: number) => void) => {
    mock.levels.push(onLevel);
    return () => {};
  },
  applySinkId: async () => {},
}));

vi.mock("../lib/voice/peer-mesh", () => ({
  DEFAULT_ICE: [],
  PeerMesh: class {
    readonly remoteStreams = new Map();
    readonly remoteSpeaking = new Set<string>();
    reset(): void {}
    reconcile(): void {}
    async handleSignals(): Promise<void> {}
    async refreshVideo(): Promise<void> {}
    async applyAudioTrack(track: unknown): Promise<void> {
      mock.applied.push(track);
    }
  },
}));

/**
 * Yields through a few microtask turns so a chained sender swap has run, without
 * involving wall-clock timers.
 */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) {
    await Promise.resolve();
  }
}

function fakePort(): VoicePort {
  return {
    joinCall: vi.fn(async () => null),
    leaveCall: vi.fn(async () => null),
    endCall: vi.fn(async () => null),
    declineCall: vi.fn(async () => null),
    updateParticipant: vi.fn(async () => null),
    callHeartbeat: vi.fn(async () => null),
    sendSignal: vi.fn(async () => null),
    ackSignals: vi.fn(async () => null),
    startCall: vi.fn(async () => ({ callId: "call-1", created: true })),
  } as unknown as VoicePort;
}

function fakeSubscriptions(): VoiceSubscriptions {
  return {
    watchCall: () => () => {},
    watchCallById: () => () => {},
    watchSignals: () => () => {},
    watchIncoming: () => () => {},
    watchActiveCalls: () => () => {},
  };
}

async function joinedEngine(port: VoicePort): Promise<VoiceEngine> {
  const engine = new VoiceEngine({
    port,
    subscriptions: fakeSubscriptions(),
    userId: "me",
    clientId: "client-a",
    getSettings: () => DEFAULT_VOICE_SETTINGS,
  });
  await engine.joinCall("call-1");
  await settle();
  return engine;
}

describe("mute stops sending", () => {
  beforeEach(() => {
    mock.applied.length = 0;
    mock.track.enabled = true;
  });

  it("detaches the audio track while muted and re-attaches it on unmute", async () => {
    const port = fakePort();
    const engine = await joinedEngine(port);
    expect(mock.applied.at(-1)).toBe(mock.track);

    await engine.setMuted(true);
    await settle();
    expect(mock.applied.at(-1)).toBeNull();
    // The muted state still reaches the roster.
    expect(port.updateParticipant).toHaveBeenLastCalledWith({
      callId: "call-1",
      muted: true,
    });

    await engine.setMuted(false);
    await settle();
    expect(mock.applied.at(-1)).toBe(mock.track);
    expect(port.updateParticipant).toHaveBeenLastCalledWith({
      callId: "call-1",
      muted: false,
    });
    engine.dispose();
  });

  it("never disables the capture track, which would keep encoding silence", async () => {
    const engine = await joinedEngine(fakePort());
    await engine.setMuted(true);
    await settle();
    expect(mock.track.enabled).toBe(true);
    engine.dispose();
  });

  it("follows push-to-talk: detached until the key is held", async () => {
    const engine = await joinedEngine(fakePort());
    engine.setPushToTalk(true);
    await settle();
    expect(mock.applied.at(-1)).toBeNull();

    engine.setTalking(true);
    await settle();
    expect(mock.applied.at(-1)).toBe(mock.track);

    engine.setTalking(false);
    await settle();
    expect(mock.applied.at(-1)).toBeNull();
    engine.dispose();
  });

  it("deafening mutes, and the mute path stays detached", async () => {
    const engine = await joinedEngine(fakePort());
    engine.setDeafened(true);
    await settle();
    expect(mock.applied.at(-1)).toBeNull();
    expect(engine.getSnapshot().local.deafened).toBe(true);
    expect(engine.getSnapshot().local.muted).toBe(true);
    engine.dispose();
  });

  it("keeps the microphone detached after a device swap while muted", async () => {
    const engine = await joinedEngine(fakePort());
    await engine.setMuted(true);
    await settle();
    mock.applied.length = 0;
    await engine.applySettings({ ...DEFAULT_VOICE_SETTINGS, inputDeviceId: "other-mic" });
    await settle();
    expect(mock.applied).toHaveLength(0);
    engine.dispose();
  });
});
