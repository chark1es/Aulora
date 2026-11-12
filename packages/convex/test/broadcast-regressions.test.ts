import { hasBroadcastToken as clientHasBroadcastToken, Permission } from "@aulora/core";
import { expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { EVERYONE_BASE, newTest, seedChannel, seedWorkspace } from "./helpers";

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
