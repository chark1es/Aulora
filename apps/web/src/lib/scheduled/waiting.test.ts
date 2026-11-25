import { describe, expect, it } from "vitest";
import { type MyWaiting, rowMode, waitingReady } from "./waiting";

const NOW = Date.UTC(2026, 10, 9, 15, 0);
const HOUR = 3_600_000;

const call = {
  status: "scheduled" as const,
  startsAt: NOW + 2 * HOUR,
  openLeadMinutes: 5,
  canJoin: true,
};

function waiting(overrides: Partial<MyWaiting>): MyWaiting {
  return {
    id: "w",
    scheduledCallId: "c",
    title: "T",
    kind: "early",
    state: "waiting",
    callStatus: "scheduled",
    opensAt: NOW + 2 * HOUR - 5 * 60_000,
    startsAt: NOW + 2 * HOUR,
    expiresAt: NOW + 3 * HOUR,
    ...overrides,
  };
}

describe("waitingReady", () => {
  it("is ready for an admitted row, and for an early arrival once the call opens", () => {
    expect(waitingReady(waiting({ state: "admitted", kind: "knock" }), NOW)).toBe(true);
    expect(waitingReady(waiting({}), NOW)).toBe(false);
    expect(waitingReady(waiting({}), NOW + 2 * HOUR)).toBe(true);
    expect(waitingReady(waiting({ callStatus: "open" }), NOW)).toBe(true);
  });

  it("never auto-joins a knocker or a declined member", () => {
    expect(waitingReady(waiting({ kind: "knock", callStatus: "open" }), NOW + 3 * HOUR)).toBe(
      false,
    );
    expect(waitingReady(waiting({ state: "declined" }), NOW + 3 * HOUR)).toBe(false);
  });
});

describe("rowMode", () => {
  it("keeps the plain disabled Join on a server without the waiting room", () => {
    expect(rowMode(call, undefined, NOW).kind).toBe("not-open");
  });

  it("offers waiting to an invited member and Join early to an administrator", () => {
    expect(rowMode({ ...call, invited: true }, undefined, NOW).kind).toBe("wait");
    expect(rowMode({ ...call, invited: true, canJoinEarly: true }, undefined, NOW).kind).toBe(
      "join-early",
    );
  });

  it("offers Ask to join on an invite-only call the viewer is not on", () => {
    const open = { ...call, status: "open" as const, inviteOnly: true, invited: false };
    expect(rowMode(open, undefined, NOW).kind).toBe("ask");
    expect(rowMode(open, waiting({ kind: "knock" }), NOW).kind).toBe("waiting");
    expect(rowMode(open, waiting({ kind: "knock", state: "declined" }), NOW).kind).toBe("declined");
    expect(rowMode(open, waiting({ kind: "knock", state: "admitted" }), NOW)).toEqual({
      kind: "join",
      ready: true,
    });
  });

  it("closes cancelled and ended calls", () => {
    expect(rowMode({ ...call, status: "cancelled" }, undefined, NOW).kind).toBe("closed");
    expect(rowMode({ ...call, status: "ended" }, waiting({}), NOW).kind).toBe("closed");
  });
});
