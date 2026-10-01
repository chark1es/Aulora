import { Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { newTest, seedChannel, seedWorkspace, type Test } from "./helpers";

async function seed(options: Parameters<typeof seedWorkspace>[1] = {}) {
  const t = newTest();
  await seedWorkspace(t, options);
  return t;
}

async function patchSettings(t: Test, settings: Record<string, unknown>) {
  await t.run(async (ctx) => {
    const server = await ctx.db.query("server").first();
    if (server !== null) {
      await ctx.db.patch(server._id, { settings: { ...server.settings, ...settings } });
    }
  });
}

describe("calls.start", () => {
  it("starts an active call on a voice channel and reuses it", async () => {
    const t = await seed({ members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });

    const first = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a" });
    expect(first.created).toBe(true);

    const second = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a" });
    expect(second.created).toBe(false);
    expect(second.callId).toBe(first.callId);

    const call = await t
      .withIdentity({ subject: "user-1" })
      .query(api.calls.forChannel, { channelId });
    expect(call?.status).toBe("active");
    expect(call?.participants.map((p) => p.userId)).toEqual(["user-1"]);
  });

  it("refuses calls on text channels", async () => {
    const t = await seed({ members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t, { kind: "text", name: "general" });
    await expect(
      t
        .withIdentity({ subject: "user-1" })
        .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a" }),
    ).rejects.toThrow(/voice channels and direct messages/);
  });

  it("honours the workspace voice/video switches", async () => {
    const t = await seed({ members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    await patchSettings(t, { voiceEnabled: false });
    await expect(
      t
        .withIdentity({ subject: "user-1" })
        .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a" }),
    ).rejects.toThrow(/disabled/);

    await patchSettings(t, { voiceEnabled: true, videoEnabled: false });
    await expect(
      t
        .withIdentity({ subject: "user-1" })
        .mutation(api.calls.start, { channelId, kind: "video", clientId: "device-a" }),
    ).rejects.toThrow(/Video calling is disabled/);
  });

  it("rings the other DM members instead of starting active", async () => {
    const t = await seed({ members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t, {
      kind: "dm",
      memberIds: ["user-1", "user-2"],
    });
    const { callId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a" });

    const incoming = await t.withIdentity({ subject: "user-2" }).query(api.calls.incoming, {});
    expect(incoming.map((call) => call.id)).toContain(callId);
    const call = await t.withIdentity({ subject: "user-1" }).query(api.calls.get, { callId });
    expect(call?.status).toBe("ringing");
  });
});

describe("calls lifecycle", () => {
  it("answers a ringing call, adds participants and ends when empty", async () => {
    const t = await seed({ members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t, { kind: "dm", memberIds: ["user-1", "user-2"] });
    const { callId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a" });

    await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.calls.join, { callId, clientId: "device-a" });
    let call = await t.withIdentity({ subject: "user-1" }).query(api.calls.get, { callId });
    expect(call?.status).toBe("active");
    expect(call?.participants).toHaveLength(2);

    await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.leave, { callId, clientId: "device-a" });
    call = await t.withIdentity({ subject: "user-2" }).query(api.calls.get, { callId });
    expect(call?.participants).toHaveLength(1);

    await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.calls.leave, { callId, clientId: "device-a" });
    call = await t.withIdentity({ subject: "user-2" }).query(api.calls.get, { callId });
    expect(call?.status).toBe("ended");
  });

  it("decline removes the caller from the ring", async () => {
    const t = await seed({ members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t, { kind: "dm", memberIds: ["user-1", "user-2"] });
    const { callId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a" });

    await t.withIdentity({ subject: "user-2" }).mutation(api.calls.decline, { callId });
    const incoming = await t.withIdentity({ subject: "user-2" }).query(api.calls.incoming, {});
    expect(incoming).toHaveLength(0);
  });

  it("relays and acks signalling in both directions", async () => {
    const t = await seed({ members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const { callId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a" });
    await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.calls.join, { callId, clientId: "device-a" });

    await t.withIdentity({ subject: "user-1" }).mutation(api.calls.signal, {
      callId,
      clientId: "device-a",
      toUserId: "user-2",
      kind: "offer",
      payload: "v=0",
    });
    const toTwo = await t.withIdentity({ subject: "user-2" }).query(api.calls.signals, { callId });
    expect(toTwo).toHaveLength(1);
    expect(toTwo[0]?.kind).toBe("offer");

    const toOne = await t.withIdentity({ subject: "user-1" }).query(api.calls.signals, { callId });
    expect(toOne).toHaveLength(0);

    const first = toTwo[0];
    if (first === undefined) {
      throw new Error("expected an offer signal for user-2");
    }
    await t.withIdentity({ subject: "user-2" }).mutation(api.calls.ack, { signalIds: [first.id] });
    const after = await t.withIdentity({ subject: "user-2" }).query(api.calls.signals, { callId });
    expect(after).toHaveLength(0);
  });

  it("gates camera and screen sharing by permission", async () => {
    const t = await seed({
      everyonePermissions: Permission.ViewChannel | Permission.Connect,
      members: [{ userId: "user-1" }],
    });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const { callId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a" });

    await expect(
      t.withIdentity({ subject: "user-1" }).mutation(api.calls.updateParticipant, {
        callId,
        clientId: "device-a",
        video: true,
      }),
    ).rejects.toThrow(/camera/);
    await expect(
      t.withIdentity({ subject: "user-1" }).mutation(api.calls.updateParticipant, {
        callId,
        clientId: "device-a",
        sharingScreen: true,
      }),
    ).rejects.toThrow(/share your screen/);
  });

  it("keeps one screen sharer and clears it when they stop", async () => {
    const t = await seed({ members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const { callId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a" });
    await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.calls.join, { callId, clientId: "device-a" });

    await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.updateParticipant, { callId, clientId: "device-a", sharingScreen: true });
    await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.calls.updateParticipant, { callId, clientId: "device-a", sharingScreen: true });

    let call = await t.withIdentity({ subject: "user-1" }).query(api.calls.get, { callId });
    expect(call?.screenShareUserId).toBe("user-2");
    expect(call?.participants.filter((p) => p.sharingScreen)).toHaveLength(1);

    await t.withIdentity({ subject: "user-2" }).mutation(api.calls.updateParticipant, {
      callId,
      clientId: "device-a",
      sharingScreen: false,
    });
    call = await t.withIdentity({ subject: "user-1" }).query(api.calls.get, { callId });
    expect(call?.screenShareUserId).toBeNull();
  });
});

describe("calls sweep", () => {
  it("drops stale participants and ends the empty call", async () => {
    const t = await seed({ members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const { callId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a" });

    await t.run(async (ctx) => {
      const participant = await ctx.db.query("callParticipants").first();
      if (participant !== null) {
        await ctx.db.patch(participant._id, { lastSeen: Date.now() - 120_000 });
      }
    });
    await t.mutation(internal.calls.sweep, {});

    const call = await t.withIdentity({ subject: "user-1" }).query(api.calls.get, { callId });
    expect(call?.status).toBe("ended");
    expect(call?.participants).toHaveLength(0);
  });

  it("ends a ringing call nobody answers", async () => {
    const t = await seed({ members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t, { kind: "dm", memberIds: ["user-1", "user-2"] });
    const { callId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a" });

    await t.run(async (ctx) => {
      const call = await ctx.db.get(callId);
      if (call !== null) {
        await ctx.db.patch(call._id, { startedAt: Date.now() - 120_000 });
      }
    });
    await t.mutation(internal.calls.sweep, {});
    const call = await t.withIdentity({ subject: "user-1" }).query(api.calls.get, { callId });
    expect(call?.status).toBe("ended");
  });
});

describe("calls target validation", () => {
  it("refuses a signal addressed to a non-participant", async () => {
    const t = await seed({
      members: [{ userId: "user-1" }, { userId: "user-2" }, { userId: "user-3" }],
    });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const { callId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a" });
    await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.calls.join, { callId, clientId: "device-a" });

    await expect(
      t.withIdentity({ subject: "user-1" }).mutation(api.calls.signal, {
        callId,
        clientId: "device-a",
        toUserId: "user-3",
        kind: "offer",
        payload: "v=0",
      }),
    ).rejects.toThrow("not in this call");
  });

  it("intersects explicit ringing targets with current channel members", async () => {
    const t = await seed({
      members: [{ userId: "user-1" }, { userId: "user-2" }, { userId: "stranger" }],
    });
    const channelId = await seedChannel(t, { kind: "dm", memberIds: ["user-1", "user-2"] });
    const { callId } = await t.withIdentity({ subject: "user-1" }).mutation(api.calls.start, {
      channelId,
      kind: "voice",
      clientId: "device-a",
      ringingUserIds: ["user-2", "stranger"],
    });
    const call = await t.run(async (ctx) => await ctx.db.get(callId));
    expect(call?.ringingUserIds).toEqual(["user-2"]);
  });
});

describe("one call per user", () => {
  it("moves the same device out of its other call", async () => {
    const t = await seed({ members: [{ userId: "user-1" }] });
    const lounge = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const focus = await seedChannel(t, { kind: "voice", name: "Focus" });
    const first = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId: lounge, kind: "voice", clientId: "device-a" });
    const second = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId: focus, kind: "voice", clientId: "device-a" });

    const left = await t.withIdentity({ subject: "user-1" }).query(api.calls.get, {
      callId: first.callId,
    });
    const joined = await t.withIdentity({ subject: "user-1" }).query(api.calls.get, {
      callId: second.callId,
    });
    expect(left?.status).toBe("ended");
    expect(joined?.participants.map((participant) => participant.userId)).toEqual(["user-1"]);
    expect(joined?.participants[0]?.clientId).toBe("device-a");

    const rows = await t.run(async (ctx) => await ctx.db.query("callParticipants").collect());
    expect(rows).toHaveLength(1);
  });

  it("refuses another device until it confirms the takeover", async () => {
    const t = await seed({ members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const { callId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a" });
    await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.calls.join, { callId, clientId: "device-b" });

    await expect(
      t.withIdentity({ subject: "user-1" }).mutation(api.calls.join, {
        callId,
        clientId: "device-b",
      }),
    ).rejects.toThrow(/another device/);

    await t.withIdentity({ subject: "user-1" }).mutation(api.calls.join, {
      callId,
      clientId: "device-b",
      takeover: true,
    });
    const call = await t.withIdentity({ subject: "user-1" }).query(api.calls.get, { callId });
    expect(call?.participants).toHaveLength(2);
    expect(
      call?.participants.find((participant) => participant.userId === "user-1")?.clientId,
    ).toBe("device-b");
    expect(
      call?.participants.find((participant) => participant.userId === "user-2")?.clientId,
    ).toBeNull();
  });

  it("does not let the displaced device leave or signal the new seat", async () => {
    const t = await seed({ members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const { callId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a" });
    await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.calls.join, { callId, clientId: "device-c" });
    await t.withIdentity({ subject: "user-1" }).mutation(api.calls.join, {
      callId,
      clientId: "device-b",
      takeover: true,
    });

    await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.leave, { callId, clientId: "device-a" });
    const call = await t.withIdentity({ subject: "user-1" }).query(api.calls.get, { callId });
    expect(call?.status).toBe("active");
    expect(call?.participants.map((participant) => participant.userId)).toEqual([
      "user-1",
      "user-2",
    ]);

    await expect(
      t.withIdentity({ subject: "user-1" }).mutation(api.calls.signal, {
        callId,
        clientId: "device-a",
        toUserId: "user-2",
        kind: "offer",
        payload: "v=0",
      }),
    ).rejects.toThrow(/not in this call/);
  });

  it("ignores a heartbeat from the device that no longer holds the seat", async () => {
    const t = await seed({ members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const { callId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a" });
    await t.withIdentity({ subject: "user-1" }).mutation(api.calls.join, {
      callId,
      clientId: "device-b",
      takeover: true,
    });
    await t.run(async (ctx) => {
      const participant = await ctx.db.query("callParticipants").first();
      if (participant !== null) {
        await ctx.db.patch(participant._id, { lastSeen: 1 });
      }
    });

    await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.heartbeat, { callId, clientId: "device-a" });
    const stale = await t.run(async (ctx) => await ctx.db.query("callParticipants").first());
    expect(stale?.lastSeen).toBe(1);

    await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.heartbeat, { callId, clientId: "device-b" });
    const fresh = await t.run(async (ctx) => await ctx.db.query("callParticipants").first());
    expect(fresh?.lastSeen).not.toBe(1);
  });

  it("lets the live device claim a seat that has no client id", async () => {
    const t = await seed({ members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const { callId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a" });
    await t.run(async (ctx) => {
      const participant = await ctx.db.query("callParticipants").first();
      if (participant !== null) {
        const { _id, _creationTime, clientId: _clientId, ...fields } = participant;
        await ctx.db.replace(_id, fields);
      }
    });

    await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.heartbeat, { callId, clientId: "device-a" });
    const claimed = await t.withIdentity({ subject: "user-1" }).query(api.calls.get, { callId });
    expect(claimed?.participants[0]?.clientId).toBe("device-a");

    await expect(
      t.withIdentity({ subject: "user-1" }).mutation(api.calls.join, {
        callId,
        clientId: "device-b",
      }),
    ).rejects.toThrow(/another device/);
  });
});
