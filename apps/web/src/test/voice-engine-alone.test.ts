import {
  type CallView,
  DEFAULT_VOICE_SETTINGS,
  type VoicePort,
  type VoiceSubscriptions,
} from "@aulora/core";
import { describe, expect, it, vi } from "vitest";
import { VoiceEngine } from "../lib/voice/call-engine";

/**
 * The engine's half of the solo-call disconnect: when the server ends the call
 * with `endedReason: "alone"`, the media must be released and the reason kept
 * for the notice, without the engine ever rejoining on its own.
 */
vi.mock("../lib/voice/mic-pipeline", () => ({
  openMicPipeline: async () => ({
    stream: { getAudioTracks: () => [], getTracks: () => [], getTracksSafe: () => [] },
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
    async handleSignals(): Promise<void> {}
    async refreshVideo(): Promise<void> {}
    async applyAudioTrack(): Promise<void> {}
    async collectStats(): Promise<unknown> {
      return new Map();
    }
  },
}));

type JoinArgs = { readonly callId: string; readonly takeover?: boolean };
type StayArgs = { readonly callId: string };
type FakePort = Omit<VoicePort, "joinCall" | "stayInCall"> & {
  readonly joinCall: ReturnType<typeof vi.fn<(args: JoinArgs) => Promise<null>>>;
  readonly stayInCall: ReturnType<typeof vi.fn<(args: StayArgs) => Promise<null>>>;
};

function fakePort(): FakePort {
  return {
    joinCall: vi.fn<(args: JoinArgs) => Promise<null>>(async () => null),
    stayInCall: vi.fn<(args: StayArgs) => Promise<null>>(async () => null),
    leaveCall: vi.fn(async () => null),
    endCall: vi.fn(async () => null),
    declineCall: vi.fn(async () => null),
    updateParticipant: vi.fn(async () => null),
    callHeartbeat: vi.fn(async () => null),
    sendSignal: vi.fn(async () => null),
    ackSignals: vi.fn(async () => null),
    startCall: vi.fn(async () => ({ callId: "call-1", created: true })),
  };
}

function controlledSubscriptions() {
  const callWatchers: ((call: CallView | null) => void)[] = [];
  const signalWatchers: ((signals: never[]) => void)[] = [];
  const subscriptions: VoiceSubscriptions = {
    watchCall: () => () => {},
    watchCallById: (_callId, onChange) => {
      callWatchers.push(onChange);
      return () => {};
    },
    watchSignals: (_callId, onChange) => {
      signalWatchers.push(onChange as (signals: never[]) => void);
      return () => {};
    },
    watchIncoming: () => () => {},
    watchActiveCalls: () => () => {},
  };
  return {
    subscriptions,
    emitCall(call: CallView | null) {
      for (const watcher of callWatchers) {
        watcher(call);
      }
    },
    emitSignals(signals: never[]) {
      for (const watcher of signalWatchers) {
        watcher(signals);
      }
    },
  };
}

function call(overrides: Partial<CallView> = {}): CallView {
  return {
    id: "call-1",
    channelId: "channel-1",
    kind: "voice",
    status: "active",
    initiatorId: "me",
    ringingUserIds: [],
    screenShareUserId: null,
    startedAt: 0,
    participants: [
      {
        userId: "me",
        muted: false,
        deafened: false,
        video: false,
        sharingScreen: false,
        sfu: false,
        joinedAt: 0,
        clientId: "client-a",
        session: 1,
        speaking: false,
        audioLevel: 0,
        connection: "connected",
      },
    ],
    ...overrides,
  };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) {
    await Promise.resolve();
  }
}

async function joinedEngine(port: VoicePort, subscriptions: VoiceSubscriptions) {
  const engine = new VoiceEngine({
    port,
    subscriptions,
    userId: "me",
    clientId: "client-a",
    getSettings: () => DEFAULT_VOICE_SETTINGS,
  });
  await engine.joinCall("call-1");
  await settle();
  return engine;
}

describe("solo-call disconnect", () => {
  it("tears down and explains an alone timeout", async () => {
    const port = fakePort();
    const control = controlledSubscriptions();
    const engine = await joinedEngine(port, control.subscriptions);
    expect(engine.getSnapshot().callId).toBe("call-1");

    control.emitCall(
      call({
        status: "ended",
        endedReason: "alone",
        aloneTimeoutSeconds: 300,
        participants: [],
      }),
    );
    await settle();

    const snapshot = engine.getSnapshot();
    expect(snapshot.callId).toBeNull();
    expect(snapshot.endedNotice).toEqual({ kind: "alone-timeout", timeoutSeconds: 300 });
    // The server removed the seat; the engine must not try to rejoin.
    expect(port.joinCall).toHaveBeenCalledTimes(1);
    engine.dispose();
  });

  it("falls back to a non-numeric duration when an older backend omits it", async () => {
    const control = controlledSubscriptions();
    const engine = await joinedEngine(fakePort(), control.subscriptions);

    control.emitCall(call({ status: "ended", endedReason: "alone" }));
    await settle();

    expect(engine.getSnapshot().endedNotice).toEqual({
      kind: "alone-timeout",
      timeoutSeconds: null,
    });
    engine.dispose();
  });

  it("keeps no notice for an ordinary end", async () => {
    const control = controlledSubscriptions();
    const engine = await joinedEngine(fakePort(), control.subscriptions);

    control.emitCall(call({ status: "ended", participants: [] }));
    await settle();

    expect(engine.getSnapshot().callId).toBeNull();
    expect(engine.getSnapshot().endedNotice).toBeNull();
    engine.dispose();
  });

  it("keeps one notice across repeated alone-end updates", async () => {
    const control = controlledSubscriptions();
    const engine = await joinedEngine(fakePort(), control.subscriptions);

    control.emitCall(call({ status: "ended", endedReason: "alone", aloneTimeoutSeconds: 300 }));
    await settle();
    // A duplicate end (for example a late leave) must not stack another notice.
    control.emitCall(call({ status: "ended", endedReason: "alone", aloneTimeoutSeconds: 300 }));
    await settle();

    expect(engine.getSnapshot().endedNotice).toEqual({
      kind: "alone-timeout",
      timeoutSeconds: 300,
    });
    engine.dismissEndedNotice();
    expect(engine.getSnapshot().endedNotice).toBeNull();
    engine.dispose();
  });

  it("clears the notice on a new call and hides it on request", async () => {
    const port = fakePort();
    const control = controlledSubscriptions();
    const engine = await joinedEngine(port, control.subscriptions);
    control.emitCall(call({ status: "ended", endedReason: "alone" }));
    await settle();
    expect(engine.getSnapshot().endedNotice).not.toBeNull();

    engine.dismissEndedNotice();
    expect(engine.getSnapshot().endedNotice).toBeNull();

    await engine.joinCall("call-1");
    await settle();
    expect(engine.getSnapshot().endedNotice).toBeNull();
    engine.dispose();
  });

  it("asks the server to reset the window on Stay when the port supports it", async () => {
    const port = fakePort();
    const control = controlledSubscriptions();
    const engine = await joinedEngine(port, control.subscriptions);

    await engine.stayInCall();
    expect(port.stayInCall).toHaveBeenCalledWith({ callId: "call-1" });
    engine.dispose();
  });
});
