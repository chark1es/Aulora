import { Permission } from "@aulora/core";
import { expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { EVERYONE_BASE, newTest, seedChannel, seedWorkspace, type Test } from "../helpers";

/**
 * Large-fixture guards for the read paths the web client subscribes to. These
 * assert output bounds rather than read counters: `convex-test` does not expose
 * document reads, so the bound is proven by the shape of what comes back for a
 * workspace far larger than any page.
 */
const CHANNELS = 300;
const MESSAGES = 5000;

interface Fixture {
  readonly channelIds: readonly Id<"channels">[];
  readonly busiest: Id<"channels">;
}

async function seedLargeWorkspace(t: Test): Promise<Fixture> {
  await seedWorkspace(t, {
    members: [{ userId: "viewer" }, { userId: "author" }],
  });
  return await t.run(async (ctx) => {
    const channelIds: Id<"channels">[] = [];
    const categoryId = await ctx.db.insert("categories", {
      name: "Product",
      position: 0,
      overrides: [],
    });
    for (let index = 0; index < CHANNELS; index += 1) {
      channelIds.push(
        await ctx.db.insert("channels", {
          kind: "text",
          overrides: [],
          archived: false,
          nameCiphertext: `channel-${index}`,
          categoryId: index % 2 === 0 ? categoryId : undefined,
        }),
      );
    }
    // Spread the history over every channel, with extra depth in one channel
    // so per-channel tail caps are exercised.
    for (let index = 0; index < MESSAGES; index += 1) {
      const channelId = channelIds[index % CHANNELS] as Id<"channels">;
      // Plaintext-legacy ciphertext keeps the seed fast; this test bounds page
      // shapes, not the envelope, which `decrypt-cache.test.ts` covers.
      await ctx.db.insert("messages", {
        channelId,
        authorId: "author",
        ciphertext: `message ${index}`,
        attachmentIds: [],
        mentionUserIds: index % 97 === 0 ? ["viewer"] : [],
      });
    }
    return { channelIds, busiest: channelIds[0] as Id<"channels"> };
  });
}

it("bounds every subscribed read on a 300-channel, 5k-message workspace", {
  timeout: 30_000,
}, async () => {
  const t = newTest();
  const fixture = await seedLargeWorkspace(t);
  await seedChannel(t, {});
  const viewer = t.withIdentity({ subject: "viewer" });

  const page = await viewer.query(api.messages.list, {
    channelId: fixture.busiest,
    paginationOpts: { cursor: null, numItems: 100 },
  });
  expect(page.page.length).toBeLessThanOrEqual(100);

  const summary = await viewer.query(api.readStates.summary, {
    channelIds: [...fixture.channelIds],
  });
  // The server caps the requested set at 200 channels and each channel's
  // unread count at 100, so the sidebar never walks the whole history.
  expect(summary.length).toBeLessThanOrEqual(200);
  for (const row of summary) {
    expect(row.unreadCount).toBeLessThanOrEqual(100);
    expect(row.mentionCount).toBeLessThanOrEqual(100);
  }
  expect(summary.reduce((total, row) => total + row.unreadCount, 0)).toBeLessThanOrEqual(200 * 100);

  const channels = await viewer.query(api.channels.list, {
    paginationOpts: { cursor: null, numItems: 50 },
  });
  expect(channels.page.length).toBeLessThanOrEqual(50);

  const members = await viewer.query(api.members.page, { numItems: 10 });
  expect(members.page.length).toBeLessThanOrEqual(10);
});

it("keeps private-channel access correct while batching the page", async () => {
  const t = newTest();
  await seedWorkspace(t, { members: [{ userId: "viewer" }] });
  const visible = await seedChannel(t, {
    name: "secret",
    private: true,
    memberIds: ["viewer"],
  });
  const hidden = await seedChannel(t, { name: "other-secret", private: true });

  const viewer = t.withIdentity({ subject: "viewer" });
  const page = await viewer.query(api.channels.list, {
    paginationOpts: { cursor: null, numItems: 50 },
  });
  const ids = page.page.map((channel) => channel.id);
  expect(ids).toContain(visible);
  expect(ids).not.toContain(hidden);
  // A private channel's member list still rides along for the members modal.
  expect(page.page.find((channel) => channel.id === visible)?.memberIds).toEqual(["viewer"]);
});

it("keeps the thread inbox and its badge bounded by the requested limit", async () => {
  const t = newTest();
  await seedWorkspace(t, { members: [{ userId: "viewer" }, { userId: "author" }] });
  const channelId = await seedChannel(t, {});
  const author = t.withIdentity({ subject: "author" });
  const viewer = t.withIdentity({ subject: "viewer" });

  const roots: string[] = [];
  // Four roots with five replies each stays inside the send rate limit while
  // still exercising the per-thread reply counter.
  for (let index = 0; index < 4; index += 1) {
    const root = await author.mutation(api.messages.send, {
      channelId,
      body: `cm9vdA==${index}`,
    });
    roots.push(root);
    // The inbox must take the stored counter, not rescan the replies.
    for (let reply = 0; reply < 5; reply += 1) {
      await author.mutation(api.messages.send, {
        channelId,
        body: `cmVwbHk=${reply}`,
        threadRootId: root,
        ...(reply % 5 === 0 ? { mentionUserIds: ["viewer"] } : {}),
      });
    }
  }

  const full = await viewer.query(api.messages.threadInbox, {});
  expect(full.length).toBe(4);
  expect(full.every((row) => row.replyCount === 5)).toBe(true);

  const limited = await viewer.query(api.messages.threadInbox, { limit: 2 });
  expect(limited.length).toBe(2);
  const clamped = await viewer.query(api.messages.threadInbox, { limit: 10_000 });
  expect(clamped.length).toBe(4);

  // The badge reads participation rows only, so it stays cheap while the inbox
  // is closed, and agrees with the rows' mention flags.
  const badge = await viewer.query(api.messages.threadMentionCount, {});
  expect(badge).toBe(full.filter((row) => row.viewerMentioned).length);
});

it("resolves author names through members.brief instead of the whole directory", async () => {
  const t = newTest();
  await seedWorkspace(t, {
    members: [{ userId: "viewer" }, { userId: "author" }, { userId: "other" }],
  });
  const viewer = t.withIdentity({ subject: "viewer" });

  const brief = await viewer.query(api.members.brief, { userIds: ["author", "missing", "author"] });
  expect(brief.map((member) => member.userId)).toEqual(["author"]);

  // The public contract is unchanged for installed clients.
  const listed = await viewer.query(api.members.list, {});
  expect(listed.length).toBe(3);
});

it("expands @role mentions on the server from the reverse role index", async () => {
  const t = newTest();
  await seedWorkspace(t, {
    everyonePermissions: EVERYONE_BASE,
    members: [{ userId: "viewer" }, { userId: "author", roleIds: ["design"] }],
  });
  // Mentionable, so the server expansion accepts it; `seedWorkspace` only
  // creates non-mentionable extra roles.
  await t.run(async (ctx) => {
    await ctx.db.insert("roles", {
      key: "design",
      name: "design",
      position: 1,
      permissions: Permission.ViewChannel,
      hoisted: false,
      mentionable: true,
    });
  });
  const channelId = await seedChannel(t, {});
  const sender = t.withIdentity({ subject: "author" });
  await sender.mutation(api.messages.send, {
    channelId,
    body: "aGk=",
    mentionRoleIds: ["design"],
  });
  const messages = await sender.query(api.messages.list, {
    channelId,
    paginationOpts: { cursor: null, numItems: 10 },
  });
  expect(messages.page.at(-1)?.mentionUserIds).toEqual(["author"]);
});
