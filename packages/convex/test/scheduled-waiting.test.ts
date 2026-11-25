import { EVERYONE_ROLE_ID, SCHEDULED_WAITING_MAX_PENDING } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { as, channelCall, MINUTE, openNow, seed, waitingRows } from "./scheduled-helpers";

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
