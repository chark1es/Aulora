import type { CallParticipantView, ChannelView } from "@aulora/core";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceChannelRow } from "../components/voice/VoiceChannelRow";

const state = vi.hoisted(() => ({ participants: [] as unknown[] }));

vi.mock("../providers/VoiceProvider", () => ({
  useVoice: () => ({
    activeCalls: [
      { id: "call1", channelId: "vc1", status: "active", participants: state.participants },
    ],
    selfUserId: "me",
    clientId: null,
    callId: null,
    localSpeaking: false,
    remoteSpeaking: new Set<string>(),
  }),
}));

const GUEST_SESSION_ID = "kd7b1m3q9z8r5t2v4w6x0y1a2c3e4f5g";
const OTHER_GUEST_ID = "kd7c2n4r0a9s6u3w5x7y1z2b3d4f5g6h";

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

const channel = {
  id: "vc1",
  kind: "voice",
  name: "Lounge",
  categoryId: null,
} as unknown as ChannelView;

// The sidebar's directory lookup: members by name, anyone else "Member".
const directory = new Map([["u1", "Sam Rivera"]]);
const nameOf = (id: string) => directory.get(id) ?? "Member";

function row() {
  return render(
    <VoiceChannelRow
      channel={channel}
      title="Lounge"
      active={false}
      onSelect={vi.fn()}
      onContextMenu={vi.fn()}
      nameOf={nameOf}
    />,
  );
}

beforeEach(() => {
  state.participants = [];
});

describe("VoiceChannelRow participants", () => {
  it("lists a member as before, with no Guest badge", () => {
    state.participants = [seat({ userId: "u1" })];
    row();
    const list = screen.getByRole("list");
    expect(within(list).getByText("Sam Rivera")).toBeInTheDocument();
    expect(within(list).queryByText("Guest")).toBeNull();
  });

  it("shows two guests by their chosen names, each with a Guest badge", () => {
    state.participants = [
      seat({ userId: GUEST_SESSION_ID, displayName: "Alex Visitor", isGuest: true }),
      seat({ userId: OTHER_GUEST_ID, displayName: "Kim Park", isGuest: true }),
    ];
    row();
    const list = screen.getByRole("list");
    expect(within(list).getByText("Alex Visitor")).toBeInTheDocument();
    expect(within(list).getByText("Kim Park")).toBeInTheDocument();
    expect(within(list).getAllByText("Guest")).toHaveLength(2);
    expect(within(list).queryByText("Member")).toBeNull();
    expect(list.textContent).not.toContain(GUEST_SESSION_ID);
  });

  it("falls back to 'Guest' for a guest with no name: never 'Member', never the raw id", () => {
    state.participants = [seat({ userId: GUEST_SESSION_ID, isGuest: true })];
    row();
    const list = screen.getByRole("list");
    expect(within(list).queryByText("Member")).toBeNull();
    expect(list.textContent).not.toContain(GUEST_SESSION_ID);
    expect(list.textContent).not.toContain("undefined");
    // The name fallback and the badge both say Guest.
    expect(within(list).getAllByText("Guest").length).toBeGreaterThan(0);
  });

  it("mixes a member and a guest without confusing them", () => {
    state.participants = [
      seat({ userId: "u1" }),
      seat({ userId: GUEST_SESSION_ID, displayName: "Alex Visitor", isGuest: true }),
    ];
    row();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0] as HTMLElement).queryByText("Guest")).toBeNull();
    expect(within(items[1] as HTMLElement).getByText("Guest")).toBeInTheDocument();
  });
});
