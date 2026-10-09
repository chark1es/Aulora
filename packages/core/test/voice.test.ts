import { describe, expect, it } from "vitest";
import {
  type CallParticipantView,
  type CallView,
  callElsewhereFromUnknown,
  callKindLabel,
  callOnAnotherDevice,
  callStatusLabel,
  claimCallSeat,
  DEFAULT_VOICE_SETTINGS,
  ensureVoiceClientId,
  formatCallDuration,
  isOnAnotherDevice,
  isOnThisDevice,
  isParticipant,
  isRinging,
  isVoiceClientId,
  joinedElsewhere,
  loadVoiceSettings,
  memoryVoiceSettingsStore,
  mergeVoiceSettings,
  networkQuality,
  resolutionConstraints,
  saveVoiceSettings,
  shouldOffer,
  sortParticipants,
  streamProfile,
} from "../src/index";

function participant(
  userId: string,
  overrides: Partial<CallParticipantView> = {},
): CallParticipantView {
  return {
    userId,
    muted: false,
    deafened: false,
    video: false,
    sharingScreen: false,
    sfu: false,
    joinedAt: 0,
    clientId: null,
    session: 1,
    speaking: false,
    audioLevel: 0,
    connection: "connected",
    ...overrides,
  };
}

function call(overrides: Partial<CallView> = {}): CallView {
  return {
    id: "call-1",
    channelId: "channel-1",
    kind: "voice",
    status: "active",
    initiatorId: "user-1",
    ringingUserIds: [],
    screenShareUserId: null,
    startedAt: 0,
    participants: [participant("user-1")],
    ...overrides,
  };
}

describe("voice settings", () => {
  it("exposes sane defaults", () => {
    expect(DEFAULT_VOICE_SETTINGS.echoCancellation).toBe(true);
    expect(DEFAULT_VOICE_SETTINGS.inputVolume).toBe(1);
    expect(DEFAULT_VOICE_SETTINGS.videoResolution).toBe("720p");
  });

  it("clamps volumes and rejects unknown enums", () => {
    const merged = mergeVoiceSettings({
      inputVolume: 99,
      outputVolume: -5,
      videoResolution: "4320p" as never,
      screenCodec: "vp8" as never,
    });
    expect(merged.inputVolume).toBe(2);
    expect(merged.outputVolume).toBe(0);
    expect(merged.videoResolution).toBe("720p");
    expect(merged.screenCodec).toBe("auto");
  });

  it("round-trips through a store and tolerates corrupt data", () => {
    const store = memoryVoiceSettingsStore();
    saveVoiceSettings(store, { ...DEFAULT_VOICE_SETTINGS, inputDeviceId: "mic-2" });
    expect(loadVoiceSettings(store).inputDeviceId).toBe("mic-2");

    store.setItem("aulora.voiceSettings.v1", "{not json");
    expect(loadVoiceSettings(store)).toEqual(DEFAULT_VOICE_SETTINGS);
  });

  it("keeps older stored settings valid and fills in the streaming options", () => {
    const merged = mergeVoiceSettings({ noiseSuppression: false, inputVolume: 1.5 });
    expect(merged.noiseSuppression).toBe(false);
    expect(merged.enhancedNoiseSuppression).toBe(false);
    expect(merged.backgroundEffect).toBe("none");
    expect(merged.streamQuality).toBe("smooth");
    expect(merged.streamAudio).toBe(true);
  });

  it("rejects an unknown effect, quality or malformed backdrop id", () => {
    const merged = mergeVoiceSettings({
      backgroundEffect: "sparkle" as never,
      backgroundBlur: "extreme" as never,
      backgroundImage: "../etc/passwd",
      streamQuality: "ultra" as never,
    });
    expect(merged.backgroundEffect).toBe("none");
    expect(merged.backgroundBlur).toBe("strong");
    expect(merged.backgroundImage).toBe(DEFAULT_VOICE_SETTINGS.backgroundImage);
    expect(merged.streamQuality).toBe("smooth");
  });

  it("scales the stream budget with the chosen quality", () => {
    const smooth = streamProfile("smooth");
    const balanced = streamProfile("balanced");
    const saver = streamProfile("saver");
    expect(smooth.frameRate).toBe(30);
    expect(balanced.frameRate).toBe(15);
    expect(saver.height).toBeLessThan(balanced.height);
    expect(saver.maxBitrate).toBeLessThan(balanced.maxBitrate);
    expect(balanced.maxBitrate).toBeLessThan(smooth.maxBitrate);
  });

  it("maps resolutions to capture constraints", () => {
    expect(resolutionConstraints("360p").width).toBe(640);
    expect(resolutionConstraints("1080p").height).toBe(1080);
  });
});

describe("voice state helpers", () => {
  it("formats durations", () => {
    expect(formatCallDuration(0)).toBe("0:00");
    expect(formatCallDuration(65_000)).toBe("1:05");
    expect(formatCallDuration(3_661_000)).toBe("1:01:01");
  });

  it("labels calls", () => {
    expect(callKindLabel("video")).toBe("Video call");
    expect(callStatusLabel("ringing")).toBe("Ringing");
  });

  it("detects participants and ringing", () => {
    expect(isParticipant(call(), "user-1")).toBe(true);
    expect(isParticipant(call(), "user-2")).toBe(false);
    expect(isRinging(call({ status: "ringing", ringingUserIds: ["user-2"] }), "user-2")).toBe(true);
    expect(isRinging(call(), "user-2")).toBe(false);
  });

  it("orders screen, then video, then audio", () => {
    const sorted = sortParticipants([
      participant("a", { joinedAt: 3 }),
      participant("b", { video: true, joinedAt: 2 }),
      participant("c", { sharingScreen: true, joinedAt: 1 }),
    ]);
    expect(sorted.map((entry) => entry.userId)).toEqual(["c", "b", "a"]);
  });

  it("picks a deterministic offerer", () => {
    expect(shouldOffer("a", "b")).toBe(true);
    expect(shouldOffer("b", "a")).toBe(false);
  });

  it("buckets network quality", () => {
    expect(networkQuality(0, 30)).toBe("good");
    expect(networkQuality(0.05, 250)).toBe("fair");
    expect(networkQuality(0.2, 700)).toBe("poor");
  });

  it("tells this device from another one", () => {
    const here = call({
      participants: [participant("user-1", { clientId: "device-a" })],
    });
    const there = call({
      id: "call-2",
      participants: [participant("user-1", { clientId: "device-b" })],
    });
    expect(isOnThisDevice(here, "user-1", "device-a")).toBe(true);
    expect(isOnAnotherDevice(here, "user-1", "device-a")).toBe(false);
    expect(isOnAnotherDevice(there, "user-1", "device-a")).toBe(true);
    expect(isOnAnotherDevice(there, "user-1", null)).toBe(false);
    expect(callOnAnotherDevice([here, there], "user-1", "device-a")?.id).toBe("call-2");
  });

  it("treats an unclaimed seat as elsewhere unless this install is connected", () => {
    const unclaimed = call({
      participants: [participant("user-1", { clientId: null })],
    });
    expect(joinedElsewhere(unclaimed, "user-1", "device-b", null)).toBe(true);
    expect(joinedElsewhere(unclaimed, "user-1", "device-a", "call-1")).toBe(false);
    expect(joinedElsewhere(unclaimed, "user-2", "device-b", null)).toBe(false);
    const held = call({
      participants: [participant("user-1", { clientId: "device-a" })],
    });
    expect(joinedElsewhere(held, "user-1", "device-b", "call-1")).toBe(true);
    expect(joinedElsewhere(held, "user-1", "device-a", "call-1")).toBe(false);
  });
});

describe("call seat", () => {
  it("persists a client id", () => {
    const store = memoryVoiceSettingsStore();
    const first = ensureVoiceClientId(store);
    expect(isVoiceClientId(first)).toBe(true);
    expect(ensureVoiceClientId(store)).toBe(first);
  });

  it("asks before taking a seat held by another device, then retries on a stale roster", async () => {
    const elsewhere = call({
      participants: [participant("user-1", { clientId: "device-b" })],
    });
    const answers: boolean[] = [];
    const confirm = async () => {
      answers.push(true);
      return true;
    };
    let runs = 0;
    const result = await claimCallSeat({
      calls: [elsewhere],
      userId: "user-1",
      clientId: "device-a",
      confirm,
      run: async (takeover) => {
        runs += 1;
        if (runs === 1) {
          return { status: "elsewhere", callId: "call-1", channelId: "channel-1" };
        }
        expect(takeover).toBe(true);
        return { status: "joined", callId: "call-1" };
      },
    });
    expect(result).toEqual({ status: "joined", callId: "call-1" });
    expect(answers).toEqual([true, true]);
  });

  it("cancels when the user declines the switch", async () => {
    const elsewhere = call({
      participants: [participant("user-1", { clientId: "device-b" })],
    });
    let ran = false;
    const result = await claimCallSeat({
      calls: [elsewhere],
      userId: "user-1",
      clientId: "device-a",
      confirm: async () => false,
      run: async () => {
        ran = true;
        return { status: "joined", callId: "call-1" };
      },
    });
    expect(result.status).toBe("cancelled");
    expect(ran).toBe(false);
  });

  it("reads a call_elsewhere payload", () => {
    const error = callElsewhereFromUnknown({
      data: { code: "call_elsewhere", callId: "call-9", channelId: "channel-9" },
    });
    expect(error?.callId).toBe("call-9");
    expect(error?.channelId).toBe("channel-9");
    expect(callElsewhereFromUnknown(new Error("nope"))).toBeNull();
  });
});
