import { describe, expect, it, vi } from "vitest";
import { joinVoiceChannelWith, type VoiceChannelJoinPort } from "../src/lib/voice/join-channel";

function port(overrides: Partial<VoiceChannelJoinPort> = {}): VoiceChannelJoinPort {
  return {
    activeCalls: [],
    joinCall: vi.fn(async () => true),
    startCall: vi.fn(async () => "call"),
    setCamera: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("voice channel pre-join action", () => {
  it("starts a new call with the chosen media kind", () => {
    const voice = port();
    joinVoiceChannelWith(voice, "channel", "video");
    expect(voice.startCall).toHaveBeenCalledWith("channel", "video");
    expect(voice.joinCall).not.toHaveBeenCalled();
  });

  it("joins the live call and turns the camera on for a video join", async () => {
    const voice = port({
      activeCalls: [{ id: "call", channelId: "channel" }],
    });
    joinVoiceChannelWith(voice, "channel", "video");
    expect(voice.joinCall).toHaveBeenCalledWith("call");
    await vi.waitFor(() => expect(voice.setCamera).toHaveBeenCalledWith(true));
  });

  it("joins a live call without turning the camera on for a voice join", async () => {
    const voice = port({
      activeCalls: [{ id: "call", channelId: "channel" }],
    });
    joinVoiceChannelWith(voice, "channel");
    await vi.waitFor(() => expect(voice.joinCall).toHaveBeenCalledWith("call"));
    // Let the join continuation run before checking it did not enable video.
    await Promise.resolve();
    expect(voice.setCamera).not.toHaveBeenCalled();
  });

  it("does not enable the camera when the seat could not be claimed", async () => {
    const voice = port({
      activeCalls: [{ id: "call", channelId: "channel" }],
      joinCall: vi.fn(async () => false),
    });
    joinVoiceChannelWith(voice, "channel", "video");
    await vi.waitFor(() => expect(voice.joinCall).toHaveBeenCalled());
    await Promise.resolve();
    expect(voice.setCamera).not.toHaveBeenCalled();
  });

  it("ignores a live call in another channel", () => {
    const voice = port({
      activeCalls: [{ id: "other", channelId: "elsewhere" }],
    });
    joinVoiceChannelWith(voice, "channel", "voice");
    expect(voice.startCall).toHaveBeenCalledWith("channel", "voice");
    expect(voice.joinCall).not.toHaveBeenCalled();
  });
});
