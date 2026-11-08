import type { CallParticipantView } from "@aulora/core";
import { describe, expect, it } from "vitest";
import {
  buildPipState,
  isPipWindowLocation,
  PIP_WINDOW_HASH,
  type PipStateInput,
  parsePipAction,
  parsePipState,
} from "../lib/call-pip";
import type { VoiceLocalState } from "../lib/voice/call-types";

const participant = (
  userId: string,
  extra: Partial<CallParticipantView> = {},
): CallParticipantView => ({
  userId,
  muted: false,
  deafened: false,
  video: false,
  sharingScreen: false,
  sfu: true,
  joinedAt: 0,
  clientId: null,
  session: 1,
  speaking: false,
  audioLevel: 0,
  connection: "connected",
  ...extra,
});

const LOCAL: VoiceLocalState = {
  muted: false,
  deafened: false,
  video: false,
  sharingScreen: false,
};

function input(overrides: Partial<PipStateInput> = {}): PipStateInput {
  return {
    call: {
      kind: "voice",
      startedAt: 1_000,
      participants: [participant("me"), participant("them")],
    },
    local: LOCAL,
    remoteSpeaking: new Set<string>(),
    localSpeaking: false,
    selfUserId: "me",
    canSpeak: true,
    canVideo: true,
    canStream: true,
    nameOf: (id) => `Name of ${id}`,
    ...overrides,
  };
}

describe("buildPipState", () => {
  it("has nothing to draw without a call", () => {
    expect(buildPipState(input({ call: null }))).toBeNull();
  });

  it("resolves names, flags self, and carries the local controls", () => {
    const state = buildPipState(
      input({
        local: { muted: true, deafened: true, video: false, sharingScreen: false },
      }),
    );
    expect(state?.kind).toBe("voice");
    expect(state?.startedAt).toBe(1_000);
    expect(state?.participants).toEqual([
      {
        id: "me",
        name: "Name of me",
        speaking: false,
        muted: false,
        deafened: false,
        camera: false,
        screen: false,
        self: true,
      },
      {
        id: "them",
        name: "Name of them",
        speaking: false,
        muted: false,
        deafened: false,
        camera: false,
        screen: false,
        self: false,
      },
    ]);
    expect(state?.muted).toBe(true);
    expect(state?.deafened).toBe(true);
    expect(state).toMatchObject({ canSpeak: true, canVideo: true, canStream: true });
  });

  it("uses the local level meter for speaking, like the big view", () => {
    const state = buildPipState(
      input({
        remoteSpeaking: new Set(["them"]),
        localSpeaking: true,
        call: {
          kind: "video",
          startedAt: 0,
          // The server's own flag is stale; the meter wins.
          participants: [participant("me"), participant("them", { speaking: false })],
        },
      }),
    );
    expect(state?.participants[0]?.speaking).toBe(true);
    expect(state?.participants[1]?.speaking).toBe(true);
  });

  it("does not claim the self tile is speaking when the meter says otherwise", () => {
    const state = buildPipState(input({ localSpeaking: false, remoteSpeaking: new Set() }));
    expect(state?.participants[0]?.speaking).toBe(false);
  });

  it("passes through the states worth a badge", () => {
    const state = buildPipState(
      input({
        call: {
          kind: "video",
          startedAt: 0,
          participants: [
            participant("me", { muted: true }),
            participant("them", { deafened: true, video: true, sharingScreen: true }),
          ],
        },
      }),
    );
    expect(state?.participants.find((entry) => entry.id === "me")).toMatchObject({ muted: true });
    expect(state?.participants.find((entry) => entry.id === "them")).toMatchObject({
      deafened: true,
      camera: true,
      screen: true,
    });
  });

  it("puts a sharer first, as the full view does", () => {
    const state = buildPipState(
      input({
        call: {
          kind: "video",
          startedAt: 0,
          participants: [
            participant("me"),
            participant("them", { sharingScreen: true }),
            participant("third"),
          ],
        },
      }),
    );
    expect(state?.participants.map((entry) => entry.id)).toEqual(["them", "me", "third"]);
  });
});

describe("parsePipState", () => {
  it("round-trips a state it built", () => {
    const built = buildPipState(input({ remoteSpeaking: new Set(["them"]) }));
    expect(parsePipState(built)).toEqual(built);
  });

  it("defaults the flags it was not sent", () => {
    const parsed = parsePipState({
      kind: "voice",
      startedAt: 5,
      participants: [{ id: "a", name: "A" }],
    });
    expect(parsed).toEqual({
      kind: "voice",
      startedAt: 5,
      muted: false,
      deafened: false,
      camera: false,
      screen: false,
      canSpeak: false,
      canVideo: false,
      canStream: false,
      participants: [
        {
          id: "a",
          name: "A",
          speaking: false,
          muted: false,
          deafened: false,
          camera: false,
          screen: false,
          self: false,
        },
      ],
      // A main window from before the picture was sent still parses.
      mediaKind: "none",
      speakerName: "",
    });
  });

  it("carries what the picture shows and whose it is", () => {
    const built = buildPipState(input({ mediaKind: "screen", speakerName: "Grace" }));
    expect(built?.mediaKind).toBe("screen");
    expect(built?.speakerName).toBe("Grace");

    const parsed = parsePipState({
      kind: "video",
      startedAt: 0,
      participants: [],
      mediaKind: "camera",
      speakerName: "Ada",
    });
    expect(parsed?.mediaKind).toBe("camera");
    expect(parsed?.speakerName).toBe("Ada");
  });

  it("treats an unknown media kind as no picture", () => {
    const parsed = parsePipState({
      kind: "voice",
      startedAt: 0,
      participants: [],
      mediaKind: "hologram",
      speakerName: 7,
    });
    expect(parsed?.mediaKind).toBe("none");
    expect(parsed?.speakerName).toBe("");
  });

  it("rejects anything that is not a state", () => {
    expect(parsePipState(null)).toBeNull();
    expect(parsePipState("state")).toBeNull();
    expect(parsePipState({})).toBeNull();
    expect(parsePipState({ kind: "audio", startedAt: 0, participants: [] })).toBeNull();
    expect(parsePipState({ kind: "voice", startedAt: "now", participants: [] })).toBeNull();
    expect(parsePipState({ kind: "voice", startedAt: 0, participants: {} })).toBeNull();
    expect(parsePipState({ kind: "voice", startedAt: 0, participants: [null] })).toBeNull();
    expect(parsePipState({ kind: "voice", startedAt: 0, participants: [{ id: "a" }] })).toBeNull();
  });
});

describe("parsePipAction", () => {
  it("accepts the controls the window offers", () => {
    for (const action of [
      "toggle-mute",
      "toggle-deafen",
      "toggle-camera",
      "toggle-screen",
      "leave",
    ]) {
      expect(parsePipAction(action)).toBe(action);
    }
  });

  it("rejects everything else", () => {
    expect(parsePipAction("toggle-everything")).toBeNull();
    expect(parsePipAction({ action: "leave" })).toBeNull();
    expect(parsePipAction(null)).toBeNull();
  });
});

describe("isPipWindowLocation", () => {
  it("recognises the entry the shell loads", () => {
    expect(isPipWindowLocation({ hash: PIP_WINDOW_HASH })).toBe(true);
    expect(isPipWindowLocation({ hash: "#pip" })).toBe(true);
  });

  it("leaves the app's own pages alone", () => {
    expect(isPipWindowLocation({ hash: "" })).toBe(false);
    expect(isPipWindowLocation({ hash: "#/connect" })).toBe(false);
    expect(isPipWindowLocation({ hash: "#pip/extra" })).toBe(false);
  });
});
