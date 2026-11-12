import { describe, expect, it, vi } from "vitest";
import {
  joinVoiceChannelWith,
  preJoinCallView,
  type VoiceChannelJoinPort,
} from "../src/lib/voice/join-channel";

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
  it("starts a new call with the chosen media kind and enables its camera", async () => {
    const voice = port();
    joinVoiceChannelWith(voice, "channel", "video");
    expect(voice.startCall).toHaveBeenCalledWith("channel", "video");
    expect(voice.joinCall).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(voice.setCamera).toHaveBeenCalledWith(true));
  });

  it("starts a new voice call without enabling the camera", async () => {
    const voice = port();
    joinVoiceChannelWith(voice, "channel");
    await vi.waitFor(() => expect(voice.startCall).toHaveBeenCalledWith("channel", "voice"));
    await Promise.resolve();
    expect(voice.setCamera).not.toHaveBeenCalled();
  });

  it("does not enable the camera when a new call was refused", async () => {
    const voice = port({ startCall: vi.fn(async () => null) });
    joinVoiceChannelWith(voice, "channel", "video");
    await vi.waitFor(() => expect(voice.startCall).toHaveBeenCalled());
    await Promise.resolve();
    expect(voice.setCamera).not.toHaveBeenCalled();
  });

  it("surfaces a rejected new-call start without enabling the camera", async () => {
    const reportError = vi.fn();
    const voice = port({
      startCall: vi.fn(async () => {
        throw new Error("Call start refused");
      }),
      reportError,
    });
    joinVoiceChannelWith(voice, "channel", "video");
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith("Call start refused"));
    expect(voice.setCamera).not.toHaveBeenCalled();
  });

  it("surfaces a camera failure after a successful new video call", async () => {
    const reportError = vi.fn();
    const voice = port({
      setCamera: vi.fn(async () => {
        throw new Error("Camera unavailable");
      }),
      reportError,
    });
    joinVoiceChannelWith(voice, "channel", "video");
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith("Camera unavailable"));
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

  it("surfaces a rejected claim instead of swallowing it", async () => {
    const reportError = vi.fn();
    const voice = port({
      activeCalls: [{ id: "call", channelId: "channel" }],
      joinCall: vi.fn(async () => {
        throw new Error("Permission denied");
      }),
      reportError,
    });
    joinVoiceChannelWith(voice, "channel");
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith("Permission denied"));
  });

  it("surfaces a camera failure after a successful video join", async () => {
    const reportError = vi.fn();
    const voice = port({
      activeCalls: [{ id: "call", channelId: "channel" }],
      setCamera: vi.fn(async () => {
        throw new Error("Camera unavailable");
      }),
      reportError,
    });
    joinVoiceChannelWith(voice, "channel", "video");
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith("Camera unavailable"));
  });

  it("renders the current failure with retry while keeping the join controls", () => {
    expect(
      preJoinCallView({
        canConnect: true,
        joined: false,
        pending: false,
        error: "Permission denied",
      }),
    ).toEqual({ mode: "join", error: "Permission denied" });
    // Retry is unavailable while the retry attempt is already running.
    expect(
      preJoinCallView({
        canConnect: true,
        joined: false,
        pending: true,
        error: "Permission denied",
      }),
    ).toEqual({ mode: "join", error: "Permission denied" });
    // Permission removal shows the denial branch but keeps the reason visible.
    expect(
      preJoinCallView({
        canConnect: false,
        joined: false,
        pending: false,
        error: "Permission denied",
      }),
    ).toEqual({ mode: "denied", error: "Permission denied" });
    expect(
      preJoinCallView({ canConnect: true, joined: true, pending: false, error: null }),
    ).toEqual({ mode: "joined", error: null });
    expect(
      preJoinCallView({ canConnect: true, joined: false, pending: false, error: "   " }),
    ).toEqual({ mode: "join", error: null });
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
