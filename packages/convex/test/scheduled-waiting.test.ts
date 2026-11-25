import { EVERYONE_ROLE_ID, Permission, SCHEDULED_WAITING_MAX_PENDING } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { EVERYONE_BASE, newTest, seedChannel, seedWorkspace, type Test } from "./helpers";

const MINUTE = 60_000;

async function patchSettings(t: Test, settings: Record<string, unknown>) {
  await t.run(async (ctx) => {
    const server = await ctx.db.query("server").first();
    if (server !== null) {
      await ctx.db.patch(server._id, { settings: { ...server.settings, ...settings } });
    }
  });
}

/**
 * user-1 / user-2 schedule calls, admin-1 is an administrator, member-a and
 * member-b are ordinary members, and a voice channel is available.
 */
async function seed() {
  const t = newTest();
  await seedWorkspace(t, {
    everyonePermissions: EVERYONE_BASE | Permission.ViewScheduledCalls,
    members: [
      { userId: "user-1", roleIds: [EVERYONE_ROLE_ID, "scheduler"] },
      { userId: "user-2", roleIds: [EVERYONE_ROLE_ID, "scheduler"] },
      { userId: "admin-1", roleIds: [EVERYONE_ROLE_ID, "admin"] },
      { userId: "member-a" },
      { userId: "member-b" },
    ],
    extraRoles: [
      { key: "scheduler", permissions: Permission.ScheduleCalls, position: 2 },
      { key: "admin", permissions: Permission.Administrator, position: 3 },
    ],
  });
  await patchSettings(t, { scheduledCallsEnabled: true });
  const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
  return { t, channelId };
}

type Seeded = Awaited<ReturnType<typeof seed>>;

function as(t: Test, userId: string) {
  return t.withIdentity({ subject: userId });
}

async function channelCall(
  { t, channelId }: Seeded,
  options: { inviteOnly?: boolean; invitees?: string[]; startsInMinutes?: number } = {},
): Promise<Id<"scheduledCalls">> {
  return await as(t, "user-2").mutation(api.scheduledCalls.create, {
    title: "Planning",
    startsAt: Date.now() + (options.startsInMinutes ?? 30) * MINUTE,
    openLeadMinutes: 5,
    channelId,
    ...(options.inviteOnly !== undefined ? { inviteOnly: options.inviteOnly } : {}),
    ...(options.invitees !== undefined ? { inviteeUserIds: options.invitees } : {}),
  });
}

/** Moves a call's window so that it is open now. */
async function openNow(t: Test, id: Id<"scheduledCalls">, durationMinutes = 60) {
  await t.run(async (ctx) => {
    await ctx.db.patch(id, {
      startsAt: Date.now() - MINUTE,
      durationMinutes,
      status: "open",
    });
  });
}

async function waitingRows(t: Test, id: Id<"scheduledCalls">) {
  return await t.run(async (ctx) => {
    const rows = await ctx.db.query("scheduledCallWaiting").take(200);
    return rows.filter((row) => row.scheduledCallId === id);
  });
}

describe("editing an open or early-joined call", () => {
  it("lets the title change after the start time has passed", async () => {
    const s = await seed();
    const id = await channelCall(s);
    await openNow(s.t, id);
    const startsAt = (await s.t.run(async (ctx) => await ctx.db.get(id)))?.startsAt;
    await as(s.t, "user-2").mutation(api.scheduledCalls.update, {
      scheduledCallId: id,
      title: "Renamed",
      startsAt: startsAt as number,
    });
    const view = await as(s.t, "user-2").query(api.scheduledCalls.get, { scheduledCallId: id });
    expect(view.title).toBe("Renamed");
    expect(view.status).toBe("open");
  });

  it("still refuses a changed start in the past and a cancelled call", async () => {
    const s = await seed();
    const id = await channelCall(s);
    await expect(
      as(s.t, "user-2").mutation(api.scheduledCalls.update, {
        scheduledCallId: id,
        startsAt: Date.now() - 10 * MINUTE,
      }),
    ).rejects.toThrow(/in the future/);
    await as(s.t, "user-2").mutation(api.scheduledCalls.cancel, { scheduledCallId: id });
    await expect(
      as(s.t, "user-2").mutation(api.scheduledCalls.update, { scheduledCallId: id, title: "No" }),
    ).rejects.toThrow(/can no longer be edited/);
  });

  it("keeps an early-joined call scheduled with its room when the time moves", async () => {
    const s = await seed();
    const id = await channelCall(s);
    const joined = await as(s.t, "admin-1").mutation(api.scheduledCalls.join, {
      scheduledCallId: id,
      clientId: "device-a",
    });
    const later = Date.now() + 90 * MINUTE;
    await as(s.t, "user-2").mutation(api.scheduledCalls.update, {
      scheduledCallId: id,
      title: "Edited while the room is live",
      startsAt: later,
    });
    const row = await s.t.run(async (ctx) => await ctx.db.get(id));
    expect(row?.status).toBe("scheduled");
    expect(row?.startsAt).toBe(Math.trunc(later));
    expect(row?.callId).toBe(joined.callId);
    expect(row?.openJobId).toBeDefined();
    const call = await s.t.run(async (ctx) => await ctx.db.get(joined.callId));
    expect(call?.status).toBe("active");
  });

  it("keeps an open call with a live room open and live when the time moves", async () => {
    const s = await seed();
    const id = await channelCall(s);
    const joined = await as(s.t, "admin-1").mutation(api.scheduledCalls.join, {
      scheduledCallId: id,
      clientId: "device-a",
    });
    await openNow(s.t, id);
    await as(s.t, "user-2").mutation(api.scheduledCalls.update, {
      scheduledCallId: id,
      startsAt: Date.now() + 120 * MINUTE,
    });
    const row = await s.t.run(async (ctx) => await ctx.db.get(id));
    expect(row?.status).toBe("open");
    expect(row?.callId).toBe(joined.callId);
    const call = await s.t.run(async (ctx) => await ctx.db.get(joined.callId));
    expect(call?.status).toBe("active");
  });

  it("returns an open call with no room to scheduled when moved into the future", async () => {
    const s = await seed();
    const id = await channelCall(s);
    await openNow(s.t, id);
    await as(s.t, "user-2").mutation(api.scheduledCalls.update, {
      scheduledCallId: id,
      startsAt: Date.now() + 60 * MINUTE,
    });
    const row = await s.t.run(async (ctx) => await ctx.db.get(id));
    expect(row?.status).toBe("scheduled");
    expect(row?.openJobId).toBeDefined();
  });
});

describe("solo-call timeout for scheduled rooms", () => {
  it("arms no timer inside the window and the normal one for a regular channel call", async () => {
    const s = await seed();
    const standalone = await as(s.t, "user-2").mutation(api.scheduledCalls.create, {
      title: "Room",
      startsAt: Date.now() + MINUTE,
      openLeadMinutes: 5,
      inviteeUserIds: ["user-1"],
    });
    const room = await as(s.t, "user-2").mutation(api.scheduledCalls.join, {
      scheduledCallId: standalone,
      clientId: "device-a",
    });
    const scheduledRow = await s.t.run(async (ctx) => await ctx.db.get(room.callId));
    expect(scheduledRow?.aloneDeadline).toBeUndefined();
    expect(scheduledRow?.aloneJobId).toBeUndefined();

    const regular = await as(s.t, "user-1").mutation(api.calls.start, {
      channelId: s.channelId,
      kind: "voice",
      clientId: "device-b",
    });
    const regularRow = await s.t.run(async (ctx) => await ctx.db.get(regular.callId));
    expect(regularRow?.aloneDeadline).toBeDefined();
  });

  it("does not end an exempt room when a stale enforcement fires, and clears the window", async () => {
    const s = await seed();
    const id = await as(s.t, "user-2").mutation(api.scheduledCalls.create, {
      title: "Room",
      startsAt: Date.now() + MINUTE,
      openLeadMinutes: 5,
      inviteeUserIds: ["user-1"],
    });
    const { callId } = await as(s.t, "user-2").mutation(api.scheduledCalls.join, {
      scheduledCallId: id,
      clientId: "device-a",
    });
    const deadline = Date.now() - 1_000;
    await s.t.run(async (ctx) => {
      await ctx.db.patch(callId, { aloneSince: deadline - 5 * MINUTE, aloneDeadline: deadline });
    });
    await s.t.mutation(internal.calls.enforceAlone, { callId, deadline });
    const call = await s.t.run(async (ctx) => await ctx.db.get(callId));
    expect(call?.status).toBe("active");
    expect(call?.aloneDeadline).toBeUndefined();
    // The 30 s sweep backstop leaves it alone too.
    await s.t.mutation(internal.calls.sweep, {});
    expect((await s.t.run(async (ctx) => await ctx.db.get(callId)))?.status).toBe("active");
  });

  it("arms the timer once the scheduled window has passed", async () => {
    const s = await seed();
    const id = await as(s.t, "user-2").mutation(api.scheduledCalls.create, {
      title: "Room",
      startsAt: Date.now() + MINUTE,
      durationMinutes: 30,
      openLeadMinutes: 5,
      inviteeUserIds: ["user-1"],
    });
    const { callId } = await as(s.t, "user-2").mutation(api.scheduledCalls.join, {
      scheduledCallId: id,
      clientId: "device-a",
    });
    await s.t.run(async (ctx) => {
      await ctx.db.patch(id, { startsAt: Date.now() - 2 * 60 * MINUTE, status: "open" });
    });
    await s.t.mutation(internal.calls.sweep, {});
    const call = await s.t.run(async (ctx) => await ctx.db.get(callId));
    expect(call?.aloneDeadline).toBeDefined();
  });

  it("flips an early-joined room open at its open time so the sweep can end it", async () => {
    const s = await seed();
    const id = await channelCall(s);
    const { callId } = await as(s.t, "admin-1").mutation(api.scheduledCalls.join, {
      scheduledCallId: id,
      clientId: "device-a",
    });
    await s.t.run(async (ctx) => {
      await ctx.db.patch(id, { startsAt: Date.now() + MINUTE, durationMinutes: 5 });
    });
    await s.t.mutation(internal.scheduledCalls.openOne, { scheduledCallId: id });
    expect((await s.t.run(async (ctx) => await ctx.db.get(id)))?.status).toBe("open");
    await s.t.run(async (ctx) => {
      await ctx.db.patch(id, { startsAt: Date.now() - 10 * MINUTE });
    });
    await s.t.mutation(internal.scheduledCalls.sweep, {});
    expect((await s.t.run(async (ctx) => await ctx.db.get(id)))?.status).toBe("ended");
    expect((await s.t.run(async (ctx) => await ctx.db.get(callId)))?.status).toBe("ended");
  });
});

describe("invite-only channel calls", () => {
  it("refuses an uninvited member on every join path, and admits the allowed", async () => {
    const s = await seed();
    const id = await channelCall(s, { inviteOnly: true, invitees: ["member-a"] });
    await openNow(s.t, id);
    const room = await as(s.t, "member-a").mutation(api.scheduledCalls.join, {
      scheduledCallId: id,
      clientId: "device-a",
    });
    await expect(
      as(s.t, "member-b").mutation(api.scheduledCalls.join, {
        scheduledCallId: id,
        clientId: "device-b",
      }),
    ).rejects.toThrow(/invite-only/);
    await expect(
      as(s.t, "member-b").mutation(api.calls.join, { callId: room.callId, clientId: "device-b" }),
    ).rejects.toThrow(/invite-only/);
    await expect(
      as(s.t, "member-b").mutation(api.calls.start, {
        channelId: s.channelId,
        kind: "voice",
        clientId: "device-b",
      }),
    ).rejects.toThrow(/invite-only/);
    // Creator and administrator are allowed without being listed.
    await as(s.t, "user-2").mutation(api.calls.join, { callId: room.callId, clientId: "device-c" });
    await as(s.t, "admin-1").mutation(api.calls.start, {
      channelId: s.channelId,
      kind: "voice",
      clientId: "device-d",
    });
    const call = await s.t.run(async (ctx) => await ctx.db.get(room.callId));
    expect(call?.scheduledCallId).toBe(id);
    const view = await as(s.t, "member-b").query(api.scheduledCalls.get, { scheduledCallId: id });
    expect(view.inviteOnly).toBe(true);
    expect(view.invited).toBe(false);
  });

  it("allows an empty list: only the creator and administrators get in", async () => {
    const s = await seed();
    const id = await channelCall(s, { inviteOnly: true });
    await openNow(s.t, id);
    await expect(
      as(s.t, "member-a").mutation(api.scheduledCalls.join, {
        scheduledCallId: id,
        clientId: "device-a",
      }),
    ).rejects.toThrow(/invite-only/);
    await as(s.t, "user-2").mutation(api.scheduledCalls.join, {
      scheduledCallId: id,
      clientId: "device-b",
    });
  });

  it("drops uninvited members from an ad-hoc room an invite-only meeting claims", async () => {
    const s = await seed();
    const id = await channelCall(s, { inviteOnly: true, invitees: ["member-b"] });
    const adHoc = await as(s.t, "member-a").mutation(api.calls.start, {
      channelId: s.channelId,
      kind: "voice",
      clientId: "device-a",
    });
    await as(s.t, "member-b").mutation(api.calls.join, {
      callId: adHoc.callId,
      clientId: "device-b",
    });
    await openNow(s.t, id);
    const joined = await as(s.t, "user-2").mutation(api.scheduledCalls.join, {
      scheduledCallId: id,
      clientId: "device-c",
    });
    expect(joined.callId).toBe(adHoc.callId);
    const seated = await s.t.run(async (ctx) =>
      (await ctx.db.query("callParticipants").take(50))
        .filter((row) => row.callId === adHoc.callId)
        .map((row) => row.userId),
    );
    expect(seated.sort()).toEqual(["member-b", "user-2"]);
  });

  it("keeps a plain channel call open to every member and drops invitees", async () => {
    const s = await seed();
    const id = await channelCall(s, { invitees: ["member-a"] });
    await openNow(s.t, id);
    await as(s.t, "member-b").mutation(api.scheduledCalls.join, {
      scheduledCallId: id,
      clientId: "device-a",
    });
    const view = await as(s.t, "member-b").query(api.scheduledCalls.get, { scheduledCallId: id });
    expect(view.inviteOnly).toBe(false);
    expect(view.invited).toBe(true);
    expect(view.inviteeUserIds).toEqual([]);
  });

  it("keeps the stored setting when an older client omits it, and can switch it off", async () => {
    const s = await seed();
    const id = await channelCall(s, { inviteOnly: true, invitees: ["member-a"] });
    await as(s.t, "user-2").mutation(api.scheduledCalls.update, {
      scheduledCallId: id,
      title: "Older client edit",
    });
    let view = await as(s.t, "user-2").query(api.scheduledCalls.get, { scheduledCallId: id });
    expect(view.inviteOnly).toBe(true);
    expect(view.inviteeUserIds).toEqual(["member-a"]);
    await as(s.t, "user-2").mutation(api.scheduledCalls.update, {
      scheduledCallId: id,
      inviteOnly: false,
    });
    view = await as(s.t, "user-2").query(api.scheduledCalls.get, { scheduledCallId: id });
    expect(view.inviteOnly).toBe(false);
    expect(view.inviteeUserIds).toEqual([]);
  });

  it("lets an administrator into a standalone room they are not invited to", async () => {
    const s = await seed();
    const id = await as(s.t, "user-2").mutation(api.scheduledCalls.create, {
      title: "Private",
      startsAt: Date.now() + MINUTE,
      openLeadMinutes: 5,
      inviteeUserIds: ["user-1"],
    });
    await as(s.t, "admin-1").mutation(api.scheduledCalls.join, {
      scheduledCallId: id,
      clientId: "device-a",
    });
    await expect(
      as(s.t, "member-a").mutation(api.scheduledCalls.join, {
        scheduledCallId: id,
        clientId: "device-b",
      }),
    ).rejects.toThrow(/not invited/);
  });
});

describe("closing the early calls.start bypass", () => {
  it("refuses a member reusing an early-joined scheduled room before it opens", async () => {
    const s = await seed();
    const id = await channelCall(s);
    await as(s.t, "admin-1").mutation(api.scheduledCalls.join, {
      scheduledCallId: id,
      clientId: "device-a",
    });
    const error = await as(s.t, "member-a")
      .mutation(api.calls.start, {
        channelId: s.channelId,
        kind: "voice",
        clientId: "device-b",
      })
      .then(
        () => null,
        (cause: { data?: { code?: string } }) => cause,
      );
    // The refusal keeps the typed payload for the client.
    expect(error?.data?.code).toBe("ScheduledCallNotOpen");
    // Once the call opens the same request is a normal join.
    await openNow(s.t, id);
    const joined = await as(s.t, "member-a").mutation(api.calls.start, {
      channelId: s.channelId,
      kind: "voice",
      clientId: "device-b",
    });
    expect(joined.created).toBe(false);
  });
});

describe("member waiting room", () => {
  it("lets an invited member wait for the open time and join afterwards", async () => {
    const s = await seed();
    const id = await channelCall(s, { inviteOnly: true, invitees: ["member-a"] });
    const entered = await as(s.t, "member-a").mutation(api.scheduledCalls.enter, {
      scheduledCallId: id,
    });
    expect(entered).toMatchObject({ state: "waiting", kind: "early" });
    const mine = await as(s.t, "member-a").query(api.scheduledCalls.mine, {});
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: "early", state: "waiting", title: "Planning" });
    await expect(
      as(s.t, "member-a").mutation(api.scheduledCalls.join, {
        scheduledCallId: id,
        clientId: "device-a",
      }),
    ).rejects.toThrow(/hasn't started yet/);
    // The call opens: the member is let in automatically, and the row goes away.
    await openNow(s.t, id);
    expect(
      await as(s.t, "member-a").mutation(api.scheduledCalls.enter, { scheduledCallId: id }),
    ).toEqual({ state: "join" });
    await as(s.t, "member-a").mutation(api.scheduledCalls.join, {
      scheduledCallId: id,
      clientId: "device-a",
    });
    expect(await waitingRows(s.t, id)).toHaveLength(0);
  });

  it("lets a host let an early arrival in now, and everyone at once", async () => {
    const s = await seed();
    const id = await channelCall(s, { inviteOnly: true, invitees: ["member-a", "member-b"] });
    await as(s.t, "member-a").mutation(api.scheduledCalls.enter, { scheduledCallId: id });
    await as(s.t, "member-b").mutation(api.scheduledCalls.enter, { scheduledCallId: id });
    const list = await as(s.t, "user-2").query(api.scheduledCalls.waitingList, {
      scheduledCallId: id,
    });
    expect(list.waiting.map((row) => row.userId).sort()).toEqual(["member-a", "member-b"]);
    const first = list.waiting.find((row) => row.userId === "member-a");
    await as(s.t, "user-2").mutation(api.scheduledCalls.admit, { waitingId: first?.id as never });
    await as(s.t, "member-a").mutation(api.scheduledCalls.join, {
      scheduledCallId: id,
      clientId: "device-a",
    });
    // The call stays scheduled for everyone else.
    expect((await s.t.run(async (ctx) => await ctx.db.get(id)))?.status).toBe("scheduled");
    await expect(
      as(s.t, "member-b").mutation(api.scheduledCalls.join, {
        scheduledCallId: id,
        clientId: "device-b",
      }),
    ).rejects.toThrow(/hasn't started yet/);
    const count = await as(s.t, "admin-1").mutation(api.scheduledCalls.admitAllEarly, {
      scheduledCallId: id,
    });
    expect(count).toBe(1);
    await as(s.t, "member-b").mutation(api.scheduledCalls.join, {
      scheduledCallId: id,
      clientId: "device-b",
    });
    const audits = await s.t.run(async (ctx) => await ctx.db.query("auditLog").take(50));
    expect(audits.some((a) => a.action === "scheduledCall.waitingAdmit")).toBe(true);
    expect(audits.some((a) => a.action === "scheduledCall.waitingAdmitAll")).toBe(true);
  });

  it("makes an uninvited member knock, and admission lets them in and back in", async () => {
    const s = await seed();
    const id = await channelCall(s, { inviteOnly: true });
    await openNow(s.t, id);
    const entered = await as(s.t, "member-a").mutation(api.scheduledCalls.enter, {
      scheduledCallId: id,
    });
    expect(entered).toMatchObject({ state: "waiting", kind: "knock" });
    // The call is open and a knocker is still refused until a host answers.
    await expect(
      as(s.t, "member-a").mutation(api.scheduledCalls.join, {
        scheduledCallId: id,
        clientId: "device-a",
      }),
    ).rejects.toThrow(/invite-only/);
    const list = await as(s.t, "admin-1").query(api.scheduledCalls.waitingList, {
      scheduledCallId: id,
    });
    expect(list.waiting).toHaveLength(1);
    await as(s.t, "admin-1").mutation(api.scheduledCalls.admit, {
      waitingId: list.waiting[0]?.id as never,
    });
    const mine = await as(s.t, "member-a").query(api.scheduledCalls.mine, {});
    expect(mine[0]?.state).toBe("admitted");
    const joined = await as(s.t, "member-a").mutation(api.scheduledCalls.join, {
      scheduledCallId: id,
      clientId: "device-a",
    });
    // A rejoin after a disconnect keeps working while the call is live.
    await as(s.t, "user-2").mutation(api.calls.join, {
      callId: joined.callId,
      clientId: "device-c",
    });
    await as(s.t, "member-a").mutation(api.calls.leave, {
      callId: joined.callId,
      clientId: "device-a",
    });
    await as(s.t, "member-a").mutation(api.calls.join, {
      callId: joined.callId,
      clientId: "device-a",
    });
    // Admission is for this call only.
    const other = await channelCall(s, { inviteOnly: true });
    await openNow(s.t, other);
    await expect(
      as(s.t, "member-a").mutation(api.scheduledCalls.join, {
        scheduledCallId: other,
        clientId: "device-a",
      }),
    ).rejects.toThrow();
  });

  it("tells a declined member and holds them off for the cooldown", async () => {
    const s = await seed();
    const id = await channelCall(s, { inviteOnly: true });
    await openNow(s.t, id);
    await as(s.t, "member-a").mutation(api.scheduledCalls.enter, { scheduledCallId: id });
    const list = await as(s.t, "user-2").query(api.scheduledCalls.waitingList, {
      scheduledCallId: id,
    });
    await as(s.t, "user-2").mutation(api.scheduledCalls.decline, {
      waitingId: list.waiting[0]?.id as never,
    });
    const mine = await as(s.t, "member-a").query(api.scheduledCalls.mine, {});
    expect(mine[0]?.state).toBe("declined");
    const again = await as(s.t, "member-a").mutation(api.scheduledCalls.enter, {
      scheduledCallId: id,
    });
    expect(again.state).toBe("declined");
    await expect(
      as(s.t, "member-a").mutation(api.scheduledCalls.join, {
        scheduledCallId: id,
        clientId: "device-a",
      }),
    ).rejects.toThrow(/invite-only/);
    // After the cooldown they can ask again.
    await s.t.run(async (ctx) => {
      const rows = await ctx.db.query("scheduledCallWaiting").take(5);
      for (const row of rows) {
        await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
      }
    });
    const retry = await as(s.t, "member-a").mutation(api.scheduledCalls.enter, {
      scheduledCallId: id,
    });
    expect(retry).toMatchObject({ state: "waiting", kind: "knock" });
  });

  it("keeps the waiting room to hosts", async () => {
    const s = await seed();
    const id = await channelCall(s, { inviteOnly: true });
    await openNow(s.t, id);
    await as(s.t, "member-a").mutation(api.scheduledCalls.enter, { scheduledCallId: id });
    const rows = await waitingRows(s.t, id);
    const waitingId = rows[0]?._id as never;
    await expect(
      as(s.t, "member-b").query(api.scheduledCalls.waitingList, { scheduledCallId: id }),
    ).rejects.toThrow(/cannot manage/);
    await expect(
      as(s.t, "member-b").mutation(api.scheduledCalls.admit, { waitingId }),
    ).rejects.toThrow(/cannot manage/);
    await expect(
      as(s.t, "member-a").mutation(api.scheduledCalls.decline, { waitingId }),
    ).rejects.toThrow(/cannot manage/);
    expect(
      await as(s.t, "member-b").query(api.scheduledCalls.waitingAccess, { scheduledCallId: id }),
    ).toEqual({ canManage: false });
    expect(
      await as(s.t, "user-2").query(api.scheduledCalls.waitingAccess, { scheduledCallId: id }),
    ).toEqual({ canManage: true });
    const asMember = await as(s.t, "member-b").query(api.scheduledCalls.get, {
      scheduledCallId: id,
    });
    expect(asMember.canManageWaiting).toBe(false);
    const asAdmin = await as(s.t, "admin-1").query(api.scheduledCalls.get, { scheduledCallId: id });
    expect(asAdmin.canManageWaiting).toBe(true);
  });

  it("caps pending requests per call", async () => {
    const s = await seed();
    const id = await channelCall(s, { inviteOnly: true });
    await openNow(s.t, id);
    const total = SCHEDULED_WAITING_MAX_PENDING + 1;
    await s.t.run(async (ctx) => {
      for (let index = 0; index < total; index += 1) {
        await ctx.db.insert("members", {
          userId: `knocker-${index}`,
          roleIds: [EVERYONE_ROLE_ID],
          joinedAt: Date.now(),
        });
      }
    });
    for (let index = 0; index < SCHEDULED_WAITING_MAX_PENDING; index += 1) {
      await as(s.t, `knocker-${index}`).mutation(api.scheduledCalls.enter, {
        scheduledCallId: id,
      });
    }
    await expect(
      as(s.t, `knocker-${total - 1}`).mutation(api.scheduledCalls.enter, { scheduledCallId: id }),
    ).rejects.toThrow(/Too many people/);
    // A member already waiting is not blocked by the cap.
    await as(s.t, "knocker-0").mutation(api.scheduledCalls.enter, { scheduledCallId: id });
  });

  it("lets a member leave, and deletes every row when the call is cancelled or ends", async () => {
    const s = await seed();
    const id = await channelCall(s, { inviteOnly: true, invitees: ["member-a"] });
    await as(s.t, "member-a").mutation(api.scheduledCalls.enter, { scheduledCallId: id });
    await as(s.t, "member-a").mutation(api.scheduledCalls.leave, { scheduledCallId: id });
    expect(await waitingRows(s.t, id)).toHaveLength(0);

    await as(s.t, "member-a").mutation(api.scheduledCalls.enter, { scheduledCallId: id });
    await as(s.t, "member-b").mutation(api.scheduledCalls.enter, { scheduledCallId: id });
    expect(await waitingRows(s.t, id)).toHaveLength(2);
    await as(s.t, "user-2").mutation(api.scheduledCalls.cancel, { scheduledCallId: id });
    expect(await waitingRows(s.t, id)).toHaveLength(0);

    const ended = await channelCall(s, { inviteOnly: true });
    await openNow(s.t, ended);
    await as(s.t, "member-a").mutation(api.scheduledCalls.enter, { scheduledCallId: ended });
    await s.t.run(async (ctx) => {
      await ctx.db.patch(ended, { startsAt: Date.now() - 3 * 60 * MINUTE, durationMinutes: 30 });
    });
    await s.t.mutation(internal.scheduledCalls.sweep, {});
    expect((await s.t.run(async (ctx) => await ctx.db.get(ended)))?.status).toBe("ended");
    expect(await waitingRows(s.t, ended)).toHaveLength(0);
  });

  it("prunes lapsed rows in the sweep", async () => {
    const s = await seed();
    const id = await channelCall(s, { inviteOnly: true });
    await as(s.t, "member-a").mutation(api.scheduledCalls.enter, { scheduledCallId: id });
    await s.t.run(async (ctx) => {
      const rows = await ctx.db.query("scheduledCallWaiting").take(5);
      for (const row of rows) {
        await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
      }
    });
    await s.t.mutation(internal.scheduledCalls.sweep, {});
    expect(await waitingRows(s.t, id)).toHaveLength(0);
  });

  it("does not let a member who cannot see a standalone room knock", async () => {
    const s = await seed();
    const id = await as(s.t, "user-2").mutation(api.scheduledCalls.create, {
      title: "Private",
      startsAt: Date.now() + 30 * MINUTE,
      openLeadMinutes: 5,
      inviteeUserIds: ["user-1"],
    });
    await expect(
      as(s.t, "member-a").mutation(api.scheduledCalls.enter, { scheduledCallId: id }),
    ).rejects.toThrow(/cannot see/);
  });
});
