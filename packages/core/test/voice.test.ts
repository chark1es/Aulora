import { describe, expect, it } from "vitest";
import {
  type CallParticipantView,
  type CallView,
  callKindLabel,
  callStatusLabel,
  DEFAULT_VOICE_SETTINGS,
  formatCallDuration,
  isParticipant,
  isRinging,
  loadVoiceSettings,
  memoryVoiceSettingsStore,
  mergeVoiceSettings,
  networkQuality,
  resolutionConstraints,
  saveVoiceSettings,
  shouldOffer,
  sortParticipants,
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
    joinedAt: 0,
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
});
