/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
/**
 * The desktop shell's call picture-in-picture window.
 *
 * The call — its peer connections and its media — lives in the main webview and
 * cannot be handed to a second one. So the shell opens a *separate* small,
 * always-on-top window with the same bundled client at the `#pip` entry, and the
 * two webviews keep each other in step: the main window streams a light snapshot
 * of the call (`PIP_STATE_EVENT`), and the PiP window sends control presses back
 * (`PIP_ACTION_EVENT`). Closing the PiP window destroys only that window; the
 * shell raises `PIP_CLOSED_EVENT` on the main window and the call goes on.
 *
 * The payloads are validated on both sides: a webview is a message-passing
 * boundary, and nothing here should trust it more than a network response.
 */
import { type CallKind, type CallParticipantView, sortParticipants } from "@aulora/core";
import type { VoiceLocalState } from "./voice/call-types";

/** Streams the call snapshot from the main window to the PiP window. */
export const PIP_STATE_EVENT = "aulora://call-pip-state";
/** Sends a control press from the PiP window to the main window. */
export const PIP_ACTION_EVENT = "aulora://call-pip-action";
/**
 * Carries the loopback video handshake between the two webviews: an SDP
 * offer/answer and the host ICE candidates of the peer connections that move
 * the picture without a network. Payloads are validated by `pip-loopback.ts`.
 */
export const PIP_SIGNAL_EVENT = "aulora://call-pip-signal";
/** Raised on the main window by the shell when the PiP window goes away. */
export const PIP_CLOSED_EVENT = "aulora://call-pip-closed";
/** The shell's label for the PiP window; events are addressed to it. */
export const PIP_WINDOW_LABEL = "pip";
/** The shell's label for the app window; the PiP window addresses events to it. */
export const MAIN_WINDOW_LABEL = "main";
/**
 * The hash entry `pip_window.rs` loads. `main.tsx` renders the PiP view for it,
 * and `bun run verify` in `apps/desktop` fails if the two drift apart.
 */
export const PIP_WINDOW_HASH = "#pip";

/** One participant, as the tiny window draws them. */
export interface PipParticipant {
  readonly id: string;
  readonly name: string;
  readonly speaking: boolean;
  readonly muted: boolean;
  readonly deafened: boolean;
  readonly camera: boolean;
  readonly screen: boolean;
  readonly self: boolean;
}

/** What the picture in the window is showing. */
export type PipMediaKind = "screen" | "camera" | "local" | "none";

/** Everything the PiP window draws. Small: it is sent several times a second. */
export interface PipCallState {
  readonly kind: CallKind;
  readonly startedAt: number;
  readonly muted: boolean;
  readonly deafened: boolean;
  readonly camera: boolean;
  readonly screen: boolean;
  readonly canSpeak: boolean;
  readonly canVideo: boolean;
  readonly canStream: boolean;
  readonly participants: readonly PipParticipant[];
  /**
   * What the video surface shows: a shared screen, a remote camera, the
   * caller's own picture, or nothing (avatars). Optional on the wire so a main
   * window from before this field existed still parses.
   */
  readonly mediaKind: PipMediaKind;
  /** Who the picture belongs to, for the overlay. Empty when there is none. */
  readonly speakerName: string;
}

/** A control press the PiP window can send to the call. */
export type PipAction =
  | "toggle-mute"
  | "toggle-deafen"
  | "toggle-camera"
  | "toggle-screen"
  | "leave";

export interface PipStateInput {
  readonly call: {
    readonly kind: CallKind;
    readonly startedAt: number;
    readonly participants: readonly CallParticipantView[];
  } | null;
  readonly local: VoiceLocalState;
  readonly remoteSpeaking: ReadonlySet<string>;
  readonly localSpeaking: boolean;
  readonly selfUserId: string;
  readonly canSpeak: boolean;
  readonly canVideo: boolean;
  readonly canStream: boolean;
  readonly nameOf: (userId: string) => string;
  /** What the video surface is showing; defaults to `"none"` (avatars). */
  readonly mediaKind?: PipMediaKind;
  /** The name to show over the picture; defaults to empty. */
  readonly speakerName?: string;
}

/**
 * Builds the snapshot the PiP window draws, or `null` when there is no call.
 * Speaking uses the local level meter, like the main window's tiles do, and the
 * participants keep the same order the big view uses.
 */
export function buildPipState(input: PipStateInput): PipCallState | null {
  const { call } = input;
  if (call === null) {
    return null;
  }
  const participants = sortParticipants(call.participants).map((participant) => {
    const self = participant.userId === input.selfUserId;
    return {
      id: participant.userId,
      name: input.nameOf(participant.userId),
      speaking: self ? input.localSpeaking : input.remoteSpeaking.has(participant.userId),
      muted: participant.muted,
      deafened: participant.deafened,
      camera: participant.video,
      screen: participant.sharingScreen,
      self,
    };
  });
  return {
    kind: call.kind,
    startedAt: call.startedAt,
    muted: input.local.muted,
    deafened: input.local.deafened,
    camera: input.local.video,
    screen: input.local.sharingScreen,
    canSpeak: input.canSpeak,
    canVideo: input.canVideo,
    canStream: input.canStream,
    participants,
    mediaKind: input.mediaKind ?? "none",
    speakerName: input.speakerName ?? "",
  };
}

/** Reads the media kind off the wire; anything unknown is `"none"`. */
export function parsePipMediaKind(value: unknown): PipMediaKind {
  switch (value) {
    case "screen":
    case "camera":
    case "local":
    case "none":
      return value;
    default:
      return "none";
  }
}

function parseParticipant(value: unknown): PipParticipant | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const participant = value as Partial<PipParticipant>;
  if (typeof participant.id !== "string" || typeof participant.name !== "string") {
    return null;
  }
  return {
    id: participant.id,
    name: participant.name,
    speaking: participant.speaking === true,
    muted: participant.muted === true,
    deafened: participant.deafened === true,
    camera: participant.camera === true,
    screen: participant.screen === true,
    self: participant.self === true,
  };
}

/** Reads a state payload off the event bus, or `null` when it is not one. */
export function parsePipState(value: unknown): PipCallState | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const state = value as Partial<PipCallState> & { readonly participants?: unknown };
  const { kind, startedAt, participants } = state;
  if ((kind !== "voice" && kind !== "video") || typeof startedAt !== "number") {
    return null;
  }
  if (!Array.isArray(participants)) {
    return null;
  }
  const parsed: PipParticipant[] = [];
  for (const entry of participants as readonly unknown[]) {
    const participant = parseParticipant(entry);
    if (participant === null) {
      return null;
    }
    parsed.push(participant);
  }
  return {
    kind,
    startedAt,
    muted: state.muted === true,
    deafened: state.deafened === true,
    camera: state.camera === true,
    screen: state.screen === true,
    canSpeak: state.canSpeak === true,
    canVideo: state.canVideo === true,
    canStream: state.canStream === true,
    participants: parsed,
    mediaKind: parsePipMediaKind(state.mediaKind),
    speakerName: typeof state.speakerName === "string" ? state.speakerName : "",
  };
}

/** Reads a control press off the event bus, or `null` when it is not one. */
export function parsePipAction(value: unknown): PipAction | null {
  switch (value) {
    case "toggle-mute":
    case "toggle-deafen":
    case "toggle-camera":
    case "toggle-screen":
    case "leave":
      return value;
    default:
      return null;
  }
}

/** Whether this page is the PiP window's entry rather than the app. */
export function isPipWindowLocation(location: { readonly hash: string }): boolean {
  return location.hash === PIP_WINDOW_HASH;
}
