import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { as, channelCall, MINUTE, openNow, seed } from "./scheduled-helpers";

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
