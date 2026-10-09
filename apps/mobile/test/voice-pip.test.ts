import type { CallParticipantView, CallView } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { callHasVideo, pickMainVideo } from "../src/lib/voice/pip-main";
import type { VoiceStream } from "../src/lib/voice/webrtc";

function person(userId: string, overrides: Partial<CallParticipantView> = {}) {
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
  } as CallParticipantView;
}

function call(participants: CallParticipantView[], kind: CallView["kind"] = "voice"): CallView {
  return {
    id: "c",
    channelId: "ch",
    kind,
    status: "active",
    initiatorId: "me",
    ringingUserIds: [],
    screenShareUserId: null,
    startedAt: 0,
    participants,
  };
}

function stream(withVideo: boolean): VoiceStream {
  return { getVideoTracks: () => (withVideo ? [{}] : []) } as unknown as VoiceStream;
}

describe("callHasVideo", () => {
  it("is false with no call", () => {
    expect(callHasVideo(null, true)).toBe(false);
  });

  it("is false for a voice call where nobody has video", () => {
    expect(callHasVideo(call([person("me"), person("a")]), false)).toBe(false);
  });

  it("is true for a video call, your own camera, anyone's camera, or a shared screen", () => {
    expect(callHasVideo(call([person("me")], "video"), false)).toBe(true);
    expect(callHasVideo(call([person("me")]), true)).toBe(true);
    expect(callHasVideo(call([person("me"), person("a", { video: true })]), false)).toBe(true);
    expect(callHasVideo(call([person("me"), person("a", { sharingScreen: true })]), false)).toBe(
      true,
    );
  });
});

describe("pickMainVideo", () => {
  it("is null with no call or nobody to watch", () => {
    expect(pickMainVideo(null, new Map(), "me")).toBeNull();
    expect(pickMainVideo(call([person("me")]), new Map(), "me")).toBeNull();
  });

  it("prefers a shared screen over a camera", () => {
    const share = stream(true);
    const main = pickMainVideo(
      call([
        person("me"),
        person("cam", { video: true }),
        person("sharer", { sharingScreen: true }),
      ]),
      new Map([
        ["cam", stream(true)],
        ["sharer", share],
      ]),
      "me",
    );
    expect(main).toEqual({ userId: "sharer", stream: share });
  });

  it("falls back to a camera when the share has no picture yet", () => {
    const camera = stream(true);
    const main = pickMainVideo(
      call([
        person("me"),
        person("cam", { video: true }),
        person("sharer", { sharingScreen: true }),
      ]),
      new Map([
        ["cam", camera],
        ["sharer", stream(false)],
      ]),
      "me",
    );
    expect(main?.userId).toBe("cam");
  });

  it("never picks the caller's own video", () => {
    const main = pickMainVideo(
      call([person("me", { video: true }), person("other")]),
      new Map([["me", stream(true)]]),
      "me",
    );
    expect(main).toBeNull();
  });

  it("skips someone whose camera is on but whose stream has not arrived", () => {
    const main = pickMainVideo(
      call([person("me"), person("late", { video: true }), person("ready", { video: true })]),
      new Map([["ready", stream(true)]]),
      "me",
    );
    expect(main?.userId).toBe("ready");
  });
});
