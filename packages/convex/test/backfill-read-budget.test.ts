import { expect, it } from "vitest";
import type { MutationCtx } from "../convex/_generated/server";
import { backfillAttachmentScopes, backfillMemberRoles } from "../convex/maintenance";
import { newTest, seedChannel, seedWorkspace, storeBlob } from "./helpers";

/** Count returned documents, including repeated point reads, at the DB boundary. */
function metered(ctx: MutationCtx) {
  let reads = 0;
  function query<T extends object>(target: T): T {
    return new Proxy(target, {
      get(target, key) {
        const value = Reflect.get(target, key);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const result = Reflect.apply(value, target, args);
          if (["first", "unique", "collect", "paginate"].includes(String(key))) {
            return Promise.resolve(result).then((rows) => {
              if (rows !== null) {
                reads += Array.isArray(rows)
                  ? rows.length
                  : Array.isArray(rows.page)
                    ? rows.page.length
                    : 1;
              }
              return rows;
            });
          }
          return key === "withIndex" || key === "order" ? query(result) : result;
        };
      },
    });
  }
  const db = new Proxy(ctx.db, {
    get(target, key) {
      if (key === "query")
        return (...args: unknown[]) => query(Reflect.apply(target.query, target, args));
      if (key === "get")
        return async (...args: unknown[]) => {
          const row = await Reflect.apply(target.get, target, args);
          if (row !== null) reads++;
          return row;
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { ctx: { ...ctx, db }, reads: () => reads };
}

it("measures a full 1000-member page without touching server progress", async () => {
  const t = newTest();
  await seedWorkspace(t, {
    members: Array.from({ length: 1001 }, (_, i) => ({ userId: `user-${i}`, roleIds: ["design"] })),
  });
  const reads = await t.run(async (ctx) => {
    const meter = metered(ctx);
    const handler: (ctx: MutationCtx, args: Record<string, never>) => Promise<null> = Reflect.get(
      backfillMemberRoles,
      "_handler",
    );
    await handler(meter.ctx, {});
    return meter.reads();
  });
  expect(reads).toBe(1001); // 1000 members + server; no existing reverse links.
});

it("measures a 500-message page with ten attachment references per message", async () => {
  const t = newTest();
  await seedWorkspace(t, { members: [{ userId: "alice" }] });
  const channelId = await seedChannel(t);
  const storageId = await storeBlob(t, 1);
  await t.run(async (ctx) => {
    const fileId = await ctx.db.insert("files", {
      storageId,
      sealedStorageId: storageId,
      uploaderId: "alice",
      sizeBytes: 1,
      keyVersion: "1",
    });
    for (let i = 0; i < 501; i++) {
      await ctx.db.insert("messages", {
        channelId,
        authorId: "alice",
        ciphertext: "legacy",
        attachmentIds: Array.from({ length: 10 }, () => fileId),
        mentionUserIds: [],
      });
    }
  });
  const reads = await t.run(async (ctx) => {
    const meter = metered(ctx);
    const handler: (ctx: MutationCtx, args: Record<string, never>) => Promise<null> = Reflect.get(
      backfillAttachmentScopes,
      "_handler",
    );
    await handler(meter.ctx, {});
    return meter.reads();
  });
  expect(reads).toBe(5501); // 500 messages + 5000 file point reads + server.
});
