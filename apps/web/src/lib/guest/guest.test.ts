import { GUEST_LINK_GENERIC_ERROR } from "@aulora/core";
import { describe, expect, it, vi } from "vitest";
import { isGuestCallPath, parseGuestFragment, strippedLocation } from "./fragment";
import { guestVoicePort, rosterToCallView, signalsToRows } from "./guest-voice";
import { classifyJoinFailure, previewNotice, screenFor } from "./page-state";
import {
  clearGuestSession,
  readGuestSession,
  type StorageLike,
  writeGuestSession,
} from "./session-store";

// The exact shape the server mints: `agu_` + 32 random bytes as 64 hex chars.
const TOKEN = `agu_${"0123456789abcdef".repeat(4)}`;

describe("parseGuestFragment", () => {
  it("accepts exactly one well-formed token, with or without the hash", () => {
    expect(parseGuestFragment(`#${TOKEN}`)).toBe(TOKEN);
    expect(parseGuestFragment(TOKEN)).toBe(TOKEN);
    expect(parseGuestFragment(`#agu_${"-_9zZ".repeat(8)}abc`)).not.toBeNull();
  });

  it("rejects anything else so nothing odd reaches the server", () => {
    for (const bad of [
      "",
      "#",
      "#agu_short",
      `#agu_${"a".repeat(31)}`,
      `#agu_${"a".repeat(129)}`,
      `#ags_${"a".repeat(64)}`,
      `#agu_${"a".repeat(63)}!`,
      `#${TOKEN}&x=1`,
      `# ${TOKEN}`,
      `#<script>`,
    ]) {
      expect(parseGuestFragment(bad)).toBeNull();
    }
  });
});

describe("guest path and history", () => {
  it("recognises the guest page", () => {
    expect(isGuestCallPath("/call/guest")).toBe(true);
    expect(isGuestCallPath("/call/guest/")).toBe(true);
    expect(isGuestCallPath("/call/guests")).toBe(false);
    expect(isGuestCallPath("/")).toBe(false);
  });

  it("leaves only the path and query in the address bar", () => {
    expect(strippedLocation({ pathname: "/call/guest", search: "?a=1" })).toBe("/call/guest?a=1");
    expect(strippedLocation({ pathname: "/call/guest", search: "" })).toBe("/call/guest");
  });
});

describe("classifyJoinFailure", () => {
  it("collapses every bad link to one outcome and keeps the not-open times", () => {
    expect(classifyJoinFailure(new Error(GUEST_LINK_GENERIC_ERROR))).toEqual({
      kind: "unavailable",
    });
    expect(
      classifyJoinFailure({
        data: { code: "ScheduledCallNotOpen", message: "x", startsAt: 5, opensAt: 3 },
        message: "x",
      }),
    ).toEqual({ kind: "not-open", startsAt: 5, opensAt: 3 });
  });

  it("maps known join problems and shows only input-rule text", () => {
    expect(classifyJoinFailure(new Error("The call hasn't started yet"))).toEqual({
      kind: "not-started",
    });
    expect(classifyJoinFailure(new Error("Too many people are waiting to join this call"))).toEqual(
      {
        kind: "busy",
      },
    );
    expect(classifyJoinFailure(new Error("Rate limit exceeded"))).toEqual({ kind: "rate-limited" });
    expect(classifyJoinFailure(new Error("Display name must be 1–40 characters"))).toEqual({
      kind: "invalid-input",
      message: "Display name must be 1–40 characters",
    });
  });

  it("never echoes an unknown server message", () => {
    const failure = classifyJoinFailure(new Error("Internal: table callGuestSessions index broke"));
    expect(failure).toEqual({ kind: "generic" });
    expect(JSON.stringify(failure)).not.toContain("callGuestSessions");
    expect(classifyJoinFailure("boom")).toEqual({ kind: "generic" });
  });

  it("recognises a dead session", () => {});
});

describe("screenFor", () => {
  const base = {
    resolving: false,
    linkOk: true,
    hasSession: false,
    lobby: undefined,
    callEnded: false,
  } as const;
  it("walks link -> form", () => {
    expect(screenFor({ ...base, resolving: true, linkOk: null })).toBe("loading");
    expect(screenFor({ ...base, linkOk: null })).toBe("loading");
    expect(screenFor(base)).toBe("form");
    expect(screenFor({ ...base, linkOk: false })).toBe("link-unavailable");
  });

  it("follows the lobby status the server reports", () => {
    const withSession = { ...base, hasSession: true } as const;
    expect(screenFor(withSession)).toBe("loading");
    expect(screenFor({ ...withSession, lobby: "pending" })).toBe("waiting");
    expect(screenFor({ ...withSession, lobby: "admitted" })).toBe("in-call");
    expect(screenFor({ ...withSession, lobby: "admitted", callEnded: true })).toBe("ended");
    expect(screenFor({ ...withSession, lobby: "denied" })).toBe("denied");
    expect(screenFor({ ...withSession, lobby: "removed" })).toBe("removed");
    expect(screenFor({ ...withSession, lobby: "expired" })).toBe("expired");
    expect(screenFor({ ...withSession, lobby: "left" })).toBe("ended");
    expect(screenFor({ ...withSession, lobby: "gone" })).toBe("link-unavailable");
  });

  it("lets a session win over a link that has since been used up", () => {
    expect(screenFor({ ...base, linkOk: false, hasSession: true, lobby: "pending" })).toBe(
      "waiting",
    );
  });
});

describe("screenFor (expired and ended sessions)", () => {
  const base = { resolving: false, linkOk: true, hasSession: true, callEnded: false };

  it("treats an unanswered request that lapsed as expired", () => {
    expect(screenFor({ ...base, lobby: "expired" })).toBe("expired");
    expect(screenFor({ ...base, lobby: "expired", wasAdmitted: false })).toBe("expired");
  });

  it("treats an admitted session that lapsed past its cap as ended for the guest", () => {
    expect(screenFor({ ...base, lobby: "expired", wasAdmitted: true })).toBe("ended");
  });

  it("ends an admitted guest when the call goes away under them", () => {
    expect(screenFor({ ...base, lobby: "admitted", callEnded: true })).toBe("ended");
    expect(screenFor({ ...base, lobby: "left" })).toBe("ended");
  });

  it("never waits on a dead call: the server's `left` for a pending guest is the ended screen", () => {
    expect(screenFor({ ...base, lobby: "pending" })).toBe("waiting");
    expect(screenFor({ ...base, lobby: "left", wasAdmitted: false })).toBe("ended");
    expect(screenFor({ ...base, lobby: "left", wasAdmitted: true })).toBe("ended");
  });
});

describe("previewNotice", () => {
  it("says when the call opens, or that the host has not started it", () => {
    expect(previewNotice({ title: "t", open: true, startsAt: null, opensAt: null }, 0)).toEqual({
      kind: "open",
    });
    expect(previewNotice({ title: "t", open: false, startsAt: 100, opensAt: 90 }, 50)).toEqual({
      kind: "opens-later",
      startsAt: 100,
      opensAt: 90,
    });
    expect(previewNotice({ title: "t", open: false, startsAt: 100, opensAt: 90 }, 95)).toEqual({
      kind: "waiting-for-host",
    });
    expect(previewNotice({ title: "t", open: false, startsAt: null, opensAt: null }, 0)).toEqual({
      kind: "waiting-for-host",
    });
  });
});

describe("session store", () => {
  function memory(): StorageLike & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
      removeItem: (key) => {
        data.delete(key);
      },
    };
  }

  it("round-trips and clears the session token", () => {
    const storage = memory();
    expect(readGuestSession(storage)).toBeNull();
    writeGuestSession({ sessionToken: "ags_x" }, storage);
    expect(readGuestSession(storage)).toEqual({ sessionToken: "ags_x" });
    clearGuestSession(storage);
    expect(readGuestSession(storage)).toBeNull();
  });

  it("ignores corrupt data and unavailable storage", () => {
    const storage = memory();
    storage.setItem("aulora.guestSession.v1", "{nope");
    expect(readGuestSession(storage)).toBeNull();
    storage.setItem("aulora.guestSession.v1", JSON.stringify({ sessionToken: 5 }));
    expect(readGuestSession(storage)).toBeNull();
    expect(readGuestSession(null)).toBeNull();
    expect(() => {
      writeGuestSession({ sessionToken: "x" }, null);
    }).not.toThrow();
  });
});

describe("rosterToCallView", () => {
  const roster = {
    callId: "call1",
    callStatus: "active" as const,
    scheduledCallId: null,
    transcribing: true,
    transcriptionSessionId: "ts1",
    participants: [
      {
        participantKey: "k-member",
        isGuest: false,
        displayName: "Sam",
        muted: false,
        video: true,
        joinedAt: 20,
        session: 3,
      },
      {
        participantKey: "g1",
        isGuest: true,
        displayName: "Alex",
        muted: true,
        video: false,
        joinedAt: 10,
        session: 1,
      },
    ],
  };

  it("addresses everyone by their opaque key and flags guests", () => {
    const view = rosterToCallView(roster);
    expect(view.participants.map((participant) => participant.userId)).toEqual(["k-member", "g1"]);
    expect(view.participants[1]).toMatchObject({
      isGuest: true,
      displayName: "Alex",
      guestId: "g1",
    });
    expect(view.participants[0]).toMatchObject({ isGuest: false, guestId: null });
    expect(view.participants.map((participant) => participant.session)).toEqual([3, 1]);
    expect(view.channelId).toBeNull();
    expect(view.guestCount).toBe(1);
    expect(view.startedAt).toBe(10);
    expect(view.transcribing).toBe(true);
    expect(view.transcriptionSessionId).toBe("ts1");
  });

  it("never claims screen sharing, deafening or a streaming-server transport", () => {
    const view = rosterToCallView(roster);
    expect(view.screenShareUserId).toBeNull();
    for (const participant of view.participants) {
      expect(participant.sharingScreen).toBe(false);
      expect(participant.deafened).toBe(false);
      expect(participant.sfu).toBe(false);
    }
  });

  it("maps signals to rows addressed to the guest", () => {
    const rows = signalsToRows(
      [
        {
          id: "s1",
          fromParticipantKey: "k-member",
          kind: "offer",
          payload: "sdp",
          session: 3,
          createdAt: 9,
        },
      ],
      "call1",
      "g1",
    );
    expect(rows).toEqual([
      {
        id: "s1",
        callId: "call1",
        fromUserId: "k-member",
        toUserId: "g1",
        kind: "offer",
        payload: "sdp",
        createdAt: 9,
        session: 3,
      },
    ]);
  });
});

describe("guestVoicePort", () => {
  function fakeClient() {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const client = {
      mutation: vi.fn((reference: unknown, args: Record<string, unknown>) => {
        calls.push({
          name: String(Reflect.get(reference as object, Symbol.for("functionName")) ?? ""),
          args,
        });
        return Promise.resolve(null);
      }),
    };
    return { client, calls };
  }

  it("refuses everything a guest may not do, before touching the network", async () => {
    const { client } = fakeClient();
    const port = guestVoicePort(client as never, "ags_tok");
    expect(() => port.startCall({ channelId: "c", kind: "voice" })).toThrow(/Guests cannot/u);
    expect(() => port.joinCall({ callId: "c" })).toThrow(/Guests cannot/u);
    expect(() => port.endCall({ callId: "c" })).toThrow(/Guests cannot/u);
    expect(() => port.declineCall({ callId: "c" })).toThrow(/Guests cannot/u);
    expect(client.mutation).not.toHaveBeenCalled();
    expect(port.sfuAccess).toBeUndefined();
  });

  it("sends the token on every call and drops fields guests do not have", async () => {
    const { client } = fakeClient();
    const port = guestVoicePort(client as never, "ags_tok");
    await port.updateParticipant({
      callId: "c",
      muted: true,
      deafened: true,
      sharingScreen: true,
      sfu: true,
    });
    await port.updateParticipant({ callId: "c", deafened: true, sfuCall: true });
    await port.sendSignal({
      callId: "c",
      toUserId: "key-1",
      kind: "ice",
      payload: "a",
      payloads: ["a", "b"],
    });
    await port.ackSignals({ signalIds: ["s1"] });
    await port.callHeartbeat({ callId: "c" });
    const sent = client.mutation.mock.calls.map((call) => call[1] as Record<string, unknown>);
    // The second updateParticipant carried nothing a guest has, so it sent nothing.
    expect(sent).toHaveLength(4);
    expect(sent[0]).toEqual({ sessionToken: "ags_tok", muted: true });
    expect(sent[1]).toEqual({
      sessionToken: "ags_tok",
      toParticipantKey: "key-1",
      kind: "ice",
      payload: "a",
      payloads: ["a", "b"],
    });
    for (const args of sent) {
      expect(args.sessionToken).toBe("ags_tok");
    }
  });
});
