import { Permission } from "@aulora/core";
import { afterEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { isSealed, openString } from "../convex/lib/sse";
import { newTest, seedChannel, seedWorkspace } from "./helpers";

const PAGE = { numItems: 10, cursor: null } as const;

afterEach(() => {
  delete process.env.SEND_RATE_LIMIT;
});

function bodyContext(channelId: string) {
  return { scope: "message", recordId: channelId };
}

describe("messages.send and list", () => {
  it("seals the body at rest and pages backwards from the newest message", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });

    for (let i = 0; i < 3; i += 1) {
      await asUser.mutation(api.messages.send, { channelId, body: `Y2lwaGVyLXRleHQt${i}` });
    }

    // The first page is the live tail, rendered oldest first, in plaintext.
    const first = await asUser.query(api.messages.list, {
      channelId,
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(first.page.map((m) => m.body)).toEqual(["Y2lwaGVyLXRleHQt1", "Y2lwaGVyLXRleHQt2"]);
    expect(first.isDone).toBe(false);

    // The continuation cursor walks into older history.
    const second = await asUser.query(api.messages.list, {
      channelId,
      paginationOpts: { numItems: 2, cursor: first.continueCursor },
    });
    expect(second.page.map((m) => m.body)).toEqual(["Y2lwaGVyLXRleHQt0"]);
    expect(second.isDone).toBe(true);

    // The stored row is a sealed envelope, not the plaintext.
    const rows = await t.run(async (ctx) =>
      (await ctx.db.query("messages").collect()).filter((row) => row.channelId === channelId),
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(isSealed(row.ciphertext)).toBe(true);
      expect(row.ciphertext).not.toContain("Y2lwaGVy");
    }
    await expect(openString(bodyContext(channelId), rows[0]?.ciphertext ?? "")).resolves.toBe(
      "Y2lwaGVyLXRleHQt0",
    );
  });

  it("lists only root messages oldest-first and pages into older history", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });

    const oldest = await asUser.mutation(api.messages.send, { channelId, body: "b2xkZXN0" });
    const middle = await asUser.mutation(api.messages.send, { channelId, body: "bWlkZGxl" });
    const root = await asUser.mutation(api.messages.send, { channelId, body: "cm9vdA==" });
    const reply = await asUser.mutation(api.messages.send, {
      channelId,
      body: "cmVwbHk=",
      threadRootId: root,
    });

    const first = await asUser.query(api.messages.list, {
      channelId,
      paginationOpts: { numItems: 2, cursor: null },
    });
    // Oldest-first within the page, and the thread reply is never a root row.
    expect(first.page.map((m) => m.id)).toEqual([middle, root]);
    expect(first.page.map((m) => m.body)).toEqual(["bWlkZGxl", "cm9vdA=="]);
    expect(first.isDone).toBe(false);

    // The continuation cursor walks into older root history.
    const second = await asUser.query(api.messages.list, {
      channelId,
      paginationOpts: { numItems: 2, cursor: first.continueCursor },
    });
    expect(second.page.map((m) => m.id)).toEqual([oldest]);
    expect(second.isDone).toBe(true);
    expect(second.page.some((m) => m.id === reply)).toBe(false);
  });

  it("keeps showing new messages once a channel outgrows one page", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });

    for (let i = 0; i < 12; i += 1) {
      await asUser.mutation(api.messages.send, { channelId, body: `m${i}` });
    }
    const page = await asUser.query(api.messages.list, { channelId, paginationOpts: PAGE });
    expect(page.page).toHaveLength(10);
    expect(page.page.at(-1)?.body).toBe("m11");
    expect(page.page[0]?.body).toBe("m2");
  });

  it("does not let thread replies crowd roots out of a page", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });

    const older = await asUser.mutation(api.messages.send, { channelId, body: "older" });
    const root = await asUser.mutation(api.messages.send, { channelId, body: "root" });
    for (let i = 0; i < 5; i += 1) {
      await asUser.mutation(api.messages.send, {
        channelId,
        body: `reply${i}`,
        threadRootId: root,
      });
    }
    const page = await asUser.query(api.messages.list, {
      channelId,
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(page.page.map((m) => m.id)).toEqual([older, root]);
  });

  it("tracks reply counts on thread roots", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });

    const root = await asUser.mutation(api.messages.send, { channelId, body: "root" });
    let listed = await asUser.query(api.messages.list, { channelId, paginationOpts: PAGE });
    expect(listed.page[0]?.replyCount).toBe(0);
    expect(listed.page[0]?.lastReplyAt).toBeNull();

    await asUser.mutation(api.messages.send, {
      channelId,
      body: "a",
      threadRootId: root,
    });
    await asUser.mutation(api.messages.send, {
      channelId,
      body: "b",
      threadRootId: root,
    });
    listed = await asUser.query(api.messages.list, { channelId, paginationOpts: PAGE });
    expect(listed.page[0]?.replyCount).toBe(2);
    expect(listed.page[0]?.lastReplyAt).toBeGreaterThanOrEqual(listed.page[0]?.createdAt ?? 0);
  });

  it("rejects replies to a reply (threads are one level deep)", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });

    const root = await asUser.mutation(api.messages.send, { channelId, body: "root" });
    const reply = await asUser.mutation(api.messages.send, {
      channelId,
      body: "reply",
      threadRootId: root,
    });
    await expect(
      asUser.mutation(api.messages.send, {
        channelId,
        body: "nested",
        threadRootId: reply,
      }),
    ).rejects.toThrow("Threads cannot be nested");
  });

  it("excludes thread replies from the main list and returns them from listThread", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });

    const rootId = await asUser.mutation(api.messages.send, { channelId, body: "cm9vdA==" });
    await asUser.mutation(api.messages.send, {
      channelId,
      body: "cmVwbHk=",
      threadRootId: rootId,
    });

    const main = await asUser.query(api.messages.list, { channelId, paginationOpts: PAGE });
    expect(main.page.map((m) => m.body)).toEqual(["cm9vdA=="]);

    const thread = await asUser.query(api.messages.listThread, {
      threadRootId: rootId,
      paginationOpts: PAGE,
    });
    expect(thread.page.map((m) => m.body)).toEqual(["cmVwbHk="]);
  });

  it("stores replyToId and returns it from the list query", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });

    const original = await asUser.mutation(api.messages.send, { channelId, body: "b3JpZ2luYWw=" });
    const reply = await asUser.mutation(api.messages.send, {
      channelId,
      body: "cmVwbHk=",
      replyToId: original,
    });

    const listed = await asUser.query(api.messages.list, { channelId, paginationOpts: PAGE });
    const byId = new Map(listed.page.map((m) => [m.id, m]));
    expect(byId.get(reply)?.replyToId).toBe(original);
    expect(byId.get(original)?.replyToId).toBeNull();

    const row = await t.run(async (ctx) => await ctx.db.get(reply));
    expect(row?.replyToId).toBe(original);
  });

  it("stores plaintext mentionChannelIds", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    const mentionedChannelId = await seedChannel(t, { name: "mentioned" });
    const asUser = t.withIdentity({ subject: "user-1" });

    const messageId = await asUser.mutation(api.messages.send, {
      channelId,
      body: "aGk=",
      mentionChannelIds: [mentionedChannelId],
    });

    const row = await t.run(async (ctx) => await ctx.db.get(messageId));
    expect(row?.mentionChannelIds).toEqual([mentionedChannelId]);

    const page = await asUser.query(api.messages.list, { channelId, paginationOpts: PAGE });
    expect(page.page.find((m) => m.id === messageId)?.mentionChannelIds).toEqual([
      mentionedChannelId,
    ]);
  });

  it("stores and returns plaintext mentionCategoryIds", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    const categoryId = await t.run(
      async (ctx) => await ctx.db.insert("categories", { name: "cat", position: 0, overrides: [] }),
    );
    const asUser = t.withIdentity({ subject: "user-1" });

    const messageId = await asUser.mutation(api.messages.send, {
      channelId,
      body: "aGk=",
      mentionCategoryIds: [categoryId],
    });

    const row = await t.run(async (ctx) => await ctx.db.get(messageId));
    expect(row?.mentionCategoryIds).toEqual([categoryId]);
    const page = await asUser.query(api.messages.list, { channelId, paginationOpts: PAGE });
    expect(page.page.find((m) => m.id === messageId)?.mentionCategoryIds).toEqual([categoryId]);
  });

  it("drops mention ids that do not resolve to a member, channel or category", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });

    const messageId = await asUser.mutation(api.messages.send, {
      channelId,
      body: "aGk=",
      mentionUserIds: ["ghost"],
      mentionChannelIds: ["not-a-channel-id"],
      mentionCategoryIds: ["not-a-category-id"],
    });
    const row = await t.run(async (ctx) => await ctx.db.get(messageId));
    expect(row?.mentionUserIds).toEqual([]);
    expect(row?.mentionChannelIds).toEqual([]);
    expect(row?.mentionCategoryIds).toEqual([]);
  });

  it("rejects a reply whose target is in another channel", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    const otherChannelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });

    const original = await asUser.mutation(api.messages.send, {
      channelId: otherChannelId,
      body: "b3RoZXI=",
    });
    await expect(
      asUser.mutation(api.messages.send, {
        channelId,
        body: "cmVwbHk=",
        replyToId: original,
      }),
    ).rejects.toThrow("Reply target not found in channel");
  });

  it("allows a message to carry both threadRootId and replyToId", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });

    const root = await asUser.mutation(api.messages.send, { channelId, body: "cm9vdA==" });
    const other = await asUser.mutation(api.messages.send, { channelId, body: "b3RoZXI=" });
    const reply = await asUser.mutation(api.messages.send, {
      channelId,
      body: "cmVwbHk=",
      threadRootId: root,
      replyToId: other,
    });

    const row = await t.run(async (ctx) => await ctx.db.get(reply));
    expect(row?.threadRootId).toBe(root);
    expect(row?.replyToId).toBe(other);
  });

  it("requires SendMessages to send", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewChannel | Permission.ReadHistory,
      members: [{ userId: "user-1" }],
    });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });
    await expect(asUser.mutation(api.messages.send, { channelId, body: "eA==" })).rejects.toThrow(
      "Missing permission",
    );
  });

  it("requires SendInThreads to reply in a thread", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions:
        Permission.ViewChannel | Permission.SendMessages | Permission.ReadHistory,
      members: [{ userId: "user-1" }],
    });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });
    const rootId = await asUser.mutation(api.messages.send, { channelId, body: "cm9vdA==" });
    await expect(
      asUser.mutation(api.messages.send, {
        channelId,
        body: "cmVwbHk=",
        threadRootId: rootId,
      }),
    ).rejects.toThrow("Missing permission");
  });

  it("requires CreateThreads only for the first thread reply", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions:
        Permission.ViewChannel |
        Permission.SendMessages |
        Permission.SendInThreads |
        Permission.ReadHistory,
      members: [{ userId: "user-1" }],
    });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });
    const asOwner = t.withIdentity({ subject: "owner-1" });
    const rootId = await asOwner.mutation(api.messages.send, { channelId, body: "root" });

    await expect(
      asUser.mutation(api.messages.send, {
        channelId,
        body: "first",
        threadRootId: rootId,
      }),
    ).rejects.toThrow("Missing permission to create threads");

    await asOwner.mutation(api.messages.send, { channelId, body: "first", threadRootId: rootId });
    await expect(
      asUser.mutation(api.messages.send, {
        channelId,
        body: "second",
        threadRootId: rootId,
      }),
    ).resolves.toBeDefined();
  });

  it("enforces the per-user send rate limit", async () => {
    process.env.SEND_RATE_LIMIT = "2";
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });

    await asUser.mutation(api.messages.send, { channelId, body: "MQ==" });
    await asUser.mutation(api.messages.send, { channelId, body: "Mg==" });
    await expect(asUser.mutation(api.messages.send, { channelId, body: "Mw==" })).rejects.toThrow(
      "Rate limit exceeded",
    );
  });
});

describe("messages.edit and delete", () => {
  async function sendAsUser1(t: ReturnType<typeof newTest>) {
    await seedWorkspace(t, { members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t);
    const asUser1 = t.withIdentity({ subject: "user-1" });
    const messageId = await asUser1.mutation(api.messages.send, {
      channelId,
      body: "b3JpZ2luYWw=",
    });
    return { channelId, messageId, asUser1 };
  }

  it("lets the author edit, re-seals and sets editedAt", async () => {
    const t = newTest();
    const { channelId, messageId, asUser1 } = await sendAsUser1(t);
    await asUser1.mutation(api.messages.edit, { messageId, body: "ZWRpdGVk" });
    const message = await t.run(async (ctx) => await ctx.db.get(messageId));
    expect(isSealed(message?.ciphertext ?? "")).toBe(true);
    await expect(openString(bodyContext(channelId), message?.ciphertext ?? "")).resolves.toBe(
      "ZWRpdGVk",
    );
    expect(message?.editedAt).toBeTypeOf("number");
  });

  it("refuses an edit by a non-author without ManageMessages", async () => {
    const t = newTest();
    const { messageId } = await sendAsUser1(t);
    const asUser2 = t.withIdentity({ subject: "user-2" });
    await expect(
      asUser2.mutation(api.messages.edit, { messageId, body: "aGFjaw==" }),
    ).rejects.toThrow("Missing permission");
  });

  it("lets a moderator with ManageMessages edit", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      extraRoles: [{ key: "mod", permissions: Permission.ViewChannel | Permission.ManageMessages }],
      members: [{ userId: "user-1" }, { userId: "user-2", roleIds: ["mod"] }],
    });
    const channelId = await seedChannel(t);
    const asUser1 = t.withIdentity({ subject: "user-1" });
    const messageId = await asUser1.mutation(api.messages.send, {
      channelId,
      body: "b3JpZ2luYWw=",
    });
    const asMod = t.withIdentity({ subject: "user-2" });
    await asMod.mutation(api.messages.edit, { messageId, body: "bW9kLWVkaXQ=" });
    const message = await t.run(async (ctx) => await ctx.db.get(messageId));
    await expect(openString(bodyContext(channelId), message?.ciphertext ?? "")).resolves.toBe(
      "bW9kLWVkaXQ=",
    );
  });

  it("soft-deletes as the author without a routine audit row", async () => {
    const t = newTest();
    const { channelId, messageId, asUser1 } = await sendAsUser1(t);
    await asUser1.mutation(api.messages.remove, { messageId });
    const message = await t.run(async (ctx) => await ctx.db.get(messageId));
    expect(message?.deletedAt).toBeTypeOf("number");
    await expect(openString(bodyContext(channelId), message?.ciphertext ?? "")).resolves.toBe(
      "b3JpZ2luYWw=",
    );
    const audit = await t.run(async (ctx) => await ctx.db.query("auditLog").collect());
    expect(audit.some((row) => row.action === "message.delete")).toBe(false);
  });

  it("audits a moderator edit and delete but not a self-delete", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      extraRoles: [{ key: "mod", permissions: Permission.ViewChannel | Permission.ManageMessages }],
      members: [{ userId: "author" }, { userId: "mod-1", roleIds: ["mod"] }],
    });
    const channelId = await seedChannel(t);
    const asAuthor = t.withIdentity({ subject: "author" });
    const messageId = await asAuthor.mutation(api.messages.send, {
      channelId,
      body: "b3JpZ2luYWw=",
    });
    const asMod = t.withIdentity({ subject: "mod-1" });
    await asMod.mutation(api.messages.edit, { messageId, body: "bW9k" });
    await asMod.mutation(api.messages.remove, { messageId });

    const selfId = await asAuthor.mutation(api.messages.send, { channelId, body: "bWU=" });
    await asAuthor.mutation(api.messages.remove, { messageId: selfId });

    const audit = await t.run(async (ctx) => await ctx.db.query("auditLog").collect());
    const actions = audit.map((row) => row.action);
    expect(actions).toContain("message.edit");
    expect(actions.filter((action) => action === "message.delete")).toHaveLength(1);
    expect(audit.find((row) => row.action === "message.delete")?.targetId).toBe(messageId);
  });

  it("refuses a delete by a non-author without ManageMessages", async () => {
    const t = newTest();
    const { messageId } = await sendAsUser1(t);
    const asUser2 = t.withIdentity({ subject: "user-2" });
    await expect(asUser2.mutation(api.messages.remove, { messageId })).rejects.toThrow(
      "Missing permission",
    );
  });
});
