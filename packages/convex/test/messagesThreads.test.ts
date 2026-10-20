import { Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { isSealed } from "../convex/lib/sse";
import { newTest, seedChannel, seedWorkspace } from "./helpers";

const PAGE = { numItems: 10, cursor: null } as const;

describe("messages.threadInbox", () => {
  it("returns a thread the viewer replied in, with the root body opened as plaintext", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t);
    const asUser1 = t.withIdentity({ subject: "user-1" });
    const asUser2 = t.withIdentity({ subject: "user-2" });

    const root = await asUser1.mutation(api.messages.send, { channelId, body: "cm9vdA==" });
    await asUser2.mutation(api.messages.send, {
      channelId,
      body: "cmVwbHk=",
      threadRootId: root,
    });

    const rows = await asUser2.query(api.messages.threadInbox, {});
    expect(rows.map((row) => row.id)).toEqual([root]);
    expect(rows[0]?.body).toBe("cm9vdA==");
    expect(rows[0]?.viewerParticipated).toBe(true);
    expect(rows[0]?.viewerMentioned).toBe(false);
    expect(rows[0]?.participantIds).toEqual(["user-2"]);
    expect(rows[0]?.replyCount).toBe(1);
    expect(rows[0]?.lastReplyAt).toBeTypeOf("number");

    // The stored root is sealed; the query never returns the ciphertext.
    const stored = await t.run(async (ctx) => await ctx.db.get(root));
    expect(isSealed(stored?.ciphertext ?? "")).toBe(true);
    expect(rows[0]?.body).not.toContain("aulora-sse-");
  });

  it("returns a thread where the viewer is only mentioned in a reply", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t);
    const asUser1 = t.withIdentity({ subject: "user-1" });
    const asUser2 = t.withIdentity({ subject: "user-2" });

    const root = await asUser1.mutation(api.messages.send, { channelId, body: "cm9vdA==" });
    await asUser1.mutation(api.messages.send, {
      channelId,
      body: "aGk=",
      threadRootId: root,
      mentionUserIds: ["user-2"],
    });

    const rows = await asUser2.query(api.messages.threadInbox, {});
    expect(rows.map((row) => row.id)).toEqual([root]);
    expect(rows[0]?.viewerMentioned).toBe(true);
    expect(rows[0]?.viewerParticipated).toBe(false);
    expect(rows[0]?.mentionedUserIds).toEqual(["user-2"]);
  });

  it("returns a thread where the viewer is only mentioned in the root", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t);
    const asUser1 = t.withIdentity({ subject: "user-1" });
    const asUser2 = t.withIdentity({ subject: "user-2" });

    const root = await asUser1.mutation(api.messages.send, {
      channelId,
      body: "cm9vdA==",
      mentionUserIds: ["user-2"],
    });
    await asUser1.mutation(api.messages.send, { channelId, body: "aGk=", threadRootId: root });

    const rows = await asUser2.query(api.messages.threadInbox, {});
    expect(rows.map((row) => row.id)).toEqual([root]);
    expect(rows[0]?.viewerMentioned).toBe(true);
    expect(rows[0]?.viewerParticipated).toBe(false);
  });

  it("omits threads the viewer neither replied in nor was mentioned in", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1" }, { userId: "user-2" }, { userId: "user-3" }],
    });
    const channelId = await seedChannel(t);
    const asUser1 = t.withIdentity({ subject: "user-1" });
    const asUser2 = t.withIdentity({ subject: "user-2" });
    const asUser3 = t.withIdentity({ subject: "user-3" });

    const root = await asUser1.mutation(api.messages.send, { channelId, body: "cm9vdA==" });
    await asUser3.mutation(api.messages.send, {
      channelId,
      body: "cmVwbHk=",
      threadRootId: root,
    });

    const rows = await asUser2.query(api.messages.threadInbox, {});
    expect(rows).toHaveLength(0);
  });

  it("sorts threads by most recent activity, newest first", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });

    const olderRoot = await asUser.mutation(api.messages.send, { channelId, body: "b2xkZXI=" });
    await asUser.mutation(api.messages.send, {
      channelId,
      body: "b2xkLXJlcGx5",
      threadRootId: olderRoot,
    });

    const newerRoot = await asUser.mutation(api.messages.send, { channelId, body: "bmV3ZXI=" });
    await asUser.mutation(api.messages.send, {
      channelId,
      body: "bmV3LXJlcGx5",
      threadRootId: newerRoot,
    });

    const rows = await asUser.query(api.messages.threadInbox, {});
    expect(rows.map((row) => row.id)).toEqual([newerRoot, olderRoot]);
    expect(rows[0]?.lastReplyAt ?? 0).toBeGreaterThanOrEqual(rows[1]?.lastReplyAt ?? 0);
  });

  it("reads from the participant index and caps the response at 50 threads", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    const rootIds = await t.run(async (ctx) => {
      const ids: Id<"messages">[] = [];
      for (let i = 0; i < 60; i += 1) {
        const rootId = await ctx.db.insert("messages", {
          channelId,
          authorId: "user-1",
          ciphertext: "cm9vdA==",
          attachmentIds: [],
          mentionUserIds: [],
          replyCount: 1,
          lastReplyAt: i,
        });
        // A reply by the viewer is what makes them a participant.
        await ctx.db.insert("messages", {
          channelId,
          authorId: "user-1",
          ciphertext: "cmVwbHk=",
          attachmentIds: [],
          mentionUserIds: [],
          threadRootId: rootId,
        });
        // The participant row is what the inbox now reads from; no global
        // messages scan is involved.
        await ctx.db.insert("threadParticipants", {
          userId: "user-1",
          threadRootId: rootId,
          channelId,
          lastReplyAt: i,
          mentioned: false,
        });
        ids.push(rootId);
      }
      return ids;
    });

    const asUser = t.withIdentity({ subject: "user-1" });
    const rows = await asUser.query(api.messages.threadInbox, {});
    expect(rows).toHaveLength(50);
    // The most recently active thread (highest lastReplyAt) sorts first.
    expect(rows[0]?.id).toBe(rootIds[59]);
  });
});

describe("messages pins", () => {
  async function setup() {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions:
        Permission.ViewChannel | Permission.SendMessages | Permission.ReadHistory,
      extraRoles: [{ key: "pinner", permissions: Permission.ViewChannel | Permission.PinMessages }],
      members: [{ userId: "user-1" }, { userId: "pinner-user", roleIds: ["pinner"] }],
    });
    const channelId = await seedChannel(t);
    const asUser1 = t.withIdentity({ subject: "user-1" });
    const messageId = await asUser1.mutation(api.messages.send, {
      channelId,
      body: "cGluLW1l",
    });
    return { t, channelId, messageId };
  }

  it("pins and unpins with PinMessages and lists pins", async () => {
    const { t, channelId, messageId } = await setup();
    const asPinner = t.withIdentity({ subject: "pinner-user" });
    await asPinner.mutation(api.messages.pin, { messageId });

    const pins = await asPinner.query(api.messages.listPins, {
      channelId,
      paginationOpts: PAGE,
    });
    expect(pins.page.map((m) => m.id)).toContain(messageId);
    expect(pins.page[0]?.body).toBe("cGluLW1l");

    await asPinner.mutation(api.messages.unpin, { messageId });
    const after = await asPinner.query(api.messages.listPins, {
      channelId,
      paginationOpts: PAGE,
    });
    expect(after.page).toHaveLength(0);
  });

  it("refuses pin without PinMessages", async () => {
    const { t, messageId } = await setup();
    const asUser1 = t.withIdentity({ subject: "user-1" });
    await expect(asUser1.mutation(api.messages.pin, { messageId })).rejects.toThrow(
      "Missing permission",
    );
  });

  it("posts a quiet pin notice once and never on unpin", async () => {
    const { t, channelId, messageId } = await setup();
    const asPinner = t.withIdentity({ subject: "pinner-user" });

    await asPinner.mutation(api.messages.pin, { messageId });
    const timeline = await asPinner.query(api.messages.list, { channelId, paginationOpts: PAGE });
    const notices = timeline.page.filter((message) => message.systemKind === "pin");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      systemActorId: "pinner-user",
      systemTargetId: messageId,
      body: "",
    });
    // The pinned message is still in the timeline alongside the notice.
    expect(timeline.page.some((message) => message.id === messageId)).toBe(true);

    // Pinning again is a no-op and unpinning never posts another notice.
    await asPinner.mutation(api.messages.pin, { messageId });
    await asPinner.mutation(api.messages.unpin, { messageId });
    const after = await asPinner.query(api.messages.list, { channelId, paginationOpts: PAGE });
    expect(after.page.filter((message) => message.systemKind === "pin")).toHaveLength(1);
    expect(
      after.page.some((message) => message.id === messageId && message.pinnedAt !== null),
    ).toBe(false);
  });
});

describe("messages.threadInbox bounded reply scan", () => {
  it("keeps a thread whose participation row is beyond the scanned replies", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t);
    const asUser1 = t.withIdentity({ subject: "user-1" });
    const asUser2 = t.withIdentity({ subject: "user-2" });
    const root = await asUser1.mutation(api.messages.send, { channelId, body: "cm9vdA==" });
    await t.run(async (ctx) => {
      for (let index = 0; index < 201; index += 1) {
        await ctx.db.insert("messages", {
          channelId,
          authorId: "user-1",
          ciphertext: "aulora-sse-v1:opaque",
          attachmentIds: [],
          mentionUserIds: [],
          threadRootId: root,
        });
      }
      await ctx.db.patch(root, { replyCount: 201, lastReplyAt: Date.now() });
      await ctx.db.insert("threadParticipants", {
        userId: "user-2",
        threadRootId: root,
        channelId,
        lastReplyAt: Date.now(),
        mentioned: true,
        participated: true,
      });
    });

    const rows = await asUser2.query(api.messages.threadInbox, {});
    const row = rows.find((entry) => entry.id === root);
    expect(row).toBeDefined();
    expect(row?.viewerParticipated).toBe(true);
    expect(row?.viewerMentioned).toBe(true);
  });
});
