import { Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
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
});
