import { GUEST_LINK_GENERIC_ERROR, GUEST_SIGNAL_ACK_MAX, Permission } from "@aulora/core";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { newTest, seedChannel, seedWorkspace, type Test } from "./helpers";

async function patchSettings(t: Test, settings: Record<string, unknown>) {
  await t.run(async (ctx) => {
    const server = await ctx.db.query("server").first();
    if (server !== null) {
      await ctx.db.patch(server._id, { settings: { ...server.settings, ...settings } });
    }
  });
}

async function seedGuestCall(t: Test) {
  await seedWorkspace(t, {
    members: [{ userId: "host", roleIds: ["host"] }],
    extraRoles: [
      {
        key: "host",
        permissions: Permission.CreateGuestLinks | Permission.ManageGuestAccess,
        position: 2,
      },
    ],
  });
  await patchSettings(t, { guestCallsEnabled: true });
  const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
  const { callId } = await t
    .withIdentity({ subject: "host" })
    .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-host" });
  return { channelId, callId };
}

async function createLink(t: Test, channelId: Id<"channels">) {
  return await t
    .withIdentity({ subject: "host" })
    .mutation(api.guestCalls.createLink, { channelId, maxUses: 5 });
}

async function joinAsGuest(
  t: Test,
  token: string,
  name = "Alex Visitor",
  clientId = "guest-device-1",
) {
  return await t.mutation(api.guestCalls.requestJoin, {
    token,
    displayName: name,
    affiliation: "Acme",
    clientId,
  });
}

describe("guest links", () => {
  it("requires the addon and CreateGuestLinks", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "host" }] });
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    await expect(
      t.withIdentity({ subject: "host" }).mutation(api.guestCalls.createLink, { channelId }),
    ).rejects.toThrow(/Guest calls are disabled/);

    await patchSettings(t, { guestCallsEnabled: true });
    await expect(
      t.withIdentity({ subject: "host" }).mutation(api.guestCalls.createLink, { channelId }),
    ).rejects.toThrow(/Missing permission/);
  });

  it("returns every unusable link state as the same generic error", async () => {
    const t = newTest();
    const { channelId } = await seedGuestCall(t);
    const link = await createLink(t, channelId);

    await expect(
      t.query(api.guestCalls.preview, { token: "agu_not-a-real-token" }),
    ).rejects.toThrow(GUEST_LINK_GENERIC_ERROR);

    await t.withIdentity({ subject: "host" }).mutation(api.guestCalls.revokeLink, {
      linkId: link.linkId,
    });
    await expect(t.query(api.guestCalls.preview, { token: link.token })).rejects.toThrow(
      GUEST_LINK_GENERIC_ERROR,
    );
    await expect(joinAsGuest(t, link.token)).rejects.toThrow(GUEST_LINK_GENERIC_ERROR);

    const expired = await createLink(t, channelId);
    await t.run(async (ctx) => {
      await ctx.db.patch(expired.linkId, { expiresAt: Date.now() - 1 });
    });
    await expect(t.query(api.guestCalls.preview, { token: expired.token })).rejects.toThrow(
      GUEST_LINK_GENERIC_ERROR,
    );
  });

  it("counts a use only when a guest is admitted", async () => {
    const t = newTest();
    const { channelId, callId } = await seedGuestCall(t);
    const link = await createLink(t, channelId);
    await t.run(async (ctx) => {
      await ctx.db.patch(link.linkId, { maxUses: 1 });
    });
    const first = await joinAsGuest(t, link.token);
    const pending = await t
      .withIdentity({ subject: "host" })
      .query(api.guestCalls.lobbyList, { callId });
    expect(pending.pending.map((row) => row.displayName)).toContain("Alex Visitor");

    await t.withIdentity({ subject: "host" }).mutation(api.guestCalls.admit, {
      guestSessionId: first.guestSessionId,
    });
    const stored = await t.run(async (ctx) => await ctx.db.get(link.linkId));
    expect(stored?.uses).toBe(1);

    await expect(joinAsGuest(t, link.token, "Second Guest", "guest-device-2")).rejects.toThrow(
      GUEST_LINK_GENERIC_ERROR,
    );
  });
});

describe("guest lobby and isolation", () => {
  it("admits a guest with a Guest badge and never returns member ids", async () => {
    const t = newTest();
    const { channelId, callId } = await seedGuestCall(t);
    const link = await createLink(t, channelId);
    const join = await joinAsGuest(t, link.token);

    await t.withIdentity({ subject: "host" }).mutation(api.guestCalls.admit, {
      guestSessionId: join.guestSessionId,
    });

    const roster = await t.query(api.guestCalls.roster, { sessionToken: join.sessionToken });
    expect(roster.participants).toHaveLength(2);
    expect(roster.participants.some((row) => row.isGuest)).toBe(true);
    expect(JSON.stringify(roster)).not.toContain('"host"');
    expect(roster.participants.every((row) => row.participantKey.length > 0)).toBe(true);
    expect(roster.participants.every((row) => Number.isInteger(row.session))).toBe(true);
    expect(roster.callId).toBe(callId);
    // The guest's own engine identity is its guest session id, so that is the
    // key its roster entry must use.
    expect(roster.participants.find((row) => row.isGuest)?.participantKey).toBe(
      join.guestSessionId,
    );

    const stored = await t.run(async (ctx) => await ctx.db.get(join.guestSessionId));
    expect(stored?.status).toBe("admitted");
  });

  it("has no Convex identity and cannot call member functions", async () => {
    const t = newTest();
    const { channelId } = await seedGuestCall(t);
    const link = await createLink(t, channelId);
    const join = await joinAsGuest(t, link.token);

    await expect(t.query(api.calls.get, { callId: join.callId })).rejects.toThrow(
      /Not authenticated/,
    );
    await expect(
      t.mutation(api.calls.heartbeat, { callId: join.callId, clientId: "guest-device-1" }),
    ).rejects.toThrow(/Not authenticated/);
    await expect(t.query(api.guestCalls.lobby, { sessionToken: "ags_nope" })).rejects.toThrow(
      GUEST_LINK_GENERIC_ERROR,
    );
  });

  it("relays signalling in both directions through opaque keys", async () => {
    const t = newTest();
    const { channelId } = await seedGuestCall(t);
    const link = await createLink(t, channelId);
    const join = await joinAsGuest(t, link.token);
    await t.withIdentity({ subject: "host" }).mutation(api.guestCalls.admit, {
      guestSessionId: join.guestSessionId,
    });
    const roster = await t.query(api.guestCalls.roster, { sessionToken: join.sessionToken });
    const hostKey = roster.participants.find((row) => !row.isGuest)?.participantKey;
    expect(hostKey).toBeDefined();

    await t.mutation(api.guestCalls.signal, {
      sessionToken: join.sessionToken,
      toParticipantKey: hostKey ?? "",
      kind: "offer",
      payload: "v=0",
    });
    const toHost = await t
      .withIdentity({ subject: "host" })
      .query(api.calls.signals, { callId: join.callId });
    expect(toHost).toHaveLength(1);
    expect(toHost[0]?.kind).toBe("offer");

    await t.withIdentity({ subject: "host" }).mutation(api.calls.signal, {
      callId: join.callId,
      clientId: "device-host",
      toUserId: join.guestSessionId,
      kind: "answer",
      payload: "v=1",
    });
    const toGuest = await t.query(api.guestCalls.signals, { sessionToken: join.sessionToken });
    expect(toGuest).toHaveLength(1);
    expect(toGuest[0]?.kind).toBe("answer");
    // A member sender is addressed by the same opaque roster key, never by the
    // member's account id.
    expect(toGuest[0]?.fromParticipantKey).toBe(hostKey);
    expect(JSON.stringify(toGuest)).not.toContain("host");

    // If the sender's seat is gone, the signal is dropped rather than exposing
    // the member account id that `fromUserId` holds internally.
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("callParticipants").take(64);
      for (const row of rows) {
        if (row.callId === join.callId && row.guestId === undefined) {
          await ctx.db.delete(row._id);
        }
      }
    });
    expect(await t.query(api.guestCalls.signals, { sessionToken: join.sessionToken })).toHaveLength(
      0,
    );

    const signalId = toGuest[0]?.id;
    if (signalId !== undefined) {
      await t.mutation(api.guestCalls.ack, {
        sessionToken: join.sessionToken,
        signalIds: [signalId],
      });
      expect(
        await t.query(api.guestCalls.signals, { sessionToken: join.sessionToken }),
      ).toHaveLength(0);
    }
  });

  it("removes a guest and blocks their client id from that link", async () => {
    const t = newTest();
    const { channelId, callId } = await seedGuestCall(t);
    const link = await createLink(t, channelId);
    const join = await joinAsGuest(t, link.token, "Alex Visitor", "guest-device-7");
    await t.withIdentity({ subject: "host" }).mutation(api.guestCalls.admit, {
      guestSessionId: join.guestSessionId,
    });
    await t.withIdentity({ subject: "host" }).mutation(api.guestCalls.remove, {
      guestSessionId: join.guestSessionId,
    });
    const roster = await t.withIdentity({ subject: "host" }).query(api.calls.get, { callId });
    expect(roster?.participants.every((row) => !row.isGuest)).toBe(true);

    await expect(joinAsGuest(t, link.token, "Alex Visitor", "guest-device-7")).rejects.toThrow(
      GUEST_LINK_GENERIC_ERROR,
    );
  });

  it("requires a lobby permission to list or admit", async () => {
    const t = newTest();
    const { channelId, callId } = await seedGuestCall(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", {
        userId: "outsider",
        roleIds: ["@everyone"],
        joinedAt: Date.now(),
      });
    });
    const link = await createLink(t, channelId);
    const join = await joinAsGuest(t, link.token);
    await expect(
      t.withIdentity({ subject: "outsider" }).query(api.guestCalls.lobbyList, { callId }),
    ).rejects.toThrow(/Missing guest-access permission/);
    await expect(
      t
        .withIdentity({ subject: "outsider" })
        .mutation(api.guestCalls.admit, { guestSessionId: join.guestSessionId }),
    ).rejects.toThrow(/Missing guest-access permission/);
  });

  it("reports lobby access without throwing for ordinary participants", async () => {
    const t = newTest();
    const { channelId, callId } = await seedGuestCall(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", {
        userId: "outsider",
        roleIds: ["@everyone"],
        joinedAt: Date.now(),
      });
    });
    const asHost = t.withIdentity({ subject: "host" });
    const asOutsider = t.withIdentity({ subject: "outsider" });
    await createLink(t, channelId);
    expect(await asHost.query(api.guestCalls.lobbyAccess, { callId })).toEqual({
      canManage: true,
    });
    expect(await asOutsider.query(api.guestCalls.lobbyAccess, { callId })).toEqual({
      canManage: false,
    });
    // Guests have no identity, so the query is not reachable for them.
    await expect(t.query(api.guestCalls.lobbyAccess, { callId })).rejects.toThrow();
    await patchSettings(t, { guestCallsEnabled: false });
    expect(await asHost.query(api.guestCalls.lobbyAccess, { callId })).toEqual({
      canManage: false,
    });
  });

  it("hands TURN credentials only to an admitted guest, bound to the guest session", async () => {
    vi.stubEnv("TURN_URLS", "turn:relay.example.com:3478");
    vi.stubEnv("TURN_SECRET", "a-sufficiently-long-shared-secret");
    try {
      const t = newTest();
      const { channelId } = await seedGuestCall(t);
      const link = await createLink(t, channelId);
      const join = await joinAsGuest(t, link.token);
      // Waiting in the lobby: no relay credentials, same generic error as any bad token.
      await expect(
        t.mutation(api.guestCalls.turnCredentials, { sessionToken: join.sessionToken }),
      ).rejects.toThrow(GUEST_LINK_GENERIC_ERROR);
      await t
        .withIdentity({ subject: "host" })
        .mutation(api.guestCalls.admit, { guestSessionId: join.guestSessionId });
      const credentials = await t.mutation(api.guestCalls.turnCredentials, {
        sessionToken: join.sessionToken,
      });
      expect(credentials?.urls).toEqual(["turn:relay.example.com:3478"]);
      expect(credentials?.username).toContain(`guest:${join.guestSessionId}`);
      expect(credentials?.username).not.toContain("host");
      await expect(
        t.mutation(api.guestCalls.turnCredentials, { sessionToken: "ags_forged" }),
      ).rejects.toThrow(GUEST_LINK_GENERIC_ERROR);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns no credentials when the deployment has no relay", async () => {
    vi.stubEnv("TURN_URLS", "");
    vi.stubEnv("TURN_SECRET", "");
    try {
      const t = newTest();
      const { channelId } = await seedGuestCall(t);
      const link = await createLink(t, channelId);
      const join = await joinAsGuest(t, link.token);
      await t
        .withIdentity({ subject: "host" })
        .mutation(api.guestCalls.admit, { guestSessionId: join.guestSessionId });
      expect(
        await t.mutation(api.guestCalls.turnCredentials, { sessionToken: join.sessionToken }),
      ).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps one guest session scoped to its own call", async () => {
    const t = newTest();
    const { channelId, callId } = await seedGuestCall(t);
    const secondChannel = await seedChannel(t, { kind: "voice", name: "Second" });
    const secondCall = await t.withIdentity({ subject: "owner-1" }).mutation(api.calls.start, {
      channelId: secondChannel,
      kind: "voice",
      clientId: "device-owner",
    });
    const firstLink = await createLink(t, channelId);
    const secondLink = await t
      .withIdentity({ subject: "owner-1" })
      .mutation(api.guestCalls.createLink, { channelId: secondChannel });
    const guestA = await joinAsGuest(t, firstLink.token, "Guest A", "guest-aaa");
    const guestB = await joinAsGuest(t, secondLink.token, "Guest B", "guest-bbb");
    await t.withIdentity({ subject: "host" }).mutation(api.guestCalls.admit, {
      guestSessionId: guestA.guestSessionId,
    });
    await t.withIdentity({ subject: "owner-1" }).mutation(api.guestCalls.admit, {
      guestSessionId: guestB.guestSessionId,
    });

    const rosterA = await t.query(api.guestCalls.roster, { sessionToken: guestA.sessionToken });
    const rosterB = await t.query(api.guestCalls.roster, { sessionToken: guestB.sessionToken });
    expect(rosterA.callId).toBe(callId);
    expect(rosterB.callId).toBe(secondCall.callId);
    expect(rosterA.participants.map((row) => row.displayName)).not.toContain("Guest B");

    const bKey = rosterB.participants.find((row) => row.isGuest)?.participantKey ?? "";
    await expect(
      t.mutation(api.guestCalls.signal, {
        sessionToken: guestA.sessionToken,
        toParticipantKey: bKey,
        kind: "offer",
        payload: "v=0",
      }),
    ).rejects.toThrow(/not in this call/);
  });

  it("rejects a banned host at create-link time", async () => {
    const t = newTest();
    const { channelId } = await seedGuestCall(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("bans", {
        userId: "host",
        actorId: "owner-1",
        at: Date.now(),
      });
    });
    await expect(
      t.withIdentity({ subject: "host" }).mutation(api.guestCalls.createLink, { channelId }),
    ).rejects.toThrow(/banned/);
  });

  it("mints a guest audio token only while transcription is active", async () => {
    const previous = process.env.TRANSCRIBER_TOKEN;
    process.env.TRANSCRIBER_TOKEN = "test-transcriber-token";
    try {
      const t = newTest();
      const { channelId, callId } = await seedGuestCall(t);
      const link = await createLink(t, channelId);
      const join = await joinAsGuest(t, link.token);
      await t.withIdentity({ subject: "host" }).mutation(api.guestCalls.admit, {
        guestSessionId: join.guestSessionId,
      });
      await patchSettings(t, { transcriptionEnabled: true });
      await t.run(async (ctx) => {
        await ctx.db.insert("transcriptionConfig", {
          modelId: "base",
          modelStatus: "ready",
          provider: "openrouter",
          baseUrl: "https://openrouter.ai/api/v1",
          model: "openai/gpt-4o-mini",
          retentionDays: 30,
          allowPrivateEndpoint: false,
          updatedAt: Date.now(),
          updatedBy: "host",
        });
      });
      await expect(
        t.mutation(api.guestCalls.mintAudioToken, { sessionToken: join.sessionToken }),
      ).rejects.toThrow(/Transcription is not running/);

      await t.run(async (ctx) => {
        await ctx.db.insert("transcriptionSessions", {
          callId,
          channelId,
          startedBy: "host",
          startedAt: Date.now(),
          status: "active",
          summaryStatus: "none",
          segmentCount: 0,
          lastSeq: 0,
        });
      });
      const minted = await t.mutation(api.guestCalls.mintAudioToken, {
        sessionToken: join.sessionToken,
      });
      expect(minted.token.length).toBeGreaterThan(20);
      expect(minted.wsPath).toBe("/transcribe/");
    } finally {
      if (previous === undefined) {
        delete process.env.TRANSCRIBER_TOKEN;
      } else {
        process.env.TRANSCRIBER_TOKEN = previous;
      }
    }
  });
});

describe("guest lobby and link correctness", () => {
  it("shows new pending requests even after many old denied or removed rows", async () => {
    const t = newTest();
    const { channelId, callId } = await seedGuestCall(t);
    const link = await createLink(t, channelId);
    await t.run(async (ctx) => {
      for (let index = 0; index < 30; index += 1) {
        await ctx.db.insert("callGuestSessions", {
          linkId: link.linkId,
          tokenHash: `old-${index}`,
          displayNameCiphertext: "",
          status: index % 2 === 0 ? "denied" : "removed",
          requestedAt: Date.now() - 60_000,
          callId,
          expiresAt: Date.now() + 60_000,
        });
      }
    });
    const join = await joinAsGuest(t, link.token, "New Guest");
    const lobby = await t
      .withIdentity({ subject: "host" })
      .query(api.guestCalls.lobbyList, { callId });
    expect(lobby.pending.map((row) => row.displayName)).toContain("New Guest");
    expect(lobby.pending.map((row) => row.guestSessionId)).toContain(join.guestSessionId);
  });

  it("counts only active links against the caps, not old revoked rows", async () => {
    const t = newTest();
    const { channelId } = await seedGuestCall(t);
    await t.run(async (ctx) => {
      for (let index = 0; index < 20; index += 1) {
        await ctx.db.insert("callGuestLinks", {
          tokenHash: `revoked-${index}`,
          channelId,
          createdBy: "host",
          createdAt: Date.now() - 120_000,
          expiresAt: Date.now() + 60_000,
          maxUses: 5,
          uses: 0,
          revokedAt: Date.now() - 60_000,
        });
      }
    });
    for (let index = 0; index < 5; index += 1) {
      await createLink(t, channelId);
    }
    await expect(createLink(t, channelId)).rejects.toThrow(/too many active guest links/);
  });

  it("reports an elapsed pending or admitted session as expired without the prune", async () => {
    const t = newTest();
    const { channelId, callId } = await seedGuestCall(t);
    const link = await createLink(t, channelId);
    const pending = await joinAsGuest(t, link.token, "Late Guest");
    await t.run(async (ctx) => {
      await ctx.db.patch(pending.guestSessionId, { expiresAt: Date.now() - 1 });
    });
    expect(
      await t.withIdentity({ subject: "host" }).query(api.guestCalls.lobbyList, { callId }),
    ).toMatchObject({ pending: [] });
    const lobby = await t.query(api.guestCalls.lobby, {
      sessionToken: pending.sessionToken,
    });
    expect(lobby.status).toBe("expired");

    const admitted = await joinAsGuest(t, link.token, "Ended Guest", "guest-ended");
    await t.withIdentity({ subject: "host" }).mutation(api.guestCalls.admit, {
      guestSessionId: admitted.guestSessionId,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(admitted.guestSessionId, { expiresAt: Date.now() - 1 });
    });
    expect(
      (
        await t.query(api.guestCalls.lobby, {
          sessionToken: admitted.sessionToken,
        })
      ).status,
    ).toBe("expired");
  });

  it("lists the newest link even after more than a page of history", async () => {
    const t = newTest();
    const { channelId, callId } = await seedGuestCall(t);
    await t.run(async (ctx) => {
      for (let index = 0; index < 25; index += 1) {
        await ctx.db.insert("callGuestLinks", {
          tokenHash: `history-${index}`,
          channelId,
          createdBy: "host",
          createdAt: Date.now() - 10_000 - index,
          expiresAt: Date.now() + 60_000,
          maxUses: 5,
          uses: 0,
          revokedAt: Date.now() - 5_000,
        });
      }
    });
    const newest = await createLink(t, channelId);
    const listed = await t.withIdentity({ subject: "host" }).query(api.guestCalls.links, {
      callId,
    });
    expect(listed[0]?.id).toBe(newest.linkId);
    await t.withIdentity({ subject: "host" }).mutation(api.guestCalls.revokeLink, {
      linkId: newest.linkId,
    });
    const after = await t.withIdentity({ subject: "host" }).query(api.guestCalls.links, {
      callId,
    });
    expect(after.find((row) => row.id === newest.linkId)?.revoked).toBe(true);
  });

  it("recognises a lobby manager whose matching link is newer than 40 others", async () => {
    const t = newTest();
    const { channelId, callId } = await seedGuestCall(t);
    const otherChannel = await seedChannel(t, { kind: "voice", name: "Other" });
    await t.run(async (ctx) => {
      for (let index = 0; index < 45; index += 1) {
        await ctx.db.insert("callGuestLinks", {
          tokenHash: `other-${index}`,
          channelId: otherChannel,
          createdBy: "host",
          createdAt: Date.now() - 20_000 - index,
          expiresAt: Date.now() + 60_000,
          maxUses: 5,
          uses: 0,
          revokedAt: Date.now() - 10_000,
        });
      }
    });
    await createLink(t, channelId);
    expect(
      await t.withIdentity({ subject: "host" }).query(api.guestCalls.lobbyAccess, { callId }),
    ).toEqual({ canManage: true });
  });

  it("lists and revokes a scheduled call's links from the Scheduled tab", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "host", roleIds: ["host"] }],
      extraRoles: [
        {
          key: "host",
          permissions:
            Permission.CreateGuestLinks |
            Permission.ManageGuestAccess |
            Permission.ScheduleCalls |
            Permission.ViewScheduledCalls |
            Permission.Connect,
          position: 2,
        },
      ],
    });
    await patchSettings(t, { guestCallsEnabled: true, scheduledCallsEnabled: true });
    const channelId = await seedChannel(t, { kind: "voice", name: "Scheduled room" });
    const scheduledCallId = await t
      .withIdentity({ subject: "host" })
      .mutation(api.scheduledCalls.create, {
        title: "Planning",
        startsAt: Date.now() + 30 * 60_000,
        openLeadMinutes: 5,
        inviteeUserIds: ["host"],
        channelId,
      });
    const link = await t
      .withIdentity({ subject: "host" })
      .mutation(api.guestCalls.createLink, { scheduledCallId });
    const stored = await t.run(async (ctx) => await ctx.db.get(link.linkId));
    // A channel-bound scheduled link keeps both targets so the live-call
    // dialog sees it too, while the scheduled window stays authoritative.
    expect(stored?.scheduledCallId).toBe(scheduledCallId);
    expect(stored?.channelId).toBe(channelId);

    const listed = await t
      .withIdentity({ subject: "host" })
      .query(api.guestCalls.links, { scheduledCallId });
    expect(listed.map((row) => row.id)).toContain(link.linkId);
    await t.withIdentity({ subject: "host" }).mutation(api.guestCalls.revokeLink, {
      linkId: link.linkId,
    });
    const after = await t
      .withIdentity({ subject: "host" })
      .query(api.guestCalls.links, { scheduledCallId });
    expect(after.find((row) => row.id === link.linkId)?.revoked).toBe(true);
  });
});

describe("guest admit activates a ringing call", () => {
  it("clears ringing state so the solo-call sweep cannot end it", async () => {
    const t = newTest();
    const { channelId, callId } = await seedGuestCall(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(callId, {
        status: "ringing",
        ringingUserIds: ["host"],
        updatedAt: Date.now(),
      });
    });
    const link = await createLink(t, channelId);
    const join = await joinAsGuest(t, link.token);
    await t.withIdentity({ subject: "host" }).mutation(api.guestCalls.admit, {
      guestSessionId: join.guestSessionId,
    });
    const call = await t.run(async (ctx) => await ctx.db.get(callId));
    expect(call?.status).toBe("active");
    expect(call?.ringingUserIds).toEqual([]);
  });
});

describe("guest privacy and caps", () => {
  it("backfills a legacy member seat so guests never see the account id", async () => {
    const t = newTest();
    const { channelId, callId } = await seedGuestCall(t);
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("callParticipants").take(64);
      for (const row of rows) {
        if (row.callId === callId && row.guestId === undefined) {
          await ctx.db.patch(row._id, { guestKey: undefined });
        }
      }
    });
    const link = await createLink(t, channelId);
    const join = await joinAsGuest(t, link.token);
    await t.withIdentity({ subject: "host" }).mutation(api.guestCalls.admit, {
      guestSessionId: join.guestSessionId,
    });
    const roster = await t.query(api.guestCalls.roster, { sessionToken: join.sessionToken });
    const member = roster.participants.find((row) => !row.isGuest);
    expect(member?.participantKey).not.toBe("host");
    expect(JSON.stringify(roster)).not.toContain('"host"');

    await t.withIdentity({ subject: "host" }).mutation(api.calls.signal, {
      callId,
      clientId: "device-host",
      toUserId: join.guestSessionId,
      kind: "offer",
      payload: "v=0",
    });
    const signals = await t.query(api.guestCalls.signals, {
      sessionToken: join.sessionToken,
    });
    expect(JSON.stringify(signals)).not.toContain('"host"');
    expect(signals[0]?.fromParticipantKey).toBe(member?.participantKey);
  });

  it("caps signalling acknowledgements per request", async () => {
    const t = newTest();
    const { channelId } = await seedGuestCall(t);
    const link = await createLink(t, channelId);
    const join = await joinAsGuest(t, link.token);
    await t.withIdentity({ subject: "host" }).mutation(api.guestCalls.admit, {
      guestSessionId: join.guestSessionId,
    });
    await t.withIdentity({ subject: "host" }).mutation(api.calls.signal, {
      callId: join.callId,
      clientId: "device-host",
      toUserId: join.guestSessionId,
      kind: "offer",
      payload: "v=0",
    });
    const [signal] = await t.query(api.guestCalls.signals, {
      sessionToken: join.sessionToken,
    });
    expect(signal).toBeDefined();
    if (signal === undefined) {
      throw new Error("expected a queued signal");
    }
    const signalId = signal.id;
    await expect(
      t.mutation(api.guestCalls.ack, {
        sessionToken: join.sessionToken,
        signalIds: Array.from({ length: 33 }, () => signalId),
      }),
    ).rejects.toThrow(/Too many signalling acknowledgements/);
  });

  it("does not count expired admitted sessions against the guest cap", async () => {
    const t = newTest();
    const { channelId, callId } = await seedGuestCall(t);
    const link = await createLink(t, channelId);
    await t.run(async (ctx) => {
      for (let index = 0; index < 8; index += 1) {
        await ctx.db.insert("callGuestSessions", {
          linkId: link.linkId,
          tokenHash: `expired-admitted-${index}`,
          displayNameCiphertext: "",
          status: "admitted",
          requestedAt: Date.now() - 20_000,
          callId,
          expiresAt: Date.now() - 1,
        });
      }
    });
    const join = await joinAsGuest(t, link.token, "Ninth Guest");
    await expect(
      t.withIdentity({ subject: "host" }).mutation(api.guestCalls.admit, {
        guestSessionId: join.guestSessionId,
      }),
    ).resolves.toMatchObject({ callId });
  });
});

describe("guest offer election", () => {
  // Verbatim copy of the predicate mobile and older member clients evaluate.
  function mobileShouldOffer(selfUserId: string, remoteUserId: string): boolean {
    return selfUserId < remoteUserId;
  }

  async function seatedPair(t: Test) {
    const { channelId } = await seedGuestCall(t);
    const link = await createLink(t, channelId);
    const first = await joinAsGuest(t, link.token, "Guest One", "guest-device-1");
    const second = await joinAsGuest(t, link.token, "Guest Two", "guest-device-2");
    await t.withIdentity({ subject: "host" }).mutation(api.guestCalls.admit, {
      guestSessionId: first.guestSessionId,
    });
    await t.withIdentity({ subject: "host" }).mutation(api.guestCalls.admit, {
      guestSessionId: second.guestSessionId,
    });
    return { first, second };
  }

  it("gives the guest the complement of the member's account-id predicate", async () => {
    const t = newTest();
    const { first } = await seatedPair(t);
    const guestId = first.guestSessionId as string;
    const memberRow = await t.run(async (ctx) => {
      const rows = await ctx.db.query("callParticipants").take(64);
      return rows.find((row) => row.guestId === undefined) ?? null;
    });
    expect(memberRow).not.toBeNull();
    if (memberRow === null) return;

    // Deterministic pseudo-random ids, like the account ids and guest session
    // ids production mixes. The first two are the orderings that broke the old
    // account-id vs opaque-key scheme: M > G > K (both sides said no) and
    // M < G < K (both sides said yes).
    let seed = 0x2f6e2b1;
    const randomId = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed.toString(36);
    };
    const cases = [
      { memberId: `~${guestId}`, guestKey: `!${guestId}` },
      { memberId: `!${guestId}`, guestKey: `~${guestId}` },
      ...Array.from({ length: 40 }, () => ({
        memberId: randomId(),
        guestKey: randomId(),
      })),
    ];
    for (const entry of cases) {
      await t.run(async (ctx) => {
        await ctx.db.patch(memberRow._id, {
          userId: entry.memberId,
          guestKey: entry.guestKey,
        });
      });
      const roster = await t.query(api.guestCalls.roster, {
        sessionToken: first.sessionToken,
      });
      const member = roster.participants.find((row) => !row.isGuest);
      expect(member?.shouldOffer).toBe(!mobileShouldOffer(entry.memberId, guestId));
      expect(JSON.stringify(roster)).not.toContain(entry.memberId);
    }
  });

  it("omits the bit for guest rows and keeps guest-guest election complementary", async () => {
    const t = newTest();
    const { first, second } = await seatedPair(t);
    const roster = await t.query(api.guestCalls.roster, {
      sessionToken: first.sessionToken,
    });
    const guestRows = roster.participants.filter((row) => row.isGuest);
    expect(guestRows).toHaveLength(2);
    for (const row of guestRows) {
      expect(row.shouldOffer).toBeUndefined();
    }
    const a = first.guestSessionId as string;
    const b = second.guestSessionId as string;
    expect(mobileShouldOffer(a, b)).not.toBe(mobileShouldOffer(b, a));
    let seed = 0x51ab3d;
    for (let index = 0; index < 40; index += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const other = seed.toString(36);
      // Guests elect among themselves with their own session ids, so the same
      // predicate must be complementary in both directions.
      expect(mobileShouldOffer(a, other)).not.toBe(mobileShouldOffer(other, a));
    }
  });
});

describe("scheduled guest link ownership", () => {
  it("lets a CreateGuestLinks invitee manage only their own links", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [
        { userId: "host", roleIds: ["host"] },
        { userId: "invitee", roleIds: ["invitee"] },
      ],
      extraRoles: [
        {
          key: "host",
          permissions:
            Permission.CreateGuestLinks |
            Permission.ManageGuestAccess |
            Permission.ScheduleCalls |
            Permission.ViewScheduledCalls |
            Permission.Connect,
          position: 3,
        },
        {
          key: "invitee",
          permissions: Permission.CreateGuestLinks | Permission.Connect,
          position: 2,
        },
      ],
    });
    await patchSettings(t, { guestCallsEnabled: true, scheduledCallsEnabled: true });
    const scheduledId = await t
      .withIdentity({ subject: "host" })
      .mutation(api.scheduledCalls.create, {
        title: "Own links",
        startsAt: Date.now() + 60_000,
        openLeadMinutes: 5,
        inviteeUserIds: ["invitee"],
      });

    const invitee = t.withIdentity({ subject: "invitee" });
    const host = t.withIdentity({ subject: "host" });
    const own = await invitee.mutation(api.guestCalls.createLink, {
      scheduledCallId: scheduledId,
      maxUses: 2,
    });
    const theirs = await host.mutation(api.guestCalls.createLink, {
      scheduledCallId: scheduledId,
      maxUses: 2,
    });

    // Before the room is live, the invitee can still find the link they made
    // without ManageGuestAccess or ManageScheduledCalls.
    const listed = await invitee.query(api.guestCalls.links, { scheduledCallId: scheduledId });
    expect(listed.map((row) => row.id)).toEqual([own.linkId]);

    await invitee.mutation(api.guestCalls.revokeLink, { linkId: own.linkId });
    // Someone else's link stays invisible and unrevokable.
    await expect(
      invitee.mutation(api.guestCalls.revokeLink, { linkId: theirs.linkId }),
    ).rejects.toThrow(/cannot revoke/);
  });
});

describe("guest lobby terminal status", () => {
  it("stops waiting once the call has ended", async () => {
    const t = newTest();
    const { channelId, callId } = await seedGuestCall(t);
    const link = await createLink(t, channelId);
    const join = await joinAsGuest(t, link.token);
    expect((await t.query(api.guestCalls.lobby, { sessionToken: join.sessionToken })).status).toBe(
      "pending",
    );

    await t.withIdentity({ subject: "host" }).mutation(api.calls.end, { callId });
    // `left` is the existing terminal status the guest page renders as
    // "The call has ended"; the lobby must not keep the guest waiting.
    expect((await t.query(api.guestCalls.lobby, { sessionToken: join.sessionToken })).status).toBe(
      "left",
    );
  });
});

describe("guest call solo timer", () => {
  it("clears the host's solo deadline on admit and re-arms a fresh window on leave", async () => {
    const t = newTest();
    const { channelId, callId } = await seedGuestCall(t);
    const host = t.withIdentity({ subject: "host" });
    const before = await host.query(api.calls.get, { callId });
    expect(before?.aloneDeadline).not.toBeNull();

    const link = await createLink(t, channelId);
    const join = await joinAsGuest(t, link.token);
    await host.mutation(api.guestCalls.admit, { guestSessionId: join.guestSessionId });

    // A guest is a distinct participant: the host is not alone while seated.
    const during = await host.query(api.calls.get, { callId });
    expect(during?.aloneDeadline).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 5));
    await t.mutation(api.guestCalls.leave, { sessionToken: join.sessionToken });
    const after = await host.query(api.calls.get, { callId });
    expect(after?.aloneDeadline).not.toBeNull();
    expect(after?.aloneDeadline ?? 0).toBeGreaterThan(before?.aloneDeadline ?? 0);
  });

  it("survives the stale solo job armed before the guest was admitted", async () => {
    const t = newTest();
    const { channelId, callId } = await seedGuestCall(t);
    const host = t.withIdentity({ subject: "host" });
    const stale = (await host.query(api.calls.get, { callId }))?.aloneDeadline ?? 0;
    expect(stale).toBeGreaterThan(0);

    const link = await createLink(t, channelId);
    const join = await joinAsGuest(t, link.token);
    await host.mutation(api.guestCalls.admit, { guestSessionId: join.guestSessionId });
    await t.mutation(api.guestCalls.leave, { sessionToken: join.sessionToken });

    // The job from the pre-guest window fires late; it must not end a call
    // whose solo window has since been re-armed.
    await t.mutation(internal.calls.enforceAlone, { callId, deadline: stale });
    const call = await host.query(api.calls.get, { callId });
    expect(call?.status).toBe("active");
    expect(call?.aloneDeadline).not.toBeNull();
    expect(call?.aloneDeadline).not.toBe(stale);
  });
});

describe("guest signal acknowledgement batching", () => {
  async function queueSignals(
    t: Test,
    join: { callId: Id<"calls">; guestSessionId: Id<"callGuestSessions"> },
  ) {
    for (let batch = 0; batch < 2; batch += 1) {
      await t.withIdentity({ subject: "host" }).mutation(api.calls.signal, {
        callId: join.callId,
        clientId: "device-host",
        toUserId: join.guestSessionId,
        kind: "ice",
        payloads: Array.from({ length: 32 }, (_, index) => `candidate-${batch}-${index}`),
      });
    }
  }

  async function admittedGuest(t: Test) {
    const { channelId } = await seedGuestCall(t);
    const link = await createLink(t, channelId);
    const join = await joinAsGuest(t, link.token);
    await t.withIdentity({ subject: "host" }).mutation(api.guestCalls.admit, {
      guestSessionId: join.guestSessionId,
    });
    return join;
  }

  it("deletes all 64 signals when the client chunks acks by GUEST_SIGNAL_ACK_MAX", async () => {
    const t = newTest();
    const join = await admittedGuest(t);
    await queueSignals(t, join);
    const all = await t.query(api.guestCalls.signals, { sessionToken: join.sessionToken });
    expect(all).toHaveLength(64);

    for (let start = 0; start < all.length; start += GUEST_SIGNAL_ACK_MAX) {
      await t.mutation(api.guestCalls.ack, {
        sessionToken: join.sessionToken,
        signalIds: all.slice(start, start + GUEST_SIGNAL_ACK_MAX).map((row) => row.id),
      });
    }
    expect(await t.query(api.guestCalls.signals, { sessionToken: join.sessionToken })).toHaveLength(
      0,
    );
  });

  it("still rejects a single ack above the cap", async () => {
    const t = newTest();
    const join = await admittedGuest(t);
    await queueSignals(t, join);
    const all = await t.query(api.guestCalls.signals, { sessionToken: join.sessionToken });
    expect(all).toHaveLength(64);
    await expect(
      t.mutation(api.guestCalls.ack, {
        sessionToken: join.sessionToken,
        signalIds: all.map((row) => row.id),
      }),
    ).rejects.toThrow(/Too many signalling acknowledgements/);
  });
});

describe("guest participation gate", () => {
  it("stops a banned host from reading names, ejecting guests or minting audio", async () => {
    const previous = process.env.TRANSCRIBER_TOKEN;
    process.env.TRANSCRIBER_TOKEN = "test-transcriber-token";
    try {
      const t = newTest();
      const { channelId, callId } = await seedGuestCall(t);
      const link = await createLink(t, channelId);
      const join = await joinAsGuest(t, link.token);
      await t.withIdentity({ subject: "host" }).mutation(api.guestCalls.admit, {
        guestSessionId: join.guestSessionId,
      });
      const waiting = await joinAsGuest(t, link.token, "Waiting Guest", "guest-waiting");
      await patchSettings(t, { transcriptionEnabled: true });
      await t.run(async (ctx) => {
        await ctx.db.insert("transcriptionSessions", {
          callId,
          channelId,
          startedBy: "host",
          startedAt: Date.now(),
          status: "active",
          summaryStatus: "none",
          segmentCount: 0,
          lastSeq: 0,
        });
        await ctx.db.insert("bans", { userId: "host", actorId: "owner-1", at: Date.now() });
      });
      const asHost = t.withIdentity({ subject: "host" });
      await expect(asHost.query(api.guestCalls.lobbyList, { callId })).rejects.toThrow(
        /cannot participate/,
      );
      await expect(asHost.query(api.guestCalls.links, { callId })).rejects.toThrow(
        /cannot participate/,
      );
      await expect(
        asHost.mutation(api.guestCalls.remove, { guestSessionId: join.guestSessionId }),
      ).rejects.toThrow(/banned/);
      await expect(
        asHost.mutation(api.guestCalls.deny, { guestSessionId: waiting.guestSessionId }),
      ).rejects.toThrow(/banned/);
      await expect(asHost.query(api.guestCalls.lobbyAccess, { callId })).resolves.toEqual({
        canManage: false,
      });
      const session = await t.run(
        async (ctx) => await ctx.db.query("transcriptionSessions").first(),
      );
      await expect(
        asHost.mutation(api.transcription.mintAudioTokenForCall, {
          sessionId: session?._id as never,
        }),
      ).rejects.toThrow(/banned/);
    } finally {
      if (previous === undefined) delete process.env.TRANSCRIBER_TOKEN;
      else process.env.TRANSCRIBER_TOKEN = previous;
    }
  });

  it("treats a timed-out host as unable to manage the lobby", async () => {
    const t = newTest();
    const { channelId, callId } = await seedGuestCall(t);
    await createLink(t, channelId);
    await t.run(async (ctx) => {
      const members = await ctx.db.query("members").take(64);
      const member = members.find((row) => row.userId === "host");
      if (member !== undefined) {
        await ctx.db.patch(member._id, { timeoutUntil: Date.now() + 60_000 });
      }
    });
    const asHost = t.withIdentity({ subject: "host" });
    await expect(asHost.query(api.guestCalls.lobbyList, { callId })).rejects.toThrow(
      /cannot participate/,
    );
    await expect(asHost.query(api.guestCalls.lobbyAccess, { callId })).resolves.toEqual({
      canManage: false,
    });
  });
});

describe("guest session cleanup", () => {
  it("marks expired admitted guests as left", async () => {
    const t = newTest();
    const { channelId } = await seedGuestCall(t);
    const link = await createLink(t, channelId);
    const join = await joinAsGuest(t, link.token);
    await t.withIdentity({ subject: "host" }).mutation(api.guestCalls.admit, {
      guestSessionId: join.guestSessionId,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(join.guestSessionId, { expiresAt: Date.now() - 1 });
    });
    await t.mutation(internal.guestCalls.pruneExpired, {});
    const stored = await t.run(async (ctx) => await ctx.db.get(join.guestSessionId));
    expect(stored?.status).toBe("left");
  });
});

describe("guest link token shape", () => {
  it("mints tokens that the shared well-formed check accepts", async () => {
    const { isWellFormedGuestToken, GUEST_LINK_TOKEN_PREFIX, GUEST_SESSION_TOKEN_PREFIX } =
      await import("@aulora/core");
    const { newGuestLinkToken, newGuestSessionToken } = await import("../convex/lib/guestCalls");
    expect(isWellFormedGuestToken(newGuestLinkToken(), GUEST_LINK_TOKEN_PREFIX)).toBe(true);
    expect(isWellFormedGuestToken(newGuestSessionToken(), GUEST_SESSION_TOKEN_PREFIX)).toBe(true);
  });
});
