import type { CallParticipantView } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { pickPipSource } from "../lib/voice/pip-source";

function person(userId: string, overrides: Partial<CallParticipantView> = {}): CallParticipantView {
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

function streamWithVideo(video: boolean): MediaStream {
  return { getVideoTracks: () => (video ? [{}] : []) } as unknown as MediaStream;
}

function snapshot(
  participants: CallParticipantView[],
  extras: {
    streams?: [string, MediaStream][];
    screens?: [string, MediaStream][];
    speaking?: string[];
  } = {},
) {
  return {
    call: { participants } as never,
    remoteStreams: new Map(extras.streams ?? []),
    remoteScreens: new Map(extras.screens ?? []),
    remoteSpeaking: new Set(extras.speaking ?? []),
  };
}

const nameOf = (id: string) => `Name of ${id}`;

describe("pickPipSource", () => {
  it("waits for others when you are alone", () => {
    const source = pickPipSource(snapshot([person("me")]), "me", nameOf);
    expect(source).toEqual({ stream: null, label: "Waiting for others", muted: false });
  });

  it("prefers a screen share over a speaker", () => {
    const share = streamWithVideo(true);
    const source = pickPipSource(
      snapshot([person("me"), person("talker"), person("sharer", { sharingScreen: true })], {
        streams: [["sharer", streamWithVideo(true)]],
        screens: [["sharer", share]],
        speaking: ["talker"],
      }),
      "me",
      nameOf,
    );
    expect(source.label).toBe("Name of sharer");
    expect(source.stream).toBe(share);
  });

  it("falls back to the mesh stream when the share is not relayed", () => {
    const mesh = streamWithVideo(true);
    const source = pickPipSource(
      snapshot([person("me"), person("sharer", { sharingScreen: true })], {
        streams: [["sharer", mesh]],
      }),
      "me",
      nameOf,
    );
    expect(source.stream).toBe(mesh);
  });

  it("follows the speaker when nobody is sharing", () => {
    const source = pickPipSource(
      snapshot([person("me"), person("quiet"), person("talker")], { speaking: ["talker"] }),
      "me",
      nameOf,
    );
    expect(source.label).toBe("Name of talker");
  });

  it("shows the first other person when nobody is sharing or talking", () => {
    const source = pickPipSource(
      snapshot([person("me"), person("first"), person("second")]),
      "me",
      nameOf,
    );
    expect(source.label).toBe("Name of first");
  });

  it("never picks the caller", () => {
    const source = pickPipSource(
      snapshot([person("me", { sharingScreen: true }), person("other")], { speaking: ["me"] }),
      "me",
      nameOf,
    );
    expect(source.label).toBe("Name of other");
  });

  it("shows no picture for a stream without video, and carries the muted flag", () => {
    const source = pickPipSource(
      snapshot([person("me"), person("other", { muted: true })], {
        streams: [["other", streamWithVideo(false)]],
      }),
      "me",
      nameOf,
    );
    expect(source.stream).toBeNull();
    expect(source.muted).toBe(true);
  });
});
