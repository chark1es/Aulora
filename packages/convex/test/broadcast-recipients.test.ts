import { Permission } from "@aulora/core";
import { expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { MutationCtx } from "../convex/_generated/server";
import { EVERYONE_BASE, newTest, seedChannel, seedWorkspace } from "./helpers";

it.each([false, true])(
  "does not grant pre-join broadcast badges (private=%s)",
  async (privateChannel) => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "author" }],
      everyonePermissions: EVERYONE_BASE | Permission.MentionEveryone,
    });
    const channelId = await seedChannel(t, { private: privateChannel, memberIds: ["author"] });
    await t
      .withIdentity({ subject: "author" })
      .mutation(api.messages.send, { channelId, body: "@everyone", mentionEveryone: true });
    await t.run(async (ctx) => {
      await ctx.db.insert("members", {
        userId: "later",
        roleIds: ["@everyone"],
        joinedAt: privateChannel ? 0 : Date.now() + 1000,
      });
      await ctx.db.insert("channelMembers", {
        channelId,
        userId: "later",
        joinedAt: Date.now() + 1000,
      });
    });
    const viewer = t.withIdentity({ subject: "later" });
    expect(
      (await viewer.query(api.readStates.summary, { channelIds: [channelId] }))[0]?.mentionCount,
    ).toBe(0);
    expect((await viewer.query(api.notifications.unreadSummary)).mentions).toBe(0);
  },
);

it("keeps a participation mention despite 500 unrelated markers and 50 newer unmentioned threads", async () => {
  const t = newTest();
  await seedWorkspace(t, { members: [{ userId: "viewer" }, { userId: "author" }] });
  const channelId = await seedChannel(t);
  await t.run(async (ctx) => {
    for (let i = 0; i < 51; i++) {
      const root = await ctx.db.insert("messages", {
        channelId,
        authorId: "author",
        ciphertext: "root",
        attachmentIds: [],
        mentionUserIds: [],
        replyCount: 1,
        lastReplyAt: i,
      });
      await ctx.db.insert("threadParticipants", {
        userId: "viewer",
        threadRootId: root,
        channelId,
        mentioned: i === 0,
        participated: i !== 0,
        lastReplyAt: i,
      });
    }
    for (let i = 0; i < 500; i++)
      await ctx.db.insert("messages", {
        channelId,
        authorId: "author",
        ciphertext: "marker",
        attachmentIds: [],
        mentionUserIds: [],
        mentionEveryone: true,
        replyCount: 1,
      });
  });
  const viewer = t.withIdentity({ subject: "viewer" });
  expect(await viewer.query(api.messages.threadMentionCount)).toBe(1);
  const inbox = await viewer.query(api.messages.threadInbox, {});
  expect(inbox).toHaveLength(50);
  expect(inbox[0]?.viewerMentioned).toBe(true);
  expect(inbox.filter((row) => row.viewerMentioned)).toHaveLength(1);
});

/** Wraps a Convex `db` to count index probes and the rows they return. */
function meterDb<D extends object>(db: D) {
  const counts = { probes: 0, reads: 0 };
  function wrap<T extends object>(target: T): T {
    return new Proxy(target, {
      get(target, key) {
        const value = Reflect.get(target, key);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const result = Reflect.apply(value, target, args);
          if (["first", "unique", "take", "paginate", "get"].includes(String(key))) {
            counts.probes++;
            return Promise.resolve(result).then((row) => {
              if (row !== null)
                counts.reads += Array.isArray(row)
                  ? row.length
                  : row && Array.isArray(row.page)
                    ? row.page.length
                    : 1;
              return row;
            });
          }
          return ["query", "withIndex", "order"].includes(String(key)) ? wrap(result) : result;
        };
      },
    });
  }
  return {
    db: wrap(db),
    /** The counts since the last call; counting starts over afterwards. */
    take() {
      const taken = { ...counts };
      counts.probes = 0;
      counts.reads = 0;
      return taken;
    },
  };
}

/** Populated window: 500 participations, 50 mentioned roots in one public channel. */
async function seedThreadParticipations(ctx: MutationCtx, channelId: Id<"channels">) {
  for (let i = 0; i < 500; i++) {
    const root = await ctx.db.insert("messages", {
      channelId,
      authorId: "meter0",
      ciphertext: "root",
      attachmentIds: [],
      mentionUserIds: [],
      replyCount: 1,
    });
    await ctx.db.insert("threadParticipants", {
      userId: "meter1",
      channelId,
      threadRootId: root,
      mentioned: i % 10 === 0,
      participated: true,
      lastReplyAt: i,
    });
  }
}

it("reuses enumerated members and skips preferences for offline @here recipients", async () => {
  const { resolveBroadcastRecipients } = await import("../convex/lib/messageRecipients");
  const { countThreadMentions } = await import("../convex/lib/threadInbox");
  const t = newTest();
  const users = Array.from({ length: 201 }, (_, i) => `meter${i}`);
  await seedWorkspace(t, { ownerId: "meter0", members: users.map((userId) => ({ userId })) });
  const channelId = await seedChannel(t);
  await t.run(async (ctx) => {
    for (let i = 0; i < 1000; i++)
      await ctx.db.insert("messages", {
        channelId,
        authorId: "author",
        ciphertext: "non-thread",
        attachmentIds: [],
        mentionUserIds: [],
        ...(i < 500 ? { mentionEveryone: true } : { mentionHere: true }),
      });
  });
  const id = await t.run((ctx) =>
    ctx.db.insert("messages", {
      channelId,
      authorId: "meter0",
      ciphertext: "broadcast",
      attachmentIds: [],
      mentionUserIds: [],
      mentionHere: true,
    }),
  );
  const counts = await t.run(async (ctx) => {
    const meter = meterDb(ctx.db);
    const metered = { ...ctx, db: meter.db };
    const message = await ctx.db.get(id);
    if (message === null) throw new Error("missing message");
    const result = await resolveBroadcastRecipients(metered, message, null);
    expect(result.recipients).toEqual([]);
    const delivery = meter.take();
    await resolveBroadcastRecipients(metered, { ...message, mentionEveryone: true }, null);
    const everyone = meter.take();
    await seedThreadParticipations(ctx, channelId);
    expect(await countThreadMentions(metered, "meter1")).toBe(50);
    return { delivery, everyone, badge: meter.take() };
  });
  // The council fixture measured 1,003 probes / 404 returned docs per 200
  // candidates. Member reuse removes 200 probes; offline @here prefiltering
  // removes 398 preference probes. This measures DB boundaries, not live load.
  expect(counts.delivery.probes).toBeLessThan(450);
  expect(counts.everyone.probes).toBeLessThan(810);
  expect(counts.everyone.reads).toBeLessThan(210);
  expect(counts.delivery.reads).toBeLessThan(210);
  // 50 participation rows + 50 roots + shared access metadata; no inbox scan.
  expect(counts.badge.reads).toBeLessThanOrEqual(110);
  console.log("populated thread badge reads", counts.badge);
});

it.each([false, true])(
  "includes memberless owners while preserving private-channel membership (private=%s)",
  async (privateChannel) => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "author" }],
      everyonePermissions: EVERYONE_BASE | Permission.MentionEveryone,
    });
    const channelId = await seedChannel(t, {
      private: privateChannel,
      memberIds: ["author", "owner-1"],
    });
    const messageId = await t
      .withIdentity({ subject: "author" })
      .mutation(api.messages.send, { channelId, body: "@everyone", mentionEveryone: true });
    expect((await t.query(internal.notifications.recipientPage, { messageId })).recipients).toEqual(
      ["owner-1"],
    );
    if (privateChannel) {
      await t.run(async (ctx) => {
        const row = (await ctx.db.query("channelMembers").collect()).find(
          (row) => row.channelId === channelId && row.userId === "owner-1",
        );
        if (row) await ctx.db.delete(row._id);
      });
      expect(
        (await t.query(internal.notifications.recipientPage, { messageId })).recipients,
      ).toEqual([]);
    }
  },
);

it("preserves target channel preferences when adding a broadcast", async () => {
  const t = newTest();
  await seedWorkspace(t, {
    ownerId: "author",
    members: [{ userId: "author" }, { userId: "viewer" }],
  });
  const source = await seedChannel(t, { memberIds: ["author"] });
  const target = await seedChannel(t, { memberIds: ["author", "viewer"] });
  const viewer = t.withIdentity({ subject: "viewer" });
  await viewer.mutation(api.notifications.setPref, {
    scope: "channel",
    channelId: source,
    level: "nothing",
  });
  await viewer.mutation(api.notifications.setPref, {
    scope: "channel",
    channelId: target,
    level: "mentions",
  });
  for (const broadcast of [false, true]) {
    const messageId = await t.withIdentity({ subject: "author" }).mutation(api.messages.send, {
      channelId: source,
      body: "#target @everyone",
      mentionChannelIds: [target],
      mentionEveryone: broadcast,
    });
    expect(
      (await t.query(internal.notifications.recipientPage, { messageId })).recipients,
    ).toContain("viewer");
  }
});

it("preserves notification level when toggling suppression without a level", async () => {
  const t = newTest();
  await seedWorkspace(t, { members: [{ userId: "viewer" }] });
  const viewer = t.withIdentity({ subject: "viewer" });
  await viewer.mutation(api.notifications.setPref, { scope: "server", level: "nothing" });
  await viewer.mutation(api.notifications.setPref, { scope: "server", suppressMassMentions: true });
  expect(await viewer.query(api.notifications.getPrefs)).toEqual([
    expect.objectContaining({ level: "nothing", suppressMassMentions: true }),
  ]);
});

it("edits legacy messages with more than ten attachment references", async () => {
  const t = newTest();
  await seedWorkspace(t, { members: [{ userId: "author" }] });
  const channelId = await seedChannel(t);
  const messageId = await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["synthetic"]));
    const fileId = await ctx.db.insert("files", {
      storageId,
      sealedStorageId: storageId,
      uploaderId: "author",
      channelId,
      sizeBytes: 1,
      keyVersion: "1",
    });
    return await ctx.db.insert("messages", {
      channelId,
      authorId: "author",
      ciphertext: "legacy",
      attachmentIds: Array.from({ length: 11 }, () => fileId),
      mentionUserIds: [],
    });
  });
  const author = t.withIdentity({ subject: "author" });
  await expect(
    author.mutation(api.messages.edit, { messageId, body: "fixed typo" }),
  ).resolves.toBeNull();
  await expect(author.mutation(api.messages.edit, { messageId, body: "" })).resolves.toBeNull();
});

it.each(["nothing", "mentions"] as const)(
  "seeds suppression-only channel preferences with server level %s",
  async (level) => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "viewer" }] });
    const channelId = await seedChannel(t, { memberIds: ["viewer"] });
    const viewer = t.withIdentity({ subject: "viewer" });
    await viewer.mutation(api.notifications.setPref, { scope: "server", level });
    await viewer.mutation(api.notifications.setPref, {
      scope: "channel",
      channelId,
      suppressMassMentions: true,
    });
    expect(await viewer.query(api.notifications.getPrefs)).toContainEqual(
      expect.objectContaining({ scope: "channel", level, suppressMassMentions: true }),
    );
  },
);

it.each(["hidden", "muted", "pinned"] as const)(
  "leaves suppression unset when creating a %s row",
  async (kind) => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "viewer" }] });
    const channelId = await seedChannel(t, { kind: "dm", memberIds: ["viewer"] });
    const viewer = t.withIdentity({ subject: "viewer" });
    await viewer.mutation(api.notifications.setPref, {
      scope: "server",
      level: "nothing",
      suppressMassMentions: true,
    });
    if (kind === "hidden")
      await viewer.mutation(api.notifications.setChannelHidden, { channelId, hidden: true });
    if (kind === "muted")
      await viewer.mutation(api.notifications.setChannelMuted, { channelId, muted: true });
    if (kind === "pinned")
      await viewer.mutation(api.channels.setPinned, { channelId, pinned: true });
    expect(await viewer.query(api.notifications.getPrefs)).toContainEqual(
      expect.objectContaining({ scope: "channel", suppressMassMentions: null, level: "nothing" }),
    );
    const row = await t.run(async (ctx) => {
      const rows = await ctx.db.query("notificationPrefs").collect();
      return rows.find((row) => row.channelId === channelId && row.userId === "viewer");
    });
    expect(row?.suppressMassMentions).toBeUndefined();
  },
);

it("clamps the badge to the mentioned rows displayed in the inbox", async () => {
  const t = newTest();
  await seedWorkspace(t, { members: [{ userId: "viewer" }] });
  const channelId = await seedChannel(t);
  await t.run(async (ctx) => {
    for (let i = 0; i < 55; i++) {
      const root = await ctx.db.insert("messages", {
        channelId,
        authorId: "author",
        ciphertext: "root",
        attachmentIds: [],
        mentionUserIds: [],
        replyCount: 1,
        lastReplyAt: i,
      });
      await ctx.db.insert("threadParticipants", {
        userId: "viewer",
        threadRootId: root,
        channelId,
        mentioned: true,
        participated: false,
        lastReplyAt: i,
      });
    }
  });
  const viewer = t.withIdentity({ subject: "viewer" });
  const rows = await viewer.query(api.messages.threadInbox, {});
  expect(rows).toHaveLength(50);
  expect(await viewer.query(api.messages.threadMentionCount)).toBe(
    rows.filter((row) => row.viewerMentioned).length,
  );
});

it("pages thread candidates beyond 500 without losing older participation", async () => {
  const t = newTest();
  await seedWorkspace(t);
  const channelId = await seedChannel(t);
  const rootId = await t
    .withIdentity({ subject: "owner-1" })
    .mutation(api.messages.send, { channelId, body: "root" });
  await t.run(async (ctx) => {
    const root = await ctx.db.get(rootId);
    if (root === null) throw new Error("Missing root");
    for (let i = 0; i < 511; i++) {
      const threadRootId = await ctx.db.insert("messages", {
        channelId,
        authorId: "owner-1",
        ciphertext: root.ciphertext,
        attachmentIds: [],
        mentionUserIds: [],
        replyCount: 1,
        lastReplyAt: i,
      });
      await ctx.db.insert("threadParticipants", {
        userId: "owner-1",
        channelId,
        threadRootId,
        mentioned: i === 0,
        participated: true,
        lastReplyAt: i,
      });
    }
  });
  const client = t.withIdentity({ subject: "owner-1" });
  let cursor: string | null = null;
  const ids = new Set<string>();
  for (let i = 0; i < 15; i++) {
    const page: { page: { id: string }[]; isDone: boolean; continueCursor: string } =
      await client.query(api.messages.threadInboxPage, {
        paginationOpts: { cursor, numItems: 50 },
      });
    for (const row of page.page) ids.add(row.id);
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  expect(ids.size).toBe(511);
});
