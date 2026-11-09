import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { newTest, seedChannel, seedWorkspace, type Test } from "./helpers";

/**
 * The solo-call auto-disconnect. The backend owns the timer: a call with
 * exactly one distinct user gets an `aloneSince`/`aloneDeadline` pair and a
 * scheduled enforcement, which re-validates the roster before disconnecting.
 */

/** Matches the default `AULORA_CALL_ALONE_TIMEOUT_SECONDS`. */
const ALONE_MS = 300_000;
/** A little past the deadline: Convex rounds a transaction clock up to the next ms. */
const PAST_DEADLINE_MS = ALONE_MS + 2_000;

async function seed(options: Parameters<typeof seedWorkspace>[1] = {}) {
  const t = newTest();
  await seedWorkspace(t, options);
  return t;
}

async function startVoiceCall(
  t: Test,
  channelId: Id<"channels">,
  userId = "user-1",
  clientId = "device-a",
): Promise<Id<"calls">> {
  const { callId } = await t
    .withIdentity({ subject: userId })
    .mutation(api.calls.start, { channelId, kind: "voice", clientId });
  return callId;
}

async function join(t: Test, callId: Id<"calls">, userId: string, clientId = "device-b") {
  await t.withIdentity({ subject: userId }).mutation(api.calls.join, { callId, clientId });
}

async function leave(t: Test, callId: Id<"calls">, userId: string, clientId = "device-b") {
  await t.withIdentity({ subject: userId }).mutation(api.calls.leave, { callId, clientId });
}

async function callRow(t: Test, callId: Id<"calls">) {
  return await t.run(async (ctx) => await ctx.db.get(callId));
}

async function seats(t: Test, callId: Id<"calls">) {
  const rows = await t.run(async (ctx) => await ctx.db.query("callParticipants").collect());
  return rows.filter((row) => row.callId === callId);
}

/** Advances the fake clock, then lets the scheduled function it fired settle. */
async function advance(t: Test, ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await t.finishInProgressScheduledFunctions();
}

interface ScheduledFunctionRow {
  readonly args?: readonly { readonly callId?: string }[];
  readonly state?: { readonly kind?: string };
}

/**
 * The call's pending enforcement jobs in the `_scheduled_functions` system
 * table, so a test can assert re-arming leaves exactly one job behind.
 */
async function pendingAloneJobs(t: Test, callId: Id<"calls">): Promise<ScheduledFunctionRow[]> {
  const rows = await t.run(async (ctx) => {
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();
    return jobs satisfies ScheduledFunctionRow[];
  });
  return rows.filter((row) => row.state?.kind === "pending" && row.args?.[0]?.callId === callId);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("solo call timeout", () => {
  it("disconnects a participant who is alone for five minutes", async () => {
    vi.useFakeTimers();
    const t = await seed({ members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const callId = await startVoiceCall(t, channelId);

    const armed = await callRow(t, callId);
    expect(armed?.aloneSince).toBeTypeOf("number");
    expect(armed?.aloneDeadline).toBe((armed?.aloneSince ?? 0) + ALONE_MS);

    await advance(t, ALONE_MS - 1_000);
    expect((await callRow(t, callId))?.status).toBe("active");

    await advance(t, 2_000);
    const ended = await callRow(t, callId);
    expect(ended?.status).toBe("ended");
    expect(ended?.endedReason).toBe("alone");
    // Kept briefly so the client notice can name the configured duration.
    expect((ended?.aloneDeadline ?? 0) - (ended?.aloneSince ?? 0)).toBe(300_000);
    expect(await seats(t, callId)).toHaveLength(0);
  });

  it("clears the window when someone joins at 4:59 and restarts it when they leave", async () => {
    vi.useFakeTimers();
    const t = await seed({ members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const callId = await startVoiceCall(t, channelId);

    await advance(t, ALONE_MS - 2_000);
    await join(t, callId, "user-2");
    // The already-scheduled job fires at the old deadline and must no-op.
    await advance(t, 2_000);

    let call = await callRow(t, callId);
    expect(call?.status).toBe("active");
    expect(call?.aloneSince).toBeUndefined();
    expect(call?.aloneDeadline).toBeUndefined();

    await leave(t, callId, "user-2");
    call = await callRow(t, callId);
    expect(call?.aloneSince).toBeTypeOf("number");

    await advance(t, ALONE_MS - 1_000);
    expect((await callRow(t, callId))?.status).toBe("active");

    await advance(t, 2_000);
    call = await callRow(t, callId);
    expect(call?.status).toBe("ended");
    expect(call?.endedReason).toBe("alone");
  });

  it("counts two devices of the same user as one participant", async () => {
    vi.useFakeTimers();
    const t = await seed({ members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const callId = await startVoiceCall(t, channelId, "user-1", "device-a");

    await t.withIdentity({ subject: "user-1" }).mutation(api.calls.join, {
      callId,
      clientId: "device-b",
      takeover: true,
    });
    expect(await seats(t, callId)).toHaveLength(1);
    expect((await callRow(t, callId))?.aloneSince).toBeTypeOf("number");

    await advance(t, PAST_DEADLINE_MS);
    expect((await callRow(t, callId))?.endedReason).toBe("alone");
  });

  it("does not treat a call with a bot or other user as solo", async () => {
    vi.useFakeTimers();
    const t = await seed({
      members: [{ userId: "user-1" }, { userId: "bot-1" }],
    });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const callId = await startVoiceCall(t, channelId);
    // Bots have no separate call-participant kind in this product; a bot that
    // holds a real seat participates like anyone else.
    await join(t, callId, "bot-1", "bot-device");

    expect((await callRow(t, callId))?.aloneSince).toBeUndefined();
    await advance(t, ALONE_MS * 2);
    expect((await callRow(t, callId))?.status).toBe("active");
  });

  it("never arms a timer for a call with two people", async () => {
    vi.useFakeTimers();
    const t = await seed({ members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const callId = await startVoiceCall(t, channelId);
    await join(t, callId, "user-2");

    expect((await callRow(t, callId))?.aloneSince).toBeUndefined();
    await advance(t, ALONE_MS * 2);
    expect((await callRow(t, callId))?.status).toBe("active");
    expect(await seats(t, callId)).toHaveLength(2);
  });

  it("starts the window when a stale seat is reclaimed, not at its last heartbeat", async () => {
    vi.useFakeTimers();
    const t = await seed({ members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const callId = await startVoiceCall(t, channelId);
    await join(t, callId, "user-2");
    // The second person has been offline for two minutes: still seated until
    // the sweep reclaims the seat, so the caller is not solo yet.
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("callParticipants").collect()).find(
        (entry) => entry.callId === callId && entry.userId === "user-2",
      );
      if (row !== undefined) {
        await ctx.db.patch(row._id, { lastSeen: Date.now() - 120_000 });
      }
    });
    await advance(t, 30_000);
    await t.mutation(internal.calls.sweep, {});

    const reclaimed = await callRow(t, callId);
    // Grace: the five minutes start when the seat is actually reclaimed.
    expect(reclaimed?.aloneSince).toBeTypeOf("number");
    expect(reclaimed?.aloneDeadline).toBe((reclaimed?.aloneSince ?? 0) + ALONE_MS);
    expect(reclaimed?.aloneSince).toBeGreaterThanOrEqual(Date.now() - 1_000);
    expect(reclaimed?.status).toBe("active");

    // A reconnect inside the window clears it without a disconnect.
    await join(t, callId, "user-2");
    await advance(t, ALONE_MS);
    expect((await callRow(t, callId))?.status).toBe("active");
  });

  it("resets the window when the person chooses to stay", async () => {
    vi.useFakeTimers();
    const t = await seed({ members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const callId = await startVoiceCall(t, channelId);
    const firstDeadline = (await callRow(t, callId))?.aloneDeadline;

    await advance(t, 4 * 60_000);
    await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.stay, { callId, clientId: "device-a" });
    const reset = await callRow(t, callId);
    expect(reset?.aloneDeadline).toBeGreaterThan(firstDeadline ?? 0);

    // The old job fires, sees the moved deadline, and waits for the new one.
    await advance(t, 60_000);
    expect((await callRow(t, callId))?.status).toBe("active");

    await advance(t, 4 * 60_000);
    const ended = await callRow(t, callId);
    expect(ended?.status).toBe("ended");
    expect(ended?.endedReason).toBe("alone");
  });

  it("ignores Stay when the caller no longer holds the seat", async () => {
    const t = await seed({ members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const callId = await startVoiceCall(t, channelId, "user-1", "device-a");
    await t.withIdentity({ subject: "user-1" }).mutation(api.calls.join, {
      callId,
      clientId: "device-b",
      takeover: true,
    });

    await expect(
      t.withIdentity({ subject: "user-1" }).mutation(api.calls.stay, {
        callId,
        clientId: "device-a",
      }),
    ).rejects.toThrow(/not in this call/);
  });

  it("is a no-op when the scheduled job fires after someone joined", async () => {
    const t = await seed({ members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const callId = await startVoiceCall(t, channelId);
    await join(t, callId, "user-2");

    await t.mutation(internal.calls.enforceAlone, { callId });
    const call = await callRow(t, callId);
    expect(call?.status).toBe("active");
    expect(call?.aloneSince).toBeUndefined();
  });

  it("waits for a deadline that is still in the future", async () => {
    const t = await seed({ members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const callId = await startVoiceCall(t, channelId);
    const deadline = Date.now() + 60_000;
    const armed = await callRow(t, callId);
    await t.run(async (ctx) => {
      // Simulate a window whose job was lost: cancel it, keep the deadline.
      if (armed?.aloneJobId !== undefined) {
        await ctx.scheduler.cancel(armed.aloneJobId);
      }
      await ctx.db.patch(callId, { aloneDeadline: deadline, aloneJobId: undefined });
    });

    await t.mutation(internal.calls.enforceAlone, { callId, deadline });
    expect((await callRow(t, callId))?.status).toBe("active");
    expect(await pendingAloneJobs(t, callId)).toHaveLength(1);
  });

  it("lets a job from an older deadline exit without rescheduling", async () => {
    vi.useFakeTimers();
    const t = await seed({ members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const callId = await startVoiceCall(t, channelId);
    const armed = await callRow(t, callId);
    expect(await pendingAloneJobs(t, callId)).toHaveLength(1);

    await t.mutation(internal.calls.enforceAlone, {
      callId,
      deadline: (armed?.aloneDeadline ?? 0) - 1_000,
    });

    const call = await callRow(t, callId);
    expect(call?.status).toBe("active");
    expect(call?.aloneDeadline).toBe(armed?.aloneDeadline);
    // The stale job must not add a second pending enforcement.
    expect(await pendingAloneJobs(t, callId)).toHaveLength(1);

    // The tracked job still ends the call at the real deadline.
    await advance(t, PAST_DEADLINE_MS);
    expect((await callRow(t, callId))?.endedReason).toBe("alone");
  });

  it("leaves a newer tracked job untouched when a legacy deadline-less job fires", async () => {
    vi.useFakeTimers();
    const t = await seed({ members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const callId = await startVoiceCall(t, channelId);
    const armed = await callRow(t, callId);
    expect(armed?.aloneJobId).toBeDefined();
    expect(await pendingAloneJobs(t, callId)).toHaveLength(1);

    // A job scheduled by the previous release carries no deadline. It must not
    // clear the newer window's tracked id or schedule a replacement.
    await t.mutation(internal.calls.enforceAlone, { callId });

    const call = await callRow(t, callId);
    expect(call?.status).toBe("active");
    expect(call?.aloneJobId).toBe(armed?.aloneJobId);
    expect(await pendingAloneJobs(t, callId)).toHaveLength(1);

    // The tracked job still ends the call at the real deadline.
    await advance(t, PAST_DEADLINE_MS);
    expect((await callRow(t, callId))?.endedReason).toBe("alone");
  });

  it("keeps exactly one pending enforcement across repeated stays", async () => {
    vi.useFakeTimers();
    const t = await seed({ members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const callId = await startVoiceCall(t, channelId);
    const first = await callRow(t, callId);
    expect(await pendingAloneJobs(t, callId)).toHaveLength(1);

    for (let press = 0; press < 5; press += 1) {
      // Each press moves the deadline by 10s, past the no-op threshold.
      await advance(t, 10_000);
      await t
        .withIdentity({ subject: "user-1" })
        .mutation(api.calls.stay, { callId, clientId: "device-a" });
      expect(await pendingAloneJobs(t, callId)).toHaveLength(1);
    }

    const reset = await callRow(t, callId);
    expect(reset?.aloneDeadline).toBeGreaterThan(first?.aloneDeadline ?? 0);

    // Neither a canceled job nor the replacement may cut the final window short.
    await advance(t, 4 * 60_000);
    expect((await callRow(t, callId))?.status).toBe("active");

    await advance(t, 60_000);
    const ended = await callRow(t, callId);
    expect(ended?.status).toBe("ended");
    expect(ended?.endedReason).toBe("alone");
    expect(await pendingAloneJobs(t, callId)).toHaveLength(0);
  });

  it("ignores a stay that would barely move the deadline", async () => {
    vi.useFakeTimers();
    const t = await seed({ members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const callId = await startVoiceCall(t, channelId);
    const armed = await callRow(t, callId);

    for (let press = 0; press < 5; press += 1) {
      await t
        .withIdentity({ subject: "user-1" })
        .mutation(api.calls.stay, { callId, clientId: "device-a" });
    }

    const call = await callRow(t, callId);
    expect(call?.aloneDeadline).toBe(armed?.aloneDeadline);
    expect(await pendingAloneJobs(t, callId)).toHaveLength(1);
  });

  it("rate-limits repeated stays per participant", async () => {
    vi.useFakeTimers();
    const t = await seed({ members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const callId = await startVoiceCall(t, channelId);

    for (let press = 0; press < 12; press += 1) {
      // 4s per press keeps all 12 inside one minute while moving the deadline.
      await advance(t, 4_000);
      await t
        .withIdentity({ subject: "user-1" })
        .mutation(api.calls.stay, { callId, clientId: "device-a" });
    }

    await advance(t, 4_000);
    await expect(
      t
        .withIdentity({ subject: "user-1" })
        .mutation(api.calls.stay, { callId, clientId: "device-a" }),
    ).rejects.toThrow(/Rate limit exceeded/);
  });

  it("keeps the retained window after a late leave and a duplicate enforcement", async () => {
    vi.useFakeTimers();
    const t = await seed({ members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const callId = await startVoiceCall(t, channelId);

    // A Stay moves the window, then the re-armed deadline still ends the call.
    await advance(t, 10_000);
    await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.stay, { callId, clientId: "device-a" });
    await advance(t, PAST_DEADLINE_MS);

    const ended = await callRow(t, callId);
    expect(ended?.status).toBe("ended");
    expect(ended?.endedReason).toBe("alone");
    const keptSince = ended?.aloneSince;
    const keptDeadline = ended?.aloneDeadline;
    expect(keptSince).toBeTypeOf("number");
    expect(keptDeadline).toBe((keptSince ?? 0) + ALONE_MS);

    // A client that was slow to leave still holds the ended call id.
    await leave(t, callId, "user-1", "device-a");
    await t.mutation(internal.calls.enforceAlone, { callId, deadline: keptDeadline });

    const call = await callRow(t, callId);
    expect(call?.aloneSince).toBe(keptSince);
    expect(call?.aloneDeadline).toBe(keptDeadline);

    // The client notice still reports the configured duration after both.
    const summary = await t.withIdentity({ subject: "user-1" }).query(api.calls.get, { callId });
    expect(summary?.aloneTimeoutSeconds).toBe(300);
  });

  it("arms a solo call that predates the stored window", async () => {
    const t = await seed({ members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const callId = await t.run(async (ctx) => {
      const now = Date.now();
      const id = await ctx.db.insert("calls", {
        channelId,
        kind: "voice",
        initiatorId: "user-1",
        status: "active",
        ringingUserIds: [],
        startedAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("callParticipants", {
        callId: id,
        channelId,
        userId: "user-1",
        clientId: "device-a",
        session: 1,
        muted: false,
        deafened: false,
        video: false,
        sharingScreen: false,
        joinedAt: now,
        lastSeen: now,
      });
      return id;
    });

    await t.mutation(internal.calls.sweep, {});
    expect((await callRow(t, callId))?.aloneSince).toBeTypeOf("number");

    await t.run(async (ctx) => {
      await ctx.db.patch(callId, { aloneDeadline: Date.now() - 1 });
    });
    await t.mutation(internal.calls.sweep, {});
    expect((await callRow(t, callId))?.endedReason).toBe("alone");
  });
});
