import { Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { newTest, seedChannel, seedWorkspace, type Test } from "./helpers";

async function patchSettings(t: Test, settings: Record<string, unknown>) {
  await t.run(async (ctx) => {
    const server = await ctx.db.query("server").first();
    if (server !== null) {
      await ctx.db.patch(server._id, { settings: { ...server.settings, ...settings } });
    }
  });
}

async function seedScheduled(t: Test) {
  await seedWorkspace(t, {
    members: [
      { userId: "user-1", roleIds: ["scheduler"] },
      { userId: "user-2", roleIds: ["scheduler"] },
    ],
    extraRoles: [
      {
        key: "scheduler",
        permissions: Permission.ScheduleCalls | Permission.ViewScheduledCalls | Permission.Connect,
        position: 2,
      },
    ],
  });
  await patchSettings(t, { scheduledCallsEnabled: true });
}

const MINUTE = 60_000;

describe("scheduled calls permissions", () => {
  it("is off until enabled and requires ViewScheduledCalls to list", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    await expect(
      t.withIdentity({ subject: "user-1" }).query(api.scheduledCalls.list, {}),
    ).rejects.toThrow(/Scheduled calls are disabled/);
    await patchSettings(t, { scheduledCallsEnabled: true });
    await expect(
      t.withIdentity({ subject: "user-1" }).query(api.scheduledCalls.list, {}),
    ).rejects.toThrow(/Missing permission/);
  });

  it("grants ViewScheduledCalls to @everyone once through the migration", async () => {
    const t = newTest();
    const { serverId } = await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const changed = await t.mutation(internal.setupState.grantScheduledCallsView, {});
    expect(changed).toBe(true);
    const again = await t.mutation(internal.setupState.grantScheduledCallsView, {});
    expect(again).toBe(false);
    await t.run(async (ctx) => {
      const server = await ctx.db.get(serverId);
      expect(server?.appliedMigrations).toContain("grant-scheduled-calls-view");
    });
  });

  it("lets a role with ScheduleCalls create a standalone room", async () => {
    const t = newTest();
    await seedScheduled(t);
    const startsAt = Date.now() + 10 * MINUTE;
    const id = await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
      title: "Design review",
      description: "Agenda",
      startsAt,
      openLeadMinutes: 5,
      inviteeUserIds: ["user-1"],
    });
    const view = await t.withIdentity({ subject: "user-2" }).query(api.scheduledCalls.get, {
      scheduledCallId: id,
    });
    expect(view.title).toBe("Design review");
    expect(view.channelId).toBeNull();
    expect(view.opensAt).toBe(startsAt - 5 * MINUTE);
  });
});

describe("scheduled call creator cap", () => {
  it("counts upcoming calls for a creator with a long call history", async () => {
    const t = newTest();
    await seedScheduled(t);
    const now = Date.now();
    // Enough old calls that a newest-first read is required: the first
    // `cap + 1` rows of the index are all in the past.
    await t.run(async (ctx) => {
      for (let index = 0; index < 60; index += 1) {
        const at = now - (index + 1) * MINUTE;
        await ctx.db.insert("scheduledCalls", {
          titleCiphertext: "",
          startsAt: at,
          openLeadMinutes: 5,
          inviteeUserIds: [],
          inviteeRoleIds: [],
          createdBy: "user-2",
          status: "scheduled",
          createdAt: at,
          updatedAt: at,
        });
      }
    });

    for (let index = 0; index < 50; index += 1) {
      await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
        title: `Future ${index}`,
        startsAt: now + (index + 1) * MINUTE,
        openLeadMinutes: 5,
        inviteeUserIds: ["user-1"],
      });
    }
    await expect(
      t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
        title: "One too many",
        startsAt: now + 51 * MINUTE,
        openLeadMinutes: 5,
        inviteeUserIds: ["user-1"],
      }),
    ).rejects.toThrow(/50-call limit/);
  });
});

describe("scheduled call list visibility", () => {
  it("shows a standalone room only to invitees and managers", async () => {
    const t = newTest();
    await seedScheduled(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", {
        userId: "outsider",
        roleIds: ["viewer"],
        joinedAt: Date.now(),
      });
      await ctx.db.insert("roles", {
        key: "viewer",
        name: "viewer",
        position: 1,
        permissions: Permission.ViewScheduledCalls,
        hoisted: false,
        mentionable: false,
      });
    });
    const startsAt = Date.now() + 10 * MINUTE;
    const id = await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
      title: "Private room",
      startsAt,
      inviteeUserIds: ["user-1"],
    });

    const invited = await t.withIdentity({ subject: "user-1" }).query(api.scheduledCalls.list, {});
    expect(invited.map((row) => row.id)).toContain(id);
    const hidden = await t.withIdentity({ subject: "outsider" }).query(api.scheduledCalls.list, {});
    expect(hidden.map((row) => row.id)).not.toContain(id);
    await expect(
      t
        .withIdentity({ subject: "outsider" })
        .query(api.scheduledCalls.get, { scheduledCallId: id }),
    ).rejects.toThrow(/cannot see/);
  });

  it("shows a channel-bound call to whoever may view the channel", async () => {
    const t = newTest();
    await seedScheduled(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", {
        userId: "viewer",
        roleIds: ["viewer"],
        joinedAt: Date.now(),
      });
      await ctx.db.insert("roles", {
        key: "viewer",
        name: "viewer",
        position: 1,
        permissions: Permission.ViewScheduledCalls | Permission.ViewChannel,
        hoisted: false,
        mentionable: false,
      });
    });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const id = await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
      title: "Lounge sync",
      startsAt: Date.now() + 10 * MINUTE,
      channelId,
    });
    expect(
      (await t.withIdentity({ subject: "viewer" }).query(api.scheduledCalls.list, {})).map(
        (row) => row.id,
      ),
    ).toContain(id);
  });
});

describe("scheduled call open window", () => {
  it("refuses a join before the open time with the typed error", async () => {
    const t = newTest();
    await seedScheduled(t);
    const startsAt = Date.now() + 30 * MINUTE;
    const id = await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
      title: "Later",
      startsAt,
      openLeadMinutes: 5,
      inviteeUserIds: ["user-1"],
    });
    await expect(
      t
        .withIdentity({ subject: "user-1" })
        .mutation(api.scheduledCalls.join, { scheduledCallId: id, clientId: "device-a" }),
    ).rejects.toThrow(/hasn't started yet/);
  });

  it("creates a standalone room on the first join and reuses it", async () => {
    const t = newTest();
    await seedScheduled(t);
    const startsAt = Date.now() + MINUTE;
    const id = await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
      title: "Open now",
      startsAt,
      openLeadMinutes: 5,
      inviteeUserIds: ["user-1", "user-2"],
    });
    const first = await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.scheduledCalls.join, { scheduledCallId: id, clientId: "device-a" });
    expect(first.created).toBe(true);
    const second = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.scheduledCalls.join, { scheduledCallId: id, clientId: "device-b" });
    expect(second.created).toBe(false);
    expect(second.callId).toBe(first.callId);

    const call = await t
      .withIdentity({ subject: "user-1" })
      .query(api.calls.get, { callId: first.callId });
    expect(call?.standalone).toBe(true);
    expect(call?.channelId).toBeNull();
    expect(call?.participants).toHaveLength(2);
  });

  it("lets a seated caller read a standalone room without ViewScheduledCalls", async () => {
    const t = newTest();
    await seedScheduled(t);
    const id = await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
      title: "Seated",
      startsAt: Date.now() + MINUTE,
      openLeadMinutes: 5,
      inviteeUserIds: ["user-1"],
    });
    const { callId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.scheduledCalls.join, { scheduledCallId: id, clientId: "device-a" });

    await t.run(async (ctx) => {
      // The invitee keeps Connect but loses ViewScheduledCalls, and is no
      // longer listed as an invitee: only the held seat can authorize the read.
      const roles = await ctx.db.query("roles").take(32);
      const role = roles.find((row) => row.key === "scheduler");
      if (role !== undefined) {
        await ctx.db.patch(role._id, {
          permissions: Permission.Connect | Permission.ScheduleCalls,
        });
      }
      await ctx.db.patch(id, { inviteeUserIds: [] });
      await ctx.db.insert("roles", {
        key: "viewer",
        name: "viewer",
        position: 1,
        permissions: Permission.Connect,
        hoisted: false,
        mentionable: false,
      });
      await ctx.db.insert("members", {
        userId: "outsider",
        roleIds: ["viewer"],
        joinedAt: Date.now(),
      });
    });

    const seated = await t.withIdentity({ subject: "user-1" }).query(api.calls.get, { callId });
    expect(seated?.standalone).toBe(true);
    expect(seated?.participants).toHaveLength(1);
    // A non-seated, non-invited caller is still refused.
    await expect(
      t.withIdentity({ subject: "outsider" }).query(api.calls.get, { callId }),
    ).rejects.toThrow(/Missing scheduled-call permission/);
  });

  it("arms the solo timer on the call a join switches away from", async () => {
    const t = newTest();
    await seedScheduled(t);
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const { callId: channelCallId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a" });
    await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.calls.join, { callId: channelCallId, clientId: "device-b" });

    const scheduledId = await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.scheduledCalls.create, {
        title: "New room",
        startsAt: Date.now() + MINUTE,
        openLeadMinutes: 5,
        inviteeUserIds: ["user-1", "user-2"],
      });
    // Switching into a newly created room evicts user-2 from the channel call.
    await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.join, {
      scheduledCallId: scheduledId,
      clientId: "device-b",
    });

    const channelCall = await t
      .withIdentity({ subject: "user-1" })
      .query(api.calls.get, { callId: channelCallId });
    expect(channelCall?.participants).toHaveLength(1);
    // The previous call must get its solo deadline immediately, not only after
    // the 30 s sweep.
    expect(channelCall?.aloneDeadline).not.toBeNull();
  });

  it("clears the solo deadline when a second invitee joins a standalone room", async () => {
    const t = newTest();
    await seedScheduled(t);
    const id = await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
      title: "Solo timer",
      startsAt: Date.now() + MINUTE,
      openLeadMinutes: 5,
      inviteeUserIds: ["user-1", "user-2"],
    });
    const first = await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.scheduledCalls.join, { scheduledCallId: id, clientId: "device-a" });
    const alone = await t
      .withIdentity({ subject: "user-2" })
      .query(api.calls.get, { callId: first.callId });
    expect(alone?.aloneDeadline).not.toBeNull();

    await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.scheduledCalls.join, { scheduledCallId: id, clientId: "device-b" });
    const seated = await t
      .withIdentity({ subject: "user-2" })
      .query(api.calls.get, { callId: first.callId });
    expect(seated?.aloneDeadline).toBeNull();
  });

  it("flips a due call open and ends it after its duration", async () => {
    const t = newTest();
    await seedScheduled(t);
    const id = await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
      title: "Due",
      startsAt: Date.now() + 10 * MINUTE,
      durationMinutes: 15,
      inviteeUserIds: ["user-1"],
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(id, { startsAt: Date.now() - MINUTE });
    });
    await t.mutation(internal.scheduledCalls.openOne, { scheduledCallId: id });
    let view = await t
      .withIdentity({ subject: "user-2" })
      .query(api.scheduledCalls.get, { scheduledCallId: id });
    expect(view.status).toBe("open");

    await t.run(async (ctx) => {
      await ctx.db.patch(id, { startsAt: Date.now() - 10 * MINUTE, durationMinutes: 5 });
    });
    await t.mutation(internal.scheduledCalls.sweep, {});
    view = await t
      .withIdentity({ subject: "user-2" })
      .query(api.scheduledCalls.get, { scheduledCallId: id });
    expect(view.status).toBe("ended");
  });

  it("rejects a banned scheduler", async () => {
    const t = newTest();
    await seedScheduled(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("bans", {
        userId: "user-2",
        actorId: "owner-1",
        at: Date.now(),
      });
    });
    await expect(
      t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
        title: "Banned",
        startsAt: Date.now() + 10 * MINUTE,
        inviteeUserIds: ["user-1"],
      }),
    ).rejects.toThrow(/banned/);
  });

  it("cancels a call and ends its live room", async () => {
    const t = newTest();
    await seedScheduled(t);
    const id = await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
      title: "Cancel me",
      startsAt: Date.now() + MINUTE,
      openLeadMinutes: 5,
      inviteeUserIds: ["user-1"],
    });
    const joined = await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.scheduledCalls.join, { scheduledCallId: id, clientId: "device-a" });
    await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.cancel, {
      scheduledCallId: id,
    });
    const view = await t
      .withIdentity({ subject: "user-2" })
      .query(api.scheduledCalls.get, { scheduledCallId: id });
    expect(view.status).toBe("cancelled");
    const call = await t
      .withIdentity({ subject: "user-2" })
      .query(api.calls.get, { callId: joined.callId });
    expect(call?.status).toBe("ended");
    await expect(
      t
        .withIdentity({ subject: "user-1" })
        .mutation(api.scheduledCalls.join, { scheduledCallId: id, clientId: "device-b" }),
    ).rejects.toThrow(/has ended/);
  });
});

describe("scheduled call seat and permission fixes", () => {
  it("prepares the seat on the first join and leaves the member's previous call", async () => {
    const t = newTest();
    await seedScheduled(t);
    const otherChannel = await seedChannel(t, { kind: "voice", name: "Elsewhere" });
    const previous = await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.calls.start, { channelId: otherChannel, kind: "voice", clientId: "device-a" });
    const id = await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
      title: "One seat",
      startsAt: Date.now() + MINUTE,
      openLeadMinutes: 5,
      inviteeUserIds: ["user-1", "user-2"],
    });
    const joined = await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.scheduledCalls.join, { scheduledCallId: id, clientId: "device-a" });
    const previousCall = await t.run(async (ctx) => await ctx.db.get(previous.callId));
    // The normal seat preparation removed the member from the old call.
    expect(previousCall?.status).toBe("ended");
    const seats = await t.run(async (ctx) =>
      (await ctx.db.query("callParticipants").take(64)).filter(
        (row) => row.callId === joined.callId,
      ),
    );
    expect(seats).toHaveLength(1);
    expect(seats[0]?.userId).toBe("user-2");
  });

  it("persists the room association when the existing call is already open", async () => {
    const t = newTest();
    await seedScheduled(t);
    const channelId = await seedChannel(t, { kind: "voice", name: "Open channel" });
    const id = await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
      title: "Already open",
      startsAt: Date.now() + MINUTE,
      openLeadMinutes: 5,
      channelId,
    });
    await t.mutation(internal.scheduledCalls.openOne, { scheduledCallId: id });
    const live = await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a" });
    await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.scheduledCalls.join, { scheduledCallId: id, clientId: "device-a" });
    const stored = await t.run(async (ctx) => await ctx.db.get(id));
    expect(stored?.status).toBe("open");
    expect(stored?.callId).toBe(live.callId);
  });

  it("requires ScheduleCalls for the creator to manage, not ownership alone", async () => {
    const t = newTest();
    await seedScheduled(t);
    const id = await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
      title: "Own it",
      startsAt: Date.now() + 10 * MINUTE,
      inviteeUserIds: ["user-1", "user-2"],
    });
    await t.run(async (ctx) => {
      // Keep only ViewScheduledCalls on the creator's role.
      const roles = await ctx.db.query("roles").take(20);
      const scheduler = roles.find((row) => row.key === "scheduler");
      if (scheduler !== undefined) {
        await ctx.db.patch(scheduler._id, {
          permissions: Permission.ViewScheduledCalls | Permission.Connect,
        });
      }
    });
    await expect(
      t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.update, {
        scheduledCallId: id,
        title: "Renamed",
      }),
    ).rejects.toThrow(/cannot edit/);
    await expect(
      t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.cancel, {
        scheduledCallId: id,
      }),
    ).rejects.toThrow(/cannot cancel/);
    const view = await t
      .withIdentity({ subject: "user-2" })
      .query(api.scheduledCalls.get, { scheduledCallId: id });
    expect(view.canManage).toBe(false);
  });

  it("refuses a text channel and a join into a text-channel room", async () => {
    const t = newTest();
    await seedScheduled(t);
    const textChannel = await seedChannel(t, { kind: "text", name: "Text only" });
    await expect(
      t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
        title: "Not callable",
        startsAt: Date.now() + 10 * MINUTE,
        channelId: textChannel,
      }),
    ).rejects.toThrow(/only available in voice channels/);

    const id = await t.run(async (ctx) =>
      ctx.db.insert("scheduledCalls", {
        titleCiphertext: "",
        startsAt: Date.now() - MINUTE,
        openLeadMinutes: 5,
        channelId: textChannel,
        inviteeUserIds: [],
        inviteeRoleIds: [],
        createdBy: "user-2",
        status: "open",
        createdAt: Date.now() - 2 * MINUTE,
        updatedAt: Date.now() - 2 * MINUTE,
      }),
    );
    await expect(
      t
        .withIdentity({ subject: "user-2" })
        .mutation(api.scheduledCalls.join, { scheduledCallId: id, clientId: "device-a" }),
    ).rejects.toThrow(/only available in voice channels/);
  });

  it("refuses cancel from a timed-out manager", async () => {
    const t = newTest();
    await seedScheduled(t);
    const id = await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
      title: "No timeout",
      startsAt: Date.now() + 10 * MINUTE,
      inviteeUserIds: ["user-1", "user-2"],
    });
    await t.run(async (ctx) => {
      const members = await ctx.db.query("members").take(64);
      const member = members.find((row) => row.userId === "user-2");
      if (member !== undefined) {
        await ctx.db.patch(member._id, { timeoutUntil: Date.now() + 60_000 });
      }
    });
    await expect(
      t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.cancel, {
        scheduledCallId: id,
      }),
    ).rejects.toThrow(/timed out/);
  });
});

describe("scheduled room association", () => {
  it("never reuses another meeting's channel room on a member join", async () => {
    const t = newTest();
    await seedScheduled(t);
    const channelId = await seedChannel(t, { kind: "voice", name: "Shared channel" });
    const startsAt = Date.now() + 2 * MINUTE;
    const x = await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
      title: "Meeting X",
      startsAt,
      openLeadMinutes: 5,
      channelId,
    });
    const y = await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
      title: "Meeting Y",
      startsAt,
      openLeadMinutes: 5,
      channelId,
    });
    const yRoom = await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.scheduledCalls.join, { scheduledCallId: y, clientId: "device-y" });

    await expect(
      t
        .withIdentity({ subject: "user-1" })
        .mutation(api.scheduledCalls.join, { scheduledCallId: x, clientId: "device-x" }),
    ).rejects.toThrow(/another scheduled meeting/);
    const xRow = await t.run(async (ctx) => await ctx.db.get(x));
    expect(xRow?.callId).toBeUndefined();
    const participants = await t.run(async (ctx) =>
      (await ctx.db.query("callParticipants").take(64)).filter(
        (row) => row.callId === yRoom.callId,
      ),
    );
    expect(participants.map((row) => row.userId)).toEqual(["user-2"]);
  });

  it("claims an unassociated channel room on member join", async () => {
    const t = newTest();
    await seedScheduled(t);
    const channelId = await seedChannel(t, { kind: "voice", name: "Claim channel" });
    const x = await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
      title: "Meeting X",
      startsAt: Date.now() + 2 * MINUTE,
      openLeadMinutes: 5,
      channelId,
    });
    const live = await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-host" });
    const joined = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.scheduledCalls.join, { scheduledCallId: x, clientId: "device-x" });
    expect(joined.callId).toBe(live.callId);
    const call = await t.run(async (ctx) => await ctx.db.get(live.callId));
    expect(call?.scheduledCallId).toBe(x);
    const row = await t.run(async (ctx) => await ctx.db.get(x));
    expect(row?.callId).toBe(live.callId);
  });

  it("blocks a guest admission for Y after X claims the room", async () => {
    const t = newTest();
    await seedScheduled(t);
    await patchSettings(t, { guestCallsEnabled: true });
    const channelId = await seedChannel(t, { kind: "voice", name: "Claimed by X" });
    const startsAt = Date.now() + 2 * MINUTE;
    const x = await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
      title: "Meeting X",
      startsAt,
      openLeadMinutes: 5,
      channelId,
    });
    const y = await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
      title: "Meeting Y",
      startsAt,
      openLeadMinutes: 5,
      channelId,
    });
    const room = await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-host" });
    const yLink = await t.withIdentity({ subject: "owner-1" }).mutation(api.guestCalls.createLink, {
      scheduledCallId: y,
    });
    const pending = await t.mutation(api.guestCalls.requestJoin, {
      token: yLink.token,
      displayName: "Guest Y",
      clientId: "guest-device-y",
    });
    expect(pending.callId).toBe(room.callId);

    await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.scheduledCalls.join, { scheduledCallId: x, clientId: "device-x" });
    await expect(
      t
        .withIdentity({ subject: "owner-1" })
        .mutation(api.guestCalls.admit, { guestSessionId: pending.guestSessionId }),
    ).rejects.toThrow(/This guest link is not available/);
  });
});

describe("scheduled calls with guest links", () => {
  it("tells a guest that the call has not started yet", async () => {
    const t = newTest();
    await seedScheduled(t);
    const startsAt = Date.now() + 30 * MINUTE;
    const id = await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
      title: "Guest later",
      startsAt,
      openLeadMinutes: 5,
      inviteeUserIds: ["user-1"],
    });
    await patchSettings(t, { guestCallsEnabled: true });
    const link = await t.withIdentity({ subject: "owner-1" }).mutation(api.guestCalls.createLink, {
      scheduledCallId: id,
    });
    const preview = await t.query(api.guestCalls.preview, { token: link.token });
    expect(preview.open).toBe(false);
    expect(preview.startsAt).toBe(startsAt);
    await expect(
      t.mutation(api.guestCalls.requestJoin, {
        token: link.token,
        displayName: "Guest",
      }),
    ).rejects.toThrow(/hasn't started yet/);
  });

  it("finds a channel-bound room started from the channel before the scheduled link", async () => {
    const t = newTest();
    await seedScheduled(t);
    const channelId = await seedChannel(t, { kind: "voice", name: "Scheduled channel" });
    const id = await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
      title: "Channel room",
      startsAt: Date.now() + 2 * MINUTE,
      openLeadMinutes: 5,
      channelId,
    });
    await patchSettings(t, { guestCallsEnabled: true });
    const link = await t.withIdentity({ subject: "owner-1" }).mutation(api.guestCalls.createLink, {
      scheduledCallId: id,
    });
    await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-host" });

    const preview = await t.query(api.guestCalls.preview, { token: link.token });
    expect(preview.open).toBe(true);
    const joined = await t.mutation(api.guestCalls.requestJoin, {
      token: link.token,
      displayName: "Guest",
    });
    expect(joined.status).toBe("pending");
  });

  it("never resolves X's link to another scheduled meeting's room on the same channel", async () => {
    const t = newTest();
    await seedScheduled(t);
    const channelId = await seedChannel(t, { kind: "voice", name: "Shared channel" });
    const startsAt = Date.now() + 2 * MINUTE;
    const x = await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
      title: "Meeting X",
      startsAt,
      openLeadMinutes: 5,
      channelId,
    });
    const y = await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
      title: "Meeting Y",
      startsAt,
      openLeadMinutes: 5,
      channelId,
    });
    await patchSettings(t, { guestCallsEnabled: true });
    // Y opens its own room on the shared channel: the call is associated with
    // Y through `call.scheduledCallId`.
    const yRoom = await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.scheduledCalls.join, { scheduledCallId: y, clientId: "device-y" });
    const xLink = await t.withIdentity({ subject: "owner-1" }).mutation(api.guestCalls.createLink, {
      scheduledCallId: x,
    });
    await expect(
      t.mutation(api.guestCalls.requestJoin, {
        token: xLink.token,
        displayName: "Guest",
        clientId: "guest-device-x",
      }),
    ).rejects.toThrow(/hasn't started yet/);

    // Y's own link still reaches Y's room.
    const yLink = await t.withIdentity({ subject: "owner-1" }).mutation(api.guestCalls.createLink, {
      scheduledCallId: y,
    });
    const yGuest = await t.mutation(api.guestCalls.requestJoin, {
      token: yLink.token,
      displayName: "Guest",
      clientId: "guest-device-y",
    });
    expect(yGuest.callId).toBe(yRoom.callId);
  });

  it("refuses a stale pending guest when another meeting claimed the room", async () => {
    const t = newTest();
    await seedScheduled(t);
    const channelId = await seedChannel(t, { kind: "voice", name: "Claimed channel" });
    const startsAt = Date.now() + 2 * MINUTE;
    const x = await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
      title: "Meeting X",
      startsAt,
      openLeadMinutes: 5,
      channelId,
    });
    const y = await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
      title: "Meeting Y",
      startsAt,
      openLeadMinutes: 5,
      channelId,
    });
    await patchSettings(t, { guestCallsEnabled: true });
    await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-host" });
    const xLink = await t.withIdentity({ subject: "owner-1" }).mutation(api.guestCalls.createLink, {
      scheduledCallId: x,
    });
    const yLink = await t.withIdentity({ subject: "owner-1" }).mutation(api.guestCalls.createLink, {
      scheduledCallId: y,
    });
    // Both requests see the same still-unassociated channel room.
    const xGuest = await t.mutation(api.guestCalls.requestJoin, {
      token: xLink.token,
      displayName: "Guest X",
      clientId: "guest-device-x",
    });
    const yGuest = await t.mutation(api.guestCalls.requestJoin, {
      token: yLink.token,
      displayName: "Guest Y",
      clientId: "guest-device-y",
    });
    expect(xGuest.callId).toBe(yGuest.callId);
    // Y admits first and claims the room; X's stale request must be refused.
    await t
      .withIdentity({ subject: "owner-1" })
      .mutation(api.guestCalls.admit, { guestSessionId: yGuest.guestSessionId });
    await expect(
      t
        .withIdentity({ subject: "owner-1" })
        .mutation(api.guestCalls.admit, { guestSessionId: xGuest.guestSessionId }),
    ).rejects.toThrow(/This guest link is not available/);
  });

  it("finds a replacement room after X's associated room ended", async () => {
    const t = newTest();
    await seedScheduled(t);
    const channelId = await seedChannel(t, { kind: "voice", name: "Replacement channel" });
    const startsAt = Date.now() + 2 * MINUTE;
    const x = await t.withIdentity({ subject: "user-2" }).mutation(api.scheduledCalls.create, {
      title: "Meeting X",
      startsAt,
      openLeadMinutes: 5,
      channelId,
    });
    await patchSettings(t, { guestCallsEnabled: true });
    const first = await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-host" });
    const link = await t.withIdentity({ subject: "owner-1" }).mutation(api.guestCalls.createLink, {
      scheduledCallId: x,
    });
    const firstGuest = await t.mutation(api.guestCalls.requestJoin, {
      token: link.token,
      displayName: "Guest",
      clientId: "guest-device-1",
    });
    expect(firstGuest.callId).toBe(first.callId);
    // Admitting into the unassociated channel room claims it for X.
    await t
      .withIdentity({ subject: "owner-1" })
      .mutation(api.guestCalls.admit, { guestSessionId: firstGuest.guestSessionId });
    await t.run(async (ctx) => {
      const call = await ctx.db.get(first.callId);
      expect(call?.scheduledCallId).toBe(x);
      const scheduled = await ctx.db.get(x);
      expect(scheduled?.callId).toBe(first.callId);
    });

    await t.withIdentity({ subject: "user-2" }).mutation(api.calls.end, { callId: first.callId });
    const replacement = await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-host-2" });
    const secondGuest = await t.mutation(api.guestCalls.requestJoin, {
      token: link.token,
      displayName: "Second guest",
      clientId: "guest-device-2",
    });
    expect(secondGuest.callId).toBe(replacement.callId);
  });
});
