import {
  type CallParticipantView,
  GUEST_AFFILIATION_MAX,
  GUEST_CALL_PATH,
  GUEST_LINK_TOKEN_PREFIX,
  GUEST_NAME_MAX,
  GUEST_SESSION_TOKEN_PREFIX,
  guestLinkUrl,
  isOnThisDevice,
  isWellFormedGuestToken,
} from "@aulora/core";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_GUEST_CHOICES } from "../components/guest/DeviceCheck";
import { useGuestEngine } from "../components/guest/use-guest-engine";
import { CallGrid } from "../components/voice/CallParticipant";
import { parseGuestFragment } from "../lib/guest/fragment";
import {
  type GuestRoster,
  type GuestSignal,
  guestVoiceSubscriptions,
  rosterToCallView,
} from "../lib/guest/guest-voice";
import { type LobbyStatus, previewNotice, screenFor } from "../lib/guest/page-state";
import { VoiceEngine } from "../lib/voice/call-engine";
import { DEFAULT_VOICE_SETTINGS } from "../lib/voice/device-settings";

const recorded = vi.hoisted(() => ({
  reconciled: [] as string[][],
  signals: [] as { id: string; fromUserId: string; toUserId: string }[],
}));

// The real mesh minus the browser's RTCPeerConnection: what the engine hands it is
// what we assert on, so a key mismatch between page and server cannot hide.
vi.mock("../lib/voice/peer-mesh", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/voice/peer-mesh")>();
  class RecordingMesh extends original.PeerMesh {
    override reconcile(participants: readonly { userId: string; session: number }[]): void {
      recorded.reconciled.push(participants.map((participant) => participant.userId));
    }
    override async handleSignals(
      signals: readonly { id: string; fromUserId: string; toUserId: string }[],
    ): Promise<void> {
      recorded.signals.push(...signals);
    }
  }
  return { ...original, PeerMesh: RecordingMesh };
});

// ---- Server-shaped fixtures --------------------------------------------------

const HEX = "0123456789abcdef";
const LINK_TOKEN = `${GUEST_LINK_TOKEN_PREFIX}${HEX.repeat(4)}`;
const SESSION_TOKEN = `${GUEST_SESSION_TOKEN_PREFIX}${HEX.split("").reverse().join("").repeat(4)}`;
/** Convex ids are opaque strings; the guest's seat key IS their session id. */
const GUEST_SESSION_ID = "kd7b1m3q9z8r5t2v4w6x0y1a2c3e4f5g";
const OTHER_GUEST_ID = "kd7c2n4r0a9s6u3w5x7y1z2b3d4f5g6h";
/** A member's key is opaque and never an account id. */
const MEMBER_KEY = "gk_2f6c9a41d3e7b805";
const CALL_ID = "jx7call0000000000000000000000001";

function serverRoster(overrides: Partial<GuestRoster> = {}) {
  return {
    guestSessionId: GUEST_SESSION_ID,
    displayName: "Alex",
    affiliation: "Acme",
    callId: CALL_ID,
    callStatus: "active" as const,
    scheduledCallId: null,
    transcribing: false,
    transcriptionSessionId: null,
    participants: [
      {
        participantKey: MEMBER_KEY,
        isGuest: false,
        displayName: "Sam Rivera",
        muted: false,
        video: true,
        joinedAt: 1_700_000_000_000,
        session: 4,
      },
      {
        participantKey: GUEST_SESSION_ID,
        isGuest: true,
        displayName: "Alex",
        muted: true,
        video: false,
        joinedAt: 1_700_000_005_000,
        session: 1,
      },
      {
        participantKey: OTHER_GUEST_ID,
        isGuest: true,
        displayName: "Kim",
        muted: false,
        video: false,
        joinedAt: 1_700_000_006_000,
        session: 2,
      },
    ],
    ...overrides,
  };
}

function serverSignal(overrides: Partial<GuestSignal> = {}): GuestSignal {
  return {
    id: "js7signal000000000000000000000001",
    fromParticipantKey: MEMBER_KEY,
    kind: "offer",
    payload: '{"type":"offer","sdp":"v=0"}',
    session: 4,
    createdAt: 1_700_000_007_000,
    ...overrides,
  };
}

/** A Convex client double that serves server-shaped query results by function name. */
function fakeClient(values: Record<string, unknown>) {
  const listeners = new Map<string, () => void>();
  const client = {
    watchQuery(reference: Parameters<typeof getFunctionName>[0]) {
      const name = getFunctionName(reference);
      return {
        localQueryResult: () => {
          const value = values[name];
          if (value instanceof Error) {
            throw value;
          }
          return value;
        },
        onUpdate: (callback: () => void) => {
          listeners.set(name, callback);
          return () => listeners.delete(name);
        },
      };
    },
    mutation: vi.fn().mockResolvedValue(null),
  };
  return {
    client,
    push(name: string, value: unknown) {
      values[name] = value;
      listeners.get(name)?.();
    },
  };
}

function guestEngine(
  values: Record<string, unknown>,
  options: { selfKey?: string } = {},
): { engine: VoiceEngine; push: ReturnType<typeof fakeClient>["push"] } {
  const { client, push } = fakeClient(values);
  const selfKey = options.selfKey ?? GUEST_SESSION_ID;
  const engine = new VoiceEngine({
    port: {
      leaveCall: vi.fn().mockResolvedValue(null),
      updateParticipant: vi.fn().mockResolvedValue(null),
      turnCredentials: vi.fn().mockResolvedValue(null),
      callHeartbeat: vi.fn().mockResolvedValue(null),
      sendSignal: vi.fn().mockResolvedValue(null),
      ackSignals: vi.fn().mockResolvedValue(null),
    } as never,
    subscriptions: guestVoiceSubscriptions(client as never, SESSION_TOKEN, selfKey),
    userId: selfKey,
    clientId: "guest-client-0001",
    getSettings: () => ({ ...DEFAULT_VOICE_SETTINGS, joinMuted: true, joinWithCamera: false }),
  });
  return { engine, push };
}

describe("fixtures match the shared helpers", () => {
  it("uses tokens the shared parser accepts, and the page parses the link the server builds", () => {
    expect(isWellFormedGuestToken(LINK_TOKEN, GUEST_LINK_TOKEN_PREFIX)).toBe(true);
    expect(isWellFormedGuestToken(SESSION_TOKEN, GUEST_SESSION_TOKEN_PREFIX)).toBe(true);
    const url = guestLinkUrl("https://chat.example.com", LINK_TOKEN);
    const parsed = new URL(url);
    expect(parsed.pathname).toBe(GUEST_CALL_PATH);
    expect(parseGuestFragment(parsed.hash)).toBe(LINK_TOKEN);
  });
});

describe("the guest finds its own seat (server-shaped roster)", () => {
  it("keeps the engine in the call: the guest self row is keyed by its session id", async () => {
    recorded.reconciled.length = 0;
    const { engine } = guestEngine({ "guestCalls:roster": serverRoster() });
    await engine.attachToCall(CALL_ID);

    expect(engine.isActive()).toBe(true);
    const call = engine.getSnapshot().call;
    expect(call).not.toBeNull();
    expect(isOnThisDevice(call, GUEST_SESSION_ID, "guest-client-0001")).toBe(true);
    // The mesh was handed the roster: members by opaque key, guests by session id.
    expect(recorded.reconciled.at(-1)).toEqual([MEMBER_KEY, GUEST_SESSION_ID, OTHER_GUEST_ID]);
    engine.dispose();
  });

  it("is not torn down by later roster updates, and is when its row really is gone", async () => {
    const { engine, push } = guestEngine({ "guestCalls:roster": serverRoster() });
    await engine.attachToCall(CALL_ID);
    push("guestCalls:roster", serverRoster({ transcribing: true, transcriptionSessionId: "t1" }));
    expect(engine.isActive()).toBe(true);
    expect(engine.getSnapshot().call?.transcribing).toBe(true);

    // A roster without the guest (removed): leave the call locally.
    const withoutSelf = serverRoster();
    push("guestCalls:roster", {
      ...withoutSelf,
      participants: withoutSelf.participants.filter(
        (participant) => participant.participantKey !== GUEST_SESSION_ID,
      ),
    });
    expect(engine.isActive()).toBe(false);
    engine.dispose();
  });

  it("would tear down on a roster whose self row uses another key (the old shape)", async () => {
    // The regression this guards: a guest row keyed by a per-call random key, not the
    // session id the engine was told it is. The engine cannot find itself and leaves.
    const roster = serverRoster();
    const { engine } = guestEngine({
      "guestCalls:roster": {
        ...roster,
        participants: roster.participants.map((participant) =>
          participant.participantKey === GUEST_SESSION_ID
            ? { ...participant, participantKey: "gk_a_different_key" }
            : participant,
        ),
      },
    });
    await engine.attachToCall(CALL_ID);
    expect(engine.isActive()).toBe(false);
    engine.dispose();
  });

  it("treats a failed roster read (call over, session gone) as the end of the call", async () => {
    const { engine } = guestEngine({ "guestCalls:roster": new Error("This call has ended") });
    await engine.attachToCall(CALL_ID);
    expect(engine.isActive()).toBe(false);
    engine.dispose();
  });

  it("draws the guest's own tile as 'you' with a Guest badge, and others by their names", () => {
    const view = rosterToCallView(serverRoster());
    const self = view.participants.filter((participant) => participant.userId === GUEST_SESSION_ID);
    expect(self).toHaveLength(1);
    expect(self[0]?.isGuest).toBe(true);
    render(
      <CallGrid
        participants={view.participants as readonly CallParticipantView[]}
        streams={new Map()}
        localUserId={GUEST_SESSION_ID}
        localVideoTrack={null}
        settings={DEFAULT_VOICE_SETTINGS}
        identity={{ nameOf: () => "Member" }}
      />,
    );
    expect(screen.getByText("Alex (you)")).toBeInTheDocument();
    expect(screen.getByText("Kim")).toBeInTheDocument();
    expect(screen.getByText("Member")).toBeInTheDocument();
    expect(screen.getAllByText("Guest")).toHaveLength(2);
    expect(screen.queryByText("Kim (you)")).toBeNull();
  });
});

describe("signalling keys match the roster the grid uses", () => {
  it("maps a member's signal to that member's roster key, addressed to the guest", async () => {
    recorded.signals.length = 0;
    const { engine, push } = guestEngine({
      "guestCalls:roster": serverRoster(),
      "guestCalls:signals": [],
    });
    await engine.attachToCall(CALL_ID);
    push("guestCalls:signals", [
      serverSignal(),
      serverSignal({ id: "js7signal000000000000000000000002", fromParticipantKey: OTHER_GUEST_ID }),
    ]);
    expect(recorded.signals).toHaveLength(2);
    const keys = new Set(rosterToCallView(serverRoster()).participants.map((p) => p.userId));
    for (const signal of recorded.signals) {
      expect(keys.has(signal.fromUserId)).toBe(true);
      expect(signal.toUserId).toBe(GUEST_SESSION_ID);
    }
    expect(recorded.signals[0]?.fromUserId).toBe(MEMBER_KEY);
    engine.dispose();
  });
});

describe("guest page happy path (preview -> request -> waiting -> admitted -> in call)", () => {
  it("walks the state machine with server-shaped data and finds itself in the call", async () => {
    // 1. Link opens: the page reads the token from the fragment, the server previews it.
    const token = parseGuestFragment(
      new URL(guestLinkUrl("https://chat.example.com", LINK_TOKEN)).hash,
    );
    expect(token).toBe(LINK_TOKEN);
    const preview = { title: "Guest call", open: true, startsAt: null, opensAt: null };
    expect(previewNotice(preview, Date.now())).toEqual({ kind: "open" });
    expect(
      screenFor({
        resolving: false,
        linkOk: true,
        hasSession: false,
        lobby: undefined,
        callEnded: false,
      }),
    ).toBe("form");

    // 2. The form's limits are the server's.
    expect(GUEST_NAME_MAX).toBe(40);
    expect(GUEST_AFFILIATION_MAX).toBe(60);

    // 3. requestJoin returns a session token the page keeps; the lobby says pending.
    const requested = {
      sessionToken: SESSION_TOKEN,
      guestSessionId: GUEST_SESSION_ID,
      status: "pending" as const,
      expiresAt: Date.now() + 600_000,
      callId: CALL_ID,
    };
    expect(isWellFormedGuestToken(requested.sessionToken, GUEST_SESSION_TOKEN_PREFIX)).toBe(true);
    const lobby = (status: LobbyStatus) => ({
      guestSessionId: GUEST_SESSION_ID,
      status,
      displayName: "Alex",
      affiliation: "Acme" as string | null,
      callId: CALL_ID as string | null,
      expiresAt: requested.expiresAt,
    });
    const screenOf = (status: LobbyStatus | undefined, wasAdmitted = false) =>
      screenFor({
        resolving: false,
        linkOk: true,
        hasSession: true,
        lobby: status,
        callEnded: false,
        wasAdmitted,
      });

    expect(screenOf(undefined)).toBe("loading");
    expect(screenOf(lobby("pending").status)).toBe("waiting");

    // 4. A member admits: the lobby flips and the guest's seat key is its own session id.
    const admitted = lobby("admitted");
    expect(screenOf(admitted.status)).toBe("in-call");
    expect(admitted.callId).not.toBeNull();
    const selfKey = admitted.guestSessionId;

    // 5. The call engine, keyed by that id, finds the guest's row in the server roster.
    const { engine } = guestEngine({ "guestCalls:roster": serverRoster() }, { selfKey });
    await engine.attachToCall(admitted.callId as string);
    expect(engine.isActive()).toBe(true);
    const row = engine.getSnapshot().call?.participants.find((p) => p.userId === selfKey);
    expect(row).toMatchObject({ isGuest: true, displayName: "Alex" });

    // 6. The session later lapses (past its cap): the guest is told it ended for them.
    expect(screenOf("expired", true)).toBe("ended");
    engine.dispose();
  });
});

describe("useGuestEngine reports when the call is over for the guest", () => {
  function mount(values: Record<string, unknown>) {
    const { client, push } = fakeClient(values);
    const onEnded = vi.fn();
    const hook = renderHook(() =>
      useGuestEngine({
        client: client as never,
        convexUrl: "https://convex.example.com",
        sessionToken: SESSION_TOKEN,
        selfKey: GUEST_SESSION_ID,
        callId: CALL_ID,
        choices: DEFAULT_GUEST_CHOICES,
        iceServers: [],
        onEnded,
      }),
    );
    return { onEnded, push, hook };
  }

  it("stays quiet while the guest is in the call", async () => {
    const { onEnded, hook } = mount({ "guestCalls:roster": serverRoster() });
    await waitFor(() => {
      expect(hook.result.current?.snapshot.call).not.toBeNull();
    });
    expect(onEnded).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("reports an ended call instead of leaving the page on 'Joining'", async () => {
    const { onEnded, hook } = mount({
      "guestCalls:roster": new Error("This call has ended"),
    });
    await waitFor(() => {
      expect(onEnded).toHaveBeenCalled();
    });
    hook.unmount();
  });

  it("reports it when the guest's seat disappears from a later roster", async () => {
    const { onEnded, push, hook } = mount({ "guestCalls:roster": serverRoster() });
    await waitFor(() => {
      expect(hook.result.current?.snapshot.call).not.toBeNull();
    });
    const roster = serverRoster();
    act(() => {
      push("guestCalls:roster", {
        ...roster,
        participants: roster.participants.filter((p) => p.participantKey !== GUEST_SESSION_ID),
      });
    });
    await waitFor(() => {
      expect(onEnded).toHaveBeenCalled();
    });
    hook.unmount();
  });
});
