import type { CallParticipantView, CallView, ChannelView } from "@aulora/core";
import { describe, expect, it, vi } from "vitest";

// The components run for real; only the native edges are replaced with string tags,
// so what they return is a plain element tree that can be read.
vi.mock("react-native", () => ({
  View: "View",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Modal: "Modal",
  AccessibilityInfo: {},
}));
vi.mock("../src/components/layout/ScreenContainer", () => ({
  useScreenInsets: () => ({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    keyboardBottom: 0,
    sheetBottom: 12,
  }),
}));
vi.mock("@aulora/ui-native", () => ({
  Button: "Button",
  Text: "Text",
  Heading: "Heading",
  Icon: "Icon",
  usePalette: () => ({ secondary: "#0f0", border: "#333", "text-muted": "#999", accent: "#00f" }),
}));
vi.mock("../src/components/chat/List", () => ({
  ListGroup: "ListGroup",
  ListHeader: "ListHeader",
}));
vi.mock("../src/components/chat/MemberAvatar", () => ({ MemberAvatar: "MemberAvatar" }));
vi.mock("../src/components/voice/CallControls", () => ({ CallControls: "CallControls" }));
vi.mock("../src/components/voice/CallVideo", () => ({ CallVideo: "CallVideo" }));
vi.mock("../src/lib/voice/pip", () => ({ pickMainVideo: () => null }));
vi.mock("../src/lib/voice/webrtc", () => ({ tryCreateMediaStream: () => null }));
vi.mock("../src/providers/VoiceProvider", () => ({ useVoice: () => ({}) }));

import { ParticipantOverlay } from "../src/components/voice/CallScreen";
import { VoiceChannelPreJoin } from "../src/components/voice/VoiceChannelPreJoin";
import {
  GuestBadge,
  participantLabel,
  VoiceChannelSection,
} from "../src/components/voice/VoiceChannelSection";

interface Node {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
}

/** Expands function components and returns every host element in the tree. */
function elements(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node !== "object") {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap(elements);
  }
  const element = node as Node;
  if (typeof element.type === "function") {
    return elements((element.type as (props: Record<string, unknown>) => unknown)(element.props));
  }
  return [element, ...elements(element.props.children)];
}

function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join("");
  }
  if (node !== null && typeof node === "object") {
    return textOf((node as Node).props.children);
  }
  return "";
}

function labels(tree: Node[]): string[] {
  return tree.filter((node) => node.type === "Text").map((node) => textOf(node.props.children));
}

const hasGuestBadge = (tree: Node[]) =>
  tree.some((node) => node.props.accessibilityLabel === "Guest");

function seat(overrides: Partial<CallParticipantView> & { userId: string }): CallParticipantView {
  return {
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

const GUEST_SESSION_ID = "kd7b1m3q9z8r5t2v4w6x0y1a2c3e4f5g";
const members = new Map([["u1", "Sam Rivera"]]);

describe("participantLabel", () => {
  it("names a member from the workspace member map, unchanged", () => {
    expect(participantLabel(seat({ userId: "u1" }), members)).toBe("Sam Rivera");
    expect(participantLabel(seat({ userId: "u2" }), members)).toBe("u2");
  });

  it("prefers the name the server sent, for a guest", () => {
    const guest = seat({ userId: GUEST_SESSION_ID, displayName: "Alex Visitor", isGuest: true });
    expect(participantLabel(guest, members)).toBe("Alex Visitor");
  });

  it("never shows a guest's raw session id or 'undefined' when no name was sent", () => {
    for (const displayName of [undefined, null, "", "   "]) {
      const guest = seat({
        userId: GUEST_SESSION_ID,
        isGuest: true,
        ...(displayName === undefined ? {} : { displayName }),
      });
      const label = participantLabel(guest, members);
      expect(label).toBe("Guest");
      expect(label).not.toContain(GUEST_SESSION_ID);
      expect(label).not.toContain("undefined");
    }
  });
});

describe("CallScreen participant overlay", () => {
  const render = (participant: CallParticipantView, name: string) =>
    elements(ParticipantOverlay({ participant, name, overVideo: false }));

  it("shows a member as before, with no Guest badge", () => {
    const tree = render(seat({ userId: "u1" }), participantLabel(seat({ userId: "u1" }), members));
    expect(labels(tree)).toEqual(["Sam Rivera"]);
    expect(hasGuestBadge(tree)).toBe(false);
  });

  it("shows a guest's name with a Guest badge that assistive tech can read", () => {
    const guest = seat({ userId: GUEST_SESSION_ID, displayName: "Alex Visitor", isGuest: true });
    const tree = render(guest, participantLabel(guest, members));
    expect(labels(tree)).toEqual(["Alex Visitor", "Guest"]);
    expect(hasGuestBadge(tree)).toBe(true);
  });

  it("falls back safely for a guest with no name", () => {
    const guest = seat({ userId: GUEST_SESSION_ID, isGuest: true });
    const tree = render(guest, participantLabel(guest, members));
    expect(labels(tree)).toEqual(["Guest", "Guest"]);
    expect(labels(tree).join(" ")).not.toContain(GUEST_SESSION_ID);
  });
});

describe("voice channel list", () => {
  function section(participants: CallParticipantView[]) {
    const channel = { id: "ch1", name: "Lounge", kind: "voice" } as unknown as ChannelView;
    const call = {
      id: "call1",
      channelId: "ch1",
      kind: "voice",
      status: "active",
      participants,
    } as unknown as CallView;
    return elements(
      VoiceChannelSection({
        channels: [channel],
        activeCalls: [call],
        memberNames: members,
        selfUserId: "me",
        clientId: null,
        localCallId: null,
        onOpen: () => undefined,
      }),
    );
  }

  it("lists a member by name with no Guest badge", () => {
    const tree = section([seat({ userId: "u1" })]);
    expect(labels(tree)).toContain("Sam Rivera");
    expect(hasGuestBadge(tree)).toBe(false);
  });

  it("lists a guest by the name the server sent, with a Guest badge", () => {
    const tree = section([
      seat({ userId: GUEST_SESSION_ID, displayName: "Alex Visitor", isGuest: true }),
    ]);
    expect(labels(tree)).toContain("Alex Visitor");
    expect(labels(tree)).toContain("Guest");
    expect(hasGuestBadge(tree)).toBe(true);
    expect(labels(tree).join(" ")).not.toContain(GUEST_SESSION_ID);
  });

  it("lists a guest without a name as 'Guest', never undefined or the raw id", () => {
    const tree = section([seat({ userId: GUEST_SESSION_ID, isGuest: true })]);
    const joined = labels(tree).join(" ");
    expect(joined).toContain("Guest");
    expect(joined).not.toContain("undefined");
    expect(joined).not.toContain(GUEST_SESSION_ID);
  });
});

describe("voice channel pre-join", () => {
  function preJoin(overrides: Partial<Parameters<typeof VoiceChannelPreJoin>[0]> = {}): Node[] {
    return elements(
      VoiceChannelPreJoin({
        channelName: "Lounge",
        topic: "Talk here",
        participants: [seat({ userId: "u1" })],
        memberNames: members,
        canConnect: true,
        canVideo: true,
        pending: false,
        joined: false,
        onJoin: () => undefined,
        ...overrides,
      }),
    );
  }

  const buttons = (tree: Node[]) =>
    tree.filter((node) => node.type === "Button").map((node) => textOf(node.props.children));

  it("names everyone in the call and waits for an explicit join", () => {
    const tree = preJoin();
    expect(labels(tree).join(" ")).toContain("Sam Rivera");
    expect(labels(tree).join(" ")).toContain("1 person in the call");
    expect(buttons(tree)).toEqual(["Join voice", "Join with video"]);
  });

  it("passes the chosen media kind to the join action", () => {
    const joined: string[] = [];
    const tree = preJoin({ onJoin: (kind) => joined.push(kind) });
    for (const button of tree.filter((node) => node.type === "Button")) {
      (button.props.onPress as () => void)();
    }
    expect(joined).toEqual(["voice", "video"]);
  });

  it("hides the video choice when video is unavailable", () => {
    expect(buttons(preJoin({ canVideo: false }))).toEqual(["Join voice"]);
  });

  it("explains a missing call permission instead of offering a join", () => {
    const tree = preJoin({ canConnect: false });
    expect(buttons(tree)).toEqual([]);
    expect(labels(tree).join(" ")).toContain("do not have permission to join calls");
  });

  it("shows the joined state without a second join action", () => {
    const tree = preJoin({ joined: true });
    expect(buttons(tree)).toEqual([]);
    expect(labels(tree).join(" ")).toContain("You are in this call");
  });

  it("handles an empty call", () => {
    const tree = preJoin({ participants: [] });
    expect(labels(tree).join(" ")).toContain("No one is in the call yet");
    expect(buttons(tree)).toEqual(["Join voice", "Join with video"]);
  });
});

describe("GuestBadge", () => {
  it("is labelled 'Guest' for assistive technology", () => {
    const tree = elements(GuestBadge());
    expect(tree[0]?.props.accessibilityLabel).toBe("Guest");
  });
});
