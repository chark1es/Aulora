import { DEFAULT_VOICE_SETTINGS } from "@aulora/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { acquireUserMediaFrom, type VoiceMediaDevices } from "../src/lib/voice/webrtc";

const stream = {
  getTracks: () => [],
  getAudioTracks: () => [],
  getVideoTracks: () => [],
  addTrack: () => undefined,
  removeTrack: () => undefined,
};

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getUserMedia = vi.fn(async () => stream);
});

function media(): VoiceMediaDevices {
  return {
    getUserMedia: getUserMedia as unknown as VoiceMediaDevices["getUserMedia"],
    enumerateDevices: async () => [],
  };
}

describe("getUserMedia microphone constraints", () => {
  it("never passes a native communication-route uid as a WebRTC deviceId", async () => {
    await acquireUserMediaFrom(media(), {
      settings: { ...DEFAULT_VOICE_SETTINGS, inputDeviceId: "native:2" },
      withVideo: false,
    });

    const constraints = getUserMedia.mock.calls[0]?.[0];
    expect(constraints.audio).toMatchObject({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
    expect(constraints.audio).not.toHaveProperty("deviceId");
  });

  it("still asks WebRTC for an exact id when the choice is a real WebRTC device", async () => {
    await acquireUserMediaFrom(media(), {
      settings: {
        ...DEFAULT_VOICE_SETTINGS,
        inputDeviceId: "microphone-id",
        cameraDeviceId: "camera-id",
      },
      withVideo: true,
    });

    expect(getUserMedia.mock.calls[0]?.[0]).toMatchObject({
      audio: { deviceId: { exact: "microphone-id" } },
      video: { deviceId: { exact: "camera-id" } },
    });
  });

  it("omits the audio device constraint for a native route even with video", async () => {
    await acquireUserMediaFrom(media(), {
      settings: { ...DEFAULT_VOICE_SETTINGS, inputDeviceId: "native:99" },
      withVideo: true,
    });
    const constraints = getUserMedia.mock.calls[0]?.[0];
    expect(constraints.audio).not.toHaveProperty("deviceId");
    expect(constraints.video).toBeTruthy();
  });
});
