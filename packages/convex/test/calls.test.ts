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
      .mutation(api.calls.start, { channelId, kind: "voice" });
    expect(first.created).toBe(true);

    const second = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId, kind: "voice" });
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
      t.withIdentity({ subject: "user-1" }).mutation(api.calls.start, { channelId, kind: "voice" }),
    ).rejects.toThrow(/voice channels and direct messages/);
  });

  it("honours the workspace voice/video switches", async () => {
    const t = await seed({ members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    await patchSettings(t, { voiceEnabled: false });
    await expect(
      t.withIdentity({ subject: "user-1" }).mutation(api.calls.start, { channelId, kind: "voice" }),
    ).rejects.toThrow(/disabled/);

    await patchSettings(t, { voiceEnabled: true, videoEnabled: false });
    await expect(
      t.withIdentity({ subject: "user-1" }).mutation(api.calls.start, { channelId, kind: "video" }),
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
      .mutation(api.calls.start, { channelId, kind: "voice" });

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
      .mutation(api.calls.start, { channelId, kind: "voice" });

    await t.withIdentity({ subject: "user-2" }).mutation(api.calls.join, { callId });
    let call = await t.withIdentity({ subject: "user-1" }).query(api.calls.get, { callId });
    expect(call?.status).toBe("active");
    expect(call?.participants).toHaveLength(2);

    await t.withIdentity({ subject: "user-1" }).mutation(api.calls.leave, { callId });
    call = await t.withIdentity({ subject: "user-2" }).query(api.calls.get, { callId });
    expect(call?.participants).toHaveLength(1);

    await t.withIdentity({ subject: "user-2" }).mutation(api.calls.leave, { callId });
    call = await t.withIdentity({ subject: "user-2" }).query(api.calls.get, { callId });
    expect(call?.status).toBe("ended");
  });

  it("decline removes the caller from the ring", async () => {
    const t = await seed({ members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t, { kind: "dm", memberIds: ["user-1", "user-2"] });
    const { callId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId, kind: "voice" });

    await t.withIdentity({ subject: "user-2" }).mutation(api.calls.decline, { callId });
    const incoming = await t.withIdentity({ subject: "user-2" }).query(api.calls.incoming, {});
    expect(incoming).toHaveLength(0);
  });

  it("relays and acks signalling in both directions", async () => {
    const t = await seed({ members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const { callId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId, kind: "voice" });
    await t.withIdentity({ subject: "user-2" }).mutation(api.calls.join, { callId });

    await t.withIdentity({ subject: "user-1" }).mutation(api.calls.signal, {
      callId,
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
      .mutation(api.calls.start, { channelId, kind: "voice" });

    await expect(
      t.withIdentity({ subject: "user-1" }).mutation(api.calls.updateParticipant, {
        callId,
        video: true,
      }),
    ).rejects.toThrow(/camera/);
    await expect(
      t.withIdentity({ subject: "user-1" }).mutation(api.calls.updateParticipant, {
        callId,
        sharingScreen: true,
      }),
    ).rejects.toThrow(/share your screen/);
  });

  it("keeps one screen sharer and clears it when they stop", async () => {
    const t = await seed({ members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const { callId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId, kind: "voice" });
    await t.withIdentity({ subject: "user-2" }).mutation(api.calls.join, { callId });

    await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.updateParticipant, { callId, sharingScreen: true });
    await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.calls.updateParticipant, { callId, sharingScreen: true });

    let call = await t.withIdentity({ subject: "user-1" }).query(api.calls.get, { callId });
    expect(call?.screenShareUserId).toBe("user-2");
    expect(call?.participants.filter((p) => p.sharingScreen)).toHaveLength(1);

    await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.calls.updateParticipant, { callId, sharingScreen: false });
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
      .mutation(api.calls.start, { channelId, kind: "voice" });

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
      .mutation(api.calls.start, { channelId, kind: "voice" });

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
      .mutation(api.calls.start, { channelId, kind: "voice" });
    await t.withIdentity({ subject: "user-2" }).mutation(api.calls.join, { callId });

    await expect(
      t.withIdentity({ subject: "user-1" }).mutation(api.calls.signal, {
        callId,
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
      ringingUserIds: ["user-2", "stranger"],
    });
    const call = await t.run(async (ctx) => await ctx.db.get(callId));
    expect(call?.ringingUserIds).toEqual(["user-2"]);
  });
});
