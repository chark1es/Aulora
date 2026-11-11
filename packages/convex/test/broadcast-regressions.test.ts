import { hasBroadcastToken as clientHasBroadcastToken, Permission } from "@aulora/core";
import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { EVERYONE_BASE, newTest, seedChannel, seedWorkspace } from "./helpers";

afterEach(() => vi.useRealTimers());

it.each([
  ["> Someone wrote @everyone", false, false],
  ["before\r\n  > @everyone\r\n@here", false, true],
  ["`@everyone` @here", false, true],
  ["``@everyone ` @here``", false, false],
  ["`@everyone", true, false],
  ["`code\n@everyone\ncode` @here", false, true],
  ["   ~~~js\n@everyone\n~~~\n@here", false, true],
  ["````\n```\n@everyone\n````\n@here", false, true],
  ["```\n> ```\n@everyone\n```\n@here", false, true],
  ["> ```\n@everyone", true, false],
  ["```\n@everyone\n``` trailing\n@here", false, false],
  ["é@everyone 中@here", true, true],
  ["*@EVERYONE* (@here)", true, true],
  ["foo@everyone @@here @everyone.com @hereafter", false, false],
  ["see https://example.org/@everyone", false, false],
  ["https://example.org/?q=@here", false, false],
  ["(https://example.org/@everyone) @here", false, true],
  ["x\r\n@everyone", true, false],
] as const)(
  "keeps client/server broadcast recognition in parity: %s",
  async (body, everyone, here) => {
    const { hasBroadcastToken } = await import("../convex/lib/broadcastMentions");
    for (const [name, expected] of [
      ["everyone", everyone],
      ["here", here],
    ] as const) {
      expect(hasBroadcastToken(body, name)).toBe(expected);
      expect(clientHasBroadcastToken(body, name)).toBe(expected);
    }
  },
);

it.each(["dm", "group_dm"] as const)("does not spend the mass budget in %s", async (kind) => {
  const t = newTest();
  await seedWorkspace(t);
  const direct = await seedChannel(t, { kind, memberIds: ["owner-1"] });
  const channelId = await seedChannel(t);
  const author = t.withIdentity({ subject: "owner-1" });
  for (let i = 0; i < 4; i++)
    await author.mutation(api.messages.send, {
      channelId: direct,
      body: "@everyone @here",
      mentionEveryone: true,
      mentionHere: true,
    });
  for (let i = 0; i < 3; i++)
    await author.mutation(api.messages.send, { channelId, body: "@everyone" });
  await expect(author.mutation(api.messages.send, { channelId, body: "@here" })).rejects.toThrow(
    "too often",
  );
});

it.each(["mentionEveryone", "mentionHere"] as const)(
  "merges %s with channel/category mentions before suppression and presence",
  async (marker) => {
    for (const category of [false, true]) {
      for (const privateChannel of [false, true]) {
        const t = newTest();
        await seedWorkspace(t, {
          ownerId: "author",
          everyonePermissions: EVERYONE_BASE | Permission.MentionEveryone,
          members: ["author", "overlap", "outside"].map((userId) => ({ userId })),
        });
        const source = await seedChannel(t, { private: true, memberIds: ["author", "overlap"] });
        const categoryId = await t.run((ctx) =>
          ctx.db.insert("categories", { name: "target", position: 0, overrides: [] }),
        );
        const target = await seedChannel(t, {
          categoryId,
          private: privateChannel,
          memberIds: ["author", "overlap", "outside"],
        });
        await t.run(async (ctx) => {
          for (const userId of ["overlap", "outside"])
            await ctx.db.insert("notificationPrefs", {
              userId,
              scope: "server",
              level: "mentions",
              suppressMassMentions: true,
            });
        });
        const messageId = await t.withIdentity({ subject: "author" }).mutation(api.messages.send, {
          channelId: source,
          body: "@everyone @here #target",
          [marker]: true,
          ...(category ? { mentionCategoryIds: [categoryId] } : { mentionChannelIds: [target] }),
        });
        const recipients: string[] = [];
        let cursor: string | undefined;
        do {
          const page = await t.query(internal.notifications.recipientPage, {
            messageId,
            ...(cursor !== undefined ? { cursor } : {}),
          });
          recipients.push(...page.recipients);
          cursor = page.cursor ?? undefined;
        } while (cursor !== undefined);
        expect(recipients.sort()).toEqual(["outside", "overlap"]);
      }
    }
  },
);

it.each([false, true])(
  "drops inaccessible private channel/category mention ids (category=%s)",
  async (category) => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "author" }, { userId: "secret" }] });
    const source = await seedChannel(t);
    const categoryId = await t.run((ctx) =>
      ctx.db.insert("categories", { name: "secret", position: 0, overrides: [] }),
    );
    const secret = await seedChannel(t, { private: true, categoryId, memberIds: ["secret"] });
    const id = await t.withIdentity({ subject: "author" }).mutation(api.messages.send, {
      channelId: source,
      body: "#secret",
      ...(category ? { mentionCategoryIds: [categoryId] } : { mentionChannelIds: [secret] }),
    });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.mentionCategoryIds).toEqual([]);
    expect(row?.mentionChannelIds).toEqual([]);
    expect(await t.query(internal.notifications.resolveRecipients, { messageId: id })).toEqual([]);
  },
);

it("checks every channel of a category beyond the first page, even one hidden from the sender", async () => {
  const t = newTest();
  await seedWorkspace(t, { members: [{ userId: "author" }, { userId: "secret" }] });
  const source = await seedChannel(t);
  const categoryId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("categories", { name: "big", position: 0, overrides: [] });
    for (let i = 0; i < 200; i++)
      await ctx.db.insert("channels", {
        kind: "text",
        overrides: [],
        archived: false,
        categoryId: id,
      });
    return id;
  });
  await seedChannel(t, { private: true, categoryId, memberIds: ["secret"] });
  const id = await t.withIdentity({ subject: "author" }).mutation(api.messages.send, {
    channelId: source,
    body: "#big",
    mentionCategoryIds: [categoryId],
  });
  expect((await t.run((ctx) => ctx.db.get(id)))?.mentionCategoryIds).toEqual([]);
});

it("enforces the separate 3/minute mass-ping rate limit and stores only true flags", async () => {
  const t = newTest();
  await seedWorkspace(t, {
    members: [{ userId: "author" }],
    everyonePermissions: EVERYONE_BASE | Permission.MentionEveryone,
  });
  const channelId = await seedChannel(t);
  const author = t.withIdentity({ subject: "author" });
  for (let i = 0; i < 3; i++)
    await author.mutation(api.messages.send, {
      channelId,
      body: "@everyone",
      mentionEveryone: true,
    });
  await expect(
    author.mutation(api.messages.send, { channelId, body: "@here", mentionHere: true }),
  ).rejects.toThrow("You're mentioning everyone too often. Try again in a minute.");
  const id = await author.mutation(api.messages.send, { channelId, body: "ordinary" });
  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row).not.toHaveProperty("mentionEveryone");
  expect(row).not.toHaveProperty("mentionHere");
});

it.each(["dm", "group_dm"] as const)("ignores markers in %s", async (kind) => {
  const t = newTest();
  await seedWorkspace(t, { ownerId: "author", members: [{ userId: "author" }] });
  const channelId = await seedChannel(t, { kind, memberIds: ["author"] });
  const id = await t.withIdentity({ subject: "author" }).mutation(api.messages.send, {
    channelId,
    body: "@everyone @here",
    mentionEveryone: true,
    mentionHere: true,
  });
  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row).not.toHaveProperty("mentionEveryone");
  expect(row).not.toHaveProperty("mentionHere");
});

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

it("keeps the public replay shim harmless and atomically claims each internal page once", async () => {
  const t = newTest();
  await seedWorkspace(t);
  const channelId = await seedChannel(t);
  const messageId = await t
    .withIdentity({ subject: "owner-1" })
    .mutation(api.messages.send, { channelId, body: "message" });
  expect(await t.action(api.notifications.dispatchNow, { messageId })).toEqual({
    sent: 0,
    skipped: "noop",
  });
  expect(await t.mutation(internal.notifications.claimDelivery, { messageId })).toBe(true);
  expect(await t.mutation(internal.notifications.claimDelivery, { messageId })).toBe(false);
  expect(
    await t.mutation(internal.notifications.claimDelivery, { messageId, cursor: "page2" }),
  ).toBe(true);
  expect(
    await t.mutation(internal.notifications.claimDelivery, { messageId, cursor: "page2" }),
  ).toBe(false);
});

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
    let probes = 0;
    let reads = 0;
    function wrap<T extends object>(target: T): T {
      return new Proxy(target, {
        get(target, key) {
          const value = Reflect.get(target, key);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            const result = Reflect.apply(value, target, args);
            if (["first", "unique", "take", "paginate", "get"].includes(String(key))) {
              probes++;
              return Promise.resolve(result).then((row) => {
                if (row !== null)
                  reads += Array.isArray(row)
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
    const metered = { ...ctx, db: wrap(ctx.db) };
    const message = await ctx.db.get(id);
    if (message === null) throw new Error("missing message");
    const result = await resolveBroadcastRecipients(metered, message, null);
    expect(result.recipients).toEqual([]);
    const delivery = { probes, reads };
    probes = 0;
    reads = 0;
    await resolveBroadcastRecipients(metered, { ...message, mentionEveryone: true }, null);
    const everyone = { probes, reads };
    probes = 0;
    reads = 0;
    // Populated window: 500 participations, 50 mentioned roots in one public channel.
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
    expect(await countThreadMentions(metered, "meter1")).toBe(50);
    return { delivery, everyone, badge: { probes, reads } };
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

it("applies mass-ping budget to legacy pre-expanded sends", async () => {
  const t = newTest();
  await seedWorkspace(t, {
    ownerId: "author",
    members: [{ userId: "author" }, { userId: "viewer" }],
  });
  const channelId = await seedChannel(t);
  const author = t.withIdentity({ subject: "author" });
  for (let i = 0; i < 3; i++)
    await author.mutation(api.messages.send, {
      channelId,
      body: "@everyone",
      mentionUserIds: ["viewer"],
    });
  await expect(
    author.mutation(api.messages.send, { channelId, body: "@here", mentionUserIds: ["viewer"] }),
  ).rejects.toThrow("You're mentioning everyone too often. Try again in a minute.");
});

it.each(["x@here", "mail foo@everyone", "@@everyone", "a.@here", "@hereafter", "@everyone.com"])(
  "does not honor embedded token %s",
  async (body) => {
    const { hasBroadcastToken } = await import("../convex/lib/broadcastMentions");
    expect(hasBroadcastToken(body, "everyone")).toBe(false);
    expect(hasBroadcastToken(body, "here")).toBe(false);
    expect(hasBroadcastToken("(@EVERYONE), @here!", "everyone")).toBe(true);
    expect(hasBroadcastToken("(@EVERYONE), @here!", "here")).toBe(true);
  },
);

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

it("bounds claim retention and rejects expired delivery after claims are deleted", async () => {
  vi.useFakeTimers();
  const t = newTest();
  await seedWorkspace(t);
  const channelId = await seedChannel(t);
  const messageId = await t
    .withIdentity({ subject: "owner-1" })
    .mutation(api.messages.send, { channelId, body: "message" });
  await t.run(async (ctx) => {
    for (let i = 0; i < 1501; i++)
      await ctx.db.insert("notificationDeliveryClaims", {
        messageId,
        cursor: String(i),
      });
  });
  vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
  expect(await t.mutation(internal.notifications.pruneDeliveryClaims, {})).toBe(500);
  expect(await t.mutation(internal.notifications.claimDelivery, { messageId })).toBe(false);
  expect(await t.query(internal.notifications.recipientPage, { messageId })).toEqual({
    recipients: [],
    cursor: null,
  });
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect(
    await t.run(async (ctx) => await ctx.db.query("notificationDeliveryClaims").collect()),
  ).toEqual([]);
  expect(await t.mutation(internal.notifications.pruneDeliveryClaims, {})).toBe(0);
});

it.each([
  "> Someone wrote @everyone",
  "  > @here",
  "`@everyone`",
  "``@here``",
  "```\n@everyone\n```",
  "~~~js\n@here\n~~~",
  "```\n@everyone",
])("ignores quoted/code tokens for markers and mass-ping budget: %s", async (body) => {
  const { hasBroadcastToken } = await import("../convex/lib/broadcastMentions");
  expect(hasBroadcastToken(body, "everyone")).toBe(false);
  expect(hasBroadcastToken(body, "here")).toBe(false);

  const t = newTest();
  await seedWorkspace(t);
  const channelId = await seedChannel(t);
  const author = t.withIdentity({ subject: "owner-1" });
  for (let i = 0; i < 4; i++) {
    const id = await author.mutation(api.messages.send, {
      channelId,
      body,
      mentionEveryone: true,
      mentionHere: true,
    });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.mentionEveryone).not.toBe(true);
    expect(row?.mentionHere).not.toBe(true);
  }
  for (let i = 0; i < 3; i++)
    await author.mutation(api.messages.send, {
      channelId,
      body: "@everyone",
      mentionEveryone: true,
    });
  await expect(
    author.mutation(api.messages.send, { channelId, body: "@here", mentionHere: true }),
  ).rejects.toThrow("too often");
});

it("budgets legacy thread pings while preserving channel push rules and excluding replies from read counts", async () => {
  const t = newTest();
  await seedWorkspace(t, {
    ownerId: "author",
    members: [{ userId: "author" }, { userId: "viewer" }, { userId: "other" }],
  });
  const channelId = await seedChannel(t, { memberIds: ["author", "viewer", "other"] });
  const author = t.withIdentity({ subject: "author" });
  const root = await author.mutation(api.messages.send, { channelId, body: "root" });
  for (let i = 0; i < 3; i++) {
    const reply = await author.mutation(api.messages.send, {
      channelId,
      body: "@everyone",
      threadRootId: root,
      mentionUserIds: ["viewer"],
    });
    expect(
      (await t.query(internal.notifications.recipientPage, { messageId: reply })).recipients.sort(),
    ).toEqual(["other", "viewer"]);
  }
  await expect(
    author.mutation(api.messages.send, {
      channelId,
      body: "@everyone",
      threadRootId: root,
      mentionUserIds: ["viewer"],
    }),
  ).rejects.toThrow("too often");
  expect(
    await t.withIdentity({ subject: "viewer" }).mutation(api.readStates.set, { channelId }),
  ).toMatchObject({ mentionCount: 0 });
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

it.each([false, true])("claims single-page broadcasts only (broadcast=%s)", async (broadcast) => {
  vi.useFakeTimers();
  const relay = await import("../convex/lib/pushRelay");
  const web = await import("../convex/lib/webPush");
  vi.spyOn(web, "vapidConfigFromEnv").mockReturnValue(null);
  vi.spyOn(relay, "pushRelayConfigFromEnv").mockReturnValue({
    url: "https://relay.example",
    token: "synthetic",
    serverId: "s",
  });
  const send = vi.spyOn(relay, "sendWake").mockResolvedValue({ ok: true, status: 200 });
  try {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "viewer" }] });
    const channelId = await seedChannel(t, { memberIds: ["viewer"] });
    await t.run((ctx) =>
      ctx.db.insert("devices", {
        userId: "viewer",
        platform: "ios",
        lastSeen: 1,
        pushToken: "synthetic",
      }),
    );
    const messageId = await t.withIdentity({ subject: "owner-1" }).mutation(api.messages.send, {
      channelId,
      body: broadcast ? "@everyone" : "hello",
      mentionEveryone: broadcast,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await t.action(internal.notifications.dispatchForMessage, { messageId });
    expect(send).toHaveBeenCalledTimes(broadcast ? 1 : 2);
    expect(await t.run((ctx) => ctx.db.query("notificationDeliveryClaims").collect())).toHaveLength(
      broadcast ? 2 : 0,
    );
  } finally {
    vi.restoreAllMocks();
  }
});

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

it("unauthorized token text does not consume mass budget", async () => {
  const t = newTest();
  await seedWorkspace(t, { members: [{ userId: "author" }] });
  const channelId = await seedChannel(t);
  const a = t.withIdentity({ subject: "author" });
  for (let i = 0; i < 4; i++)
    await a.mutation(api.messages.send, { channelId, body: "@everyone", mentionEveryone: true });
  const rows = await t.run((ctx) => ctx.db.query("rateLimits").collect());
  expect(rows.some((r) => r.key.includes("mass-ping"))).toBe(false);
});

it.each([false, true])("bot budget follows MentionEveryone grant=%s", async (allowed) => {
  const t = newTest();
  await seedWorkspace(t);
  const channelId = await seedChannel(t);
  const userId = await t.run(async (ctx) => {
    const now = Date.now();
    const id = await ctx.db.insert("bots", {
      userId: "pending",
      name: "synthetic",
      language: "typescript",
      enabled: true,
      grants:
        Permission.ViewChannel |
        Permission.SendMessages |
        (allowed ? Permission.MentionEveryone : 0n),
      createdBy: "owner-1",
      createdAt: now,
      revision: 1,
      restartNonce: 0,
      status: "stopped",
      statusAt: now,
    });
    const userId = `bot_${id}`;
    await ctx.db.patch(id, { userId });
    await ctx.db.insert("members", { userId, roleIds: [], joinedAt: now });
    return userId;
  });
  const bot = t.withIdentity({ subject: userId });
  for (let i = 0; i < 3; i++)
    await bot.mutation(api.messages.send, { channelId, body: "@everyone", mentionEveryone: true });
  const fourth = bot.mutation(api.messages.send, {
    channelId,
    body: "@everyone",
    mentionEveryone: true,
  });
  if (allowed) await expect(fourth).rejects.toThrow("mentioning everyone too often");
  else await expect(fourth).resolves.toBeDefined();
});

it.each(["dm", "group_dm"] as const)("does not spend the mass-ping budget in %s", async (kind) => {
  const t = newTest();
  await seedWorkspace(t);
  const channelId = await seedChannel(t, { kind, memberIds: ["owner-1"] });
  const author = t.withIdentity({ subject: "owner-1" });
  for (let i = 0; i < 4; i++)
    await author.mutation(api.messages.send, {
      channelId,
      body: "@everyone",
      mentionEveryone: true,
    });
  expect(
    (await t.run((ctx) => ctx.db.query("rateLimits").collect())).some((row) =>
      row.key.includes("mass-ping"),
    ),
  ).toBe(false);
});

it.each([
  "> @everyone\n@here",
  "  > ```\n@everyone",
  "```\n> ```\n@everyone\n```\n@here",
  "~~~js\n@everyone\n~~~\n@here",
  "````js\n```\n@everyone\n````\n@here",
  "`multi\n@everyone` @here",
  "``one ` @everyone`` @here",
  "`unmatched @everyone",
  "```\n@everyone\n``` extra\n@here",
  "    ```\n@everyone",
  "é@everyone 中@here",
  "foo@everyone @hereafter",
])("matches client broadcast recognition for %s", async (body) => {
  const client = await import("@aulora/core/chat");
  const server = await import("../convex/lib/broadcastMentions");
  for (const name of ["everyone", "here"] as const)
    expect(server.hasBroadcastToken(body, name)).toBe(client.hasBroadcastToken(body, name));
});

it("recovers expired and legacy leases, fences stale workers, and retains recipient receipts", async () => {
  const t = newTest();
  await seedWorkspace(t);
  const channelId = await seedChannel(t);
  const messageId = await t
    .withIdentity({ subject: "owner-1" })
    .mutation(api.messages.send, { channelId, body: "hello" });
  const key = { messageId, cursor: "recipient:member-1" };
  expect(
    await t.mutation(internal.notifications.claimDelivery, {
      ...key,
      leaseToken: "old",
      recoveryCursor: "",
    }),
  ).toBe(true);
  await t.run(async (ctx) => {
    const row = await ctx.db.query("notificationDeliveryClaims").first();
    if (row === null) throw new Error("Missing claim");
    await ctx.db.patch(row._id, { leaseUntil: 1 });
  });
  await t.mutation(internal.notifications.recoverDeliveryLeases, {});
  expect(
    await t.mutation(internal.notifications.claimDelivery, { ...key, leaseToken: "new" }),
  ).toBe(true);
  await t.mutation(internal.notifications.completeDelivery, { ...key, leaseToken: "old" });
  expect(await t.query(internal.notifications.deliveryCompleted, key)).toBe(false);
  await t.mutation(internal.notifications.completeDelivery, { ...key, leaseToken: "new" });
  expect(await t.query(internal.notifications.deliveryCompleted, key)).toBe(true);
  expect(
    await t.mutation(internal.notifications.claimDelivery, { ...key, leaseToken: "retry" }),
  ).toBe(false);
  await t.run(async (ctx) => {
    await ctx.db.insert("notificationDeliveryClaims", { messageId, cursor: "legacy" });
  });
  expect(
    await t.mutation(internal.notifications.claimDelivery, { messageId, cursor: "legacy" }),
  ).toBe(true);
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

it("retries a failed recipient after lease expiry without repeating completed recipients", async () => {
  vi.useFakeTimers();
  const relay = await import("../convex/lib/pushRelay");
  const web = await import("../convex/lib/webPush");
  vi.spyOn(web, "vapidConfigFromEnv").mockReturnValue(null);
  vi.spyOn(relay, "pushRelayConfigFromEnv").mockReturnValue({
    url: "https://relay.example",
    token: "synthetic",
    serverId: "s",
  });
  const attempts = new Map<string, number>();
  vi.spyOn(relay, "sendWake").mockImplementation(async (payload) => {
    const count = (attempts.get(payload.token) ?? 0) + 1;
    attempts.set(payload.token, count);
    return {
      ok: payload.token !== "retry" || count > 1,
      status: payload.token === "retry" && count === 1 ? 503 : 200,
    };
  });
  try {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "done" }, { userId: "retry" }] });
    const channelId = await seedChannel(t, { memberIds: ["done", "retry"] });
    await t.run(async (ctx) => {
      for (const userId of ["done", "retry"])
        await ctx.db.insert("devices", { userId, platform: "ios", lastSeen: 1, pushToken: userId });
    });
    const messageId = await t
      .withIdentity({ subject: "owner-1" })
      .mutation(api.messages.send, { channelId, body: "@everyone", mentionEveryone: true });
    await t.action(internal.notifications.dispatchForMessage, { messageId });
    expect(attempts).toEqual(
      new Map([
        ["done", 1],
        ["retry", 1],
      ]),
    );
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
    await t.mutation(internal.notifications.recoverDeliveryLeases, {});
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(attempts).toEqual(
      new Map([
        ["done", 1],
        ["retry", 2],
      ]),
    );
    expect(await t.query(internal.notifications.deliveryCompleted, { messageId, cursor: "" })).toBe(
      true,
    );
  } finally {
    vi.restoreAllMocks();
  }
});

it("advances recovery cursors so a failing batch cannot starve later leases", async () => {
  const t = newTest();
  await seedWorkspace(t);
  const channelId = await seedChannel(t);
  const messageId = await t
    .withIdentity({ subject: "owner-1" })
    .mutation(api.messages.send, { channelId, body: "hello" });
  await t.run(async (ctx) => {
    for (let i = 0; i < 101; i++)
      await ctx.db.insert("notificationDeliveryClaims", {
        messageId,
        cursor: `page-${i}`,
        leaseUntil: 1,
        retryAt: 1,
      });
  });
  const progressed = () =>
    t.run(
      async (ctx) =>
        (await ctx.db.query("notificationDeliveryClaims").collect()).filter(
          (r) => (r.retryAt ?? 0) > 1,
        ).length,
    );
  await t.mutation(internal.notifications.recoverDeliveryLeases, {});
  expect(await progressed()).toBe(100);
  await t.mutation(internal.notifications.recoverDeliveryLeases, {});
  expect(await progressed()).toBe(101);
});

it("never adds a ping on edit and redacts deleted broadcast metadata", async () => {
  const t = newTest();
  await seedWorkspace(t);
  const channelId = await seedChannel(t);
  const client = t.withIdentity({ subject: "owner-1" });
  const ordinary = await client.mutation(api.messages.send, { channelId, body: "ordinary" });
  await client.mutation(api.messages.edit, { messageId: ordinary, body: "@everyone @here" });
  const edited = await t.run((ctx) => ctx.db.get(ordinary));
  expect(edited?.mentionEveryone).toBeUndefined();
  expect(edited?.mentionHere).toBeUndefined();
  const broadcast = await client.mutation(api.messages.send, {
    channelId,
    body: "@everyone",
    mentionEveryone: true,
  });
  await client.mutation(api.messages.remove, { messageId: broadcast });
  const page = await client.query(api.messages.list, {
    channelId,
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(page.page.find((row) => row.id === broadcast)).toMatchObject({
    body: "",
    mentionEveryone: false,
    mentionHere: false,
    mentionUserIds: [],
    mentionChannelIds: [],
    mentionCategoryIds: [],
  });
  expect(await t.mutation(internal.notifications.claimDelivery, { messageId: broadcast })).toBe(
    false,
  );
});

it("stops re-driving permanently failing delivery pages and receipts at twelve attempts", async () => {
  const t = newTest();
  await seedWorkspace(t);
  const channelId = await seedChannel(t);
  const messageId = await t
    .withIdentity({ subject: "owner-1" })
    .mutation(api.messages.send, { channelId, body: "hello" });
  for (const cursor of ["page", "recipient:member-1"]) {
    for (let attempt = 1; attempt <= 12; attempt++) {
      expect(await t.mutation(internal.notifications.claimDelivery, { messageId, cursor })).toBe(
        true,
      );
      await t.run(async (ctx) => {
        const row = (await ctx.db.query("notificationDeliveryClaims").take(100)).find(
          (entry) => entry.messageId === messageId && entry.cursor === cursor,
        );
        if (row === undefined) throw new Error("Missing claim");
        await ctx.db.patch(row._id, { leaseUntil: 1, retryAt: 1 });
      });
    }
    expect(await t.mutation(internal.notifications.claimDelivery, { messageId, cursor })).toBe(
      false,
    );
  }
  await t.mutation(internal.notifications.recoverDeliveryLeases, {});
  for (const cursor of ["page", "recipient:member-1"]) {
    expect(await t.query(internal.notifications.deliveryCompleted, { messageId, cursor })).toBe(
      true,
    );
  }
});
