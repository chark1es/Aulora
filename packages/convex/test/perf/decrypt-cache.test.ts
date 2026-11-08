import { expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { clearOpenedContentCache, openContent } from "../../convex/lib/sealed";
import { sealString } from "../../convex/lib/sse";
import { newTest, seedChannel, seedWorkspace } from "../helpers";

/**
 * A live page re-runs on every write in its channel, and re-decrypting the
 * unchanged rows dominated that work. `openContent` now keeps a bounded
 * plaintext window keyed by the sealed envelope, so a re-run of the same page
 * performs no AES-GCM work for rows it has already opened.
 */
it("does not re-decrypt an unchanged page when the query re-runs", async () => {
  const t = newTest();
  await seedWorkspace(t, { members: [{ userId: "viewer" }] });
  const channelId = await seedChannel(t, {});
  const messageIds = await t.run(async (ctx) => {
    const ids: Id<"messages">[] = [];
    for (let index = 0; index < 100; index += 1) {
      ids.push(
        await ctx.db.insert("messages", {
          channelId,
          authorId: "viewer",
          ciphertext: await sealString(
            { scope: "message", recordId: channelId as string },
            `body ${index}`,
          ),
          attachmentIds: [],
          mentionUserIds: [],
        }),
      );
    }
    return ids;
  });

  const viewer = t.withIdentity({ subject: "viewer" });
  const spy = vi.spyOn(globalThis.crypto.subtle, "decrypt");

  clearOpenedContentCache();
  const first = await viewer.query(api.messages.list, {
    channelId,
    paginationOpts: { cursor: null, numItems: 100 },
  });
  const coldDecrypts = spy.mock.calls.length;
  expect(first.page.length).toBe(100);
  expect(coldDecrypts).toBeGreaterThanOrEqual(100);

  // The same subscription re-runs after an unrelated insert into the channel.
  spy.mockClear();
  await t.run(async (ctx) => {
    await ctx.db.insert("messages", {
      channelId,
      authorId: "viewer",
      ciphertext: await sealString({ scope: "message", recordId: channelId as string }, "newest"),
      attachmentIds: [],
      mentionUserIds: [],
    });
  });
  const second = await viewer.query(api.messages.list, {
    channelId,
    paginationOpts: { cursor: null, numItems: 100 },
  });
  expect(second.page.at(-1)?.body).toBe("newest");
  // Only the one new envelope is opened; the cached 100 are reused. The page
  // slides by one, so 99 of the first run's rows are still on it.
  expect(spy.mock.calls.length).toBeLessThanOrEqual(2);

  spy.mockRestore();
  expect(messageIds.length).toBe(100);
});

/** The cache is scoped by encryption context, so channel A never serves B. */
it("keys opened content by its encryption context", async () => {
  const sealed = await sealString({ scope: "message", recordId: "channel-a" }, "same text");
  const spy = vi.spyOn(globalThis.crypto.subtle, "decrypt");
  clearOpenedContentCache();

  expect(await openContent({ scope: "message", recordId: "channel-a" }, sealed)).toBe("same text");
  expect(spy.mock.calls.length).toBe(1);
  // A repeat for the same context is served from the bounded cache.
  expect(await openContent({ scope: "message", recordId: "channel-a" }, sealed)).toBe("same text");
  expect(spy.mock.calls.length).toBe(1);
  // A different context is not a cache hit, and must not authenticate.
  await expect(openContent({ scope: "message", recordId: "channel-b" }, sealed)).rejects.toThrow();
  expect(spy.mock.calls.length).toBe(2);

  spy.mockRestore();
});
