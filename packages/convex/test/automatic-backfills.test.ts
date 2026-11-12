import { Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { newTest, seedChannel, seedWorkspace, storeBlob } from "./helpers";

describe("automatic compatibility backfills", () => {
  it("repairs legacy attachment scope across persisted batches and is idempotent", async () => {
    const t = newTest();
    const { serverId } = await seedWorkspace(t, {
      members: [{ userId: "alice" }, { userId: "bob" }],
    });
    const channelId = await seedChannel(t, { memberIds: ["alice", "bob"] });
    const alice = t.withIdentity({ subject: "alice" });
    const bob = t.withIdentity({ subject: "bob" });
    const fileId = await alice.action(api.files.finalize, {
      storageId: await storeBlob(t, 1),
      name: "legacy",
      mime: "text/plain",
    });
    const skipped = await alice.action(api.files.finalize, {
      storageId: await storeBlob(t, 1),
      name: "deleted",
      mime: "text/plain",
    });
    await t.run(async (ctx) => {
      // Old clients sent attachmentIds without ever setting files.channelId.
      for (let i = 0; i < 501; i++)
        await ctx.db.insert("messages", {
          channelId,
          authorId: "alice",
          ciphertext: "legacy",
          attachmentIds: [],
          mentionUserIds: [],
        });
      await ctx.db.insert("messages", {
        channelId,
        authorId: "alice",
        ciphertext: "legacy",
        attachmentIds: [fileId],
        mentionUserIds: [],
      });
      await ctx.db.insert("messages", {
        channelId,
        authorId: "alice",
        ciphertext: "legacy",
        attachmentIds: [skipped],
        mentionUserIds: [],
        deletedAt: 1,
      });
    });
    await expect(bob.query(api.files.get, { fileId })).rejects.toThrow("access");
    const initial = await t.run((ctx) => ctx.db.get(serverId));
    const publicConfig = await t.query(api.server.publicConfig, {});
    await t.mutation(internal.maintenance.backfillAttachmentScopes, {});
    const before = await t.run((ctx) => ctx.db.get(serverId));
    expect(before).toEqual(initial);
    expect(await t.query(api.server.publicConfig, {})).toEqual(publicConfig);
    const first = await t.run((ctx) => ctx.db.query("migrationProgress").first());
    expect(first?.cursor).toBeTypeOf("string");
    expect(first?.processed).toBe(500);
    await expect(bob.query(api.files.get, { fileId })).rejects.toThrow("access");
    await t.mutation(internal.maintenance.backfillAttachmentScopes, {});
    expect(await bob.query(api.files.get, { fileId })).not.toBeNull();
    await expect(bob.query(api.files.get, { fileId: skipped })).rejects.toThrow("access");
    const completed = await t.run((ctx) => ctx.db.get(serverId));
    expect(completed?.attachmentScopesBackfilled).toBe(true);
    expect(completed?.attachmentScopesBackfillCursor).toBeUndefined();
    await t.mutation(internal.maintenance.backfillAttachmentScopes, {});
    expect(await t.run((ctx) => ctx.db.get(serverId))).toEqual(completed);
  });

  it("does not turn another author's legacy reference into upload consent", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "alice" }, { userId: "bob" }] });
    const channelId = await seedChannel(t, { memberIds: ["alice", "bob"] });
    const alice = t.withIdentity({ subject: "alice" });
    const bob = t.withIdentity({ subject: "bob" });
    const stolen = await alice.action(api.files.finalize, {
      storageId: await storeBlob(t, 1),
      name: "private",
      mime: "text/plain",
    });
    const legitimate = await alice.action(api.files.finalize, {
      storageId: await storeBlob(t, 1),
      name: "shared",
      mime: "text/plain",
    });
    await t.run(async (ctx) => {
      for (const [authorId, fileId] of [
        ["bob", stolen],
        ["alice", legitimate],
      ] as const) {
        await ctx.db.insert("messages", {
          channelId,
          authorId,
          ciphertext: "legacy",
          attachmentIds: [fileId],
          mentionUserIds: [],
        });
      }
    });
    await t.mutation(internal.maintenance.backfillAttachmentScopes, {});
    expect((await t.run((ctx) => ctx.db.get(stolen)))?.channelId).toBeUndefined();
    await expect(bob.query(api.files.get, { fileId: stolen })).rejects.toThrow("access");
    await expect(bob.query(api.files.get, { fileId: legitimate })).resolves.not.toBeNull();
    expect(
      (await t.run((ctx) => ctx.db.query("migrationProgress").first()))?.skippedReferences,
    ).toBe(1);
  });

  it("leaves board scopes, existing channel scopes, and missing files alone", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "alice" }] });
    const channelId = await seedChannel(t);
    const otherChannelId = await seedChannel(t);
    const storageId = await storeBlob(t, 1);
    const ids = await t.run(async (ctx) => {
      const boardId = await ctx.db.insert("kanbanBoards", {
        contentCiphertext: "legacy",
        private: false,
        memberIds: [],
        creatorId: "alice",
        archived: false,
        updatedAt: 1,
      });
      const base = {
        storageId,
        sealedStorageId: storageId,
        uploaderId: "alice",
        sizeBytes: 1,
        keyVersion: "1",
      };
      const board = await ctx.db.insert("files", { ...base, kanbanBoardId: boardId });
      const scoped = await ctx.db.insert("files", { ...base, channelId: otherChannelId });
      const missing = await ctx.db.insert("files", base);
      await ctx.db.delete(missing);
      await ctx.db.insert("messages", {
        channelId,
        authorId: "alice",
        ciphertext: "legacy",
        attachmentIds: [board, scoped, missing],
        mentionUserIds: [],
      });
      return { board, scoped };
    });
    await t.mutation(internal.maintenance.backfillAttachmentScopes, {});
    expect((await t.run((ctx) => ctx.db.get(ids.board)))?.channelId).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get(ids.scoped)))?.channelId).toBe(otherChannelId);
  });

  it("automatically completes role links over multiple ticks and then does nothing", async () => {
    const t = newTest();
    const users = Array.from({ length: 1005 }, (_, i) => `member-${i}`);
    const { serverId } = await seedWorkspace(t, {
      members: users.map((userId) => ({ userId, roleIds: ["design"] })),
    });
    const initial = await t.run((ctx) => ctx.db.get(serverId));
    const publicConfig = await t.query(api.server.publicConfig, {});
    await t.mutation(internal.maintenance.backfillMemberRoles, {});
    expect(await t.run((ctx) => ctx.db.get(serverId))).toEqual(initial);
    expect(await t.query(api.server.publicConfig, {})).toEqual(publicConfig);
    expect((await t.run((ctx) => ctx.db.query("migrationProgress").first()))?.processed).toBe(1000);
    // Concurrent writer updates a scanned member through the normal link sync.
    await t.run(async (ctx) => {
      const { syncMemberRoles } = await import("../convex/lib/memberRoles");
      const member = await ctx.db.query("members").first();
      if (member === null) throw new Error("Missing seeded member");
      await ctx.db.patch(member._id, { roleIds: [] });
      await syncMemberRoles(ctx, member.userId, [], 1);
    });
    await t.mutation(internal.maintenance.backfillMemberRoles, {});
    expect((await t.run((ctx) => ctx.db.get(serverId)))?.memberRolesBackfilled).toBe(true);
    const rows = await t.run((ctx) => ctx.db.query("memberRoles").collect());
    expect(rows).toHaveLength(1004);
    await t.mutation(internal.maintenance.backfillMemberRoles, {});
    expect(await t.run((ctx) => ctx.db.query("memberRoles").collect())).toEqual(rows);
  });

  it.each(["private", "dm", "overrides", "category"])(
    "limits role expansion to %s audience but preserves explicit mentions",
    async (kind) => {
      const t = newTest();
      await seedWorkspace(t, {
        members: ["alice", "bob", "outsider", "explicit"].map((userId) => ({
          userId,
          roleIds: ["design"],
        })),
      });
      await t.run(async (ctx) => {
        await ctx.db.insert("roles", {
          key: "design",
          name: "Design",
          position: 1,
          permissions: 0n,
          hoisted: false,
          mentionable: true,
        });
      });
      const channelId = await seedChannel(t, {
        kind: kind === "dm" ? "dm" : "text",
        memberIds: ["alice", "bob"],
      });
      await t.run(async (ctx) => {
        const overrides = (
          kind === "private" || kind === "dm" ? ["explicit"] : ["outsider", "explicit"]
        ).map((targetId) => ({
          targetType: "member" as const,
          targetId,
          allow: 0n,
          deny: Permission.ViewChannel,
        }));
        if (kind === "private" || kind === "dm")
          await ctx.db.patch(channelId, { private: kind === "private", overrides });
        if (kind === "overrides") await ctx.db.patch(channelId, { overrides });
        if (kind === "category") {
          const categoryId = await ctx.db.insert("categories", {
            name: "Restricted",
            position: 0,
            overrides,
          });
          await ctx.db.patch(channelId, { categoryId });
        }
      });
      const id = await t.withIdentity({ subject: "alice" }).mutation(api.messages.send, {
        channelId,
        body: "ping",
        mentionRoleIds: ["design"],
        mentionUserIds: ["explicit"],
      });
      const message = await t.run((ctx) => ctx.db.get(id));
      expect(new Set(message?.mentionUserIds)).toEqual(new Set(["alice", "bob", "explicit"]));
      await t.finishAllScheduledFunctions(() => {});
    },
  );

  it("returns the same finalized file after response loss, without accepting another uploader", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "alice" }, { userId: "bob" }] });
    const storageId = await storeBlob(t, 3);
    const args = { storageId, name: "retry", mime: "text/plain" };
    const alice = t.withIdentity({ subject: "alice" });
    const id = await alice.action(api.files.finalize, args);
    // Both actions may authorize before either inserts: the insert itself must deduplicate too.
    const row = await t.run((ctx) => ctx.db.get(id));
    if (row === null) throw new Error("Missing finalized file");
    expect(
      await t.mutation(internal.files.insertFinalized, {
        storageId: await storeBlob(t, 8),
        sealedStorageId: storageId,
        uploaderId: "alice",
        sizeBytes: 3,
        keyVersion: row.keyVersion,
        nameCiphertext: row.nameCiphertext ?? "",
        mimeCiphertext: row.mimeCiphertext ?? "",
      }),
    ).toBe(id);
    expect(await alice.action(api.files.finalize, args)).toBe(id);
    expect(await t.run((ctx) => ctx.db.query("files").collect())).toHaveLength(1);
    await expect(
      t.withIdentity({ subject: "bob" }).action(api.files.finalize, args),
    ).rejects.toThrow("already in use");
  });
  it("rejects scope changes at both finalize retry gates", async () => {
    const t = newTest();
    const { serverId } = await seedWorkspace(t, {
      ownerId: "alice",
      members: [{ userId: "alice" }],
    });
    await t.run(async (ctx) => {
      const server = await ctx.db.get(serverId);
      if (server === null) throw new Error("Missing server");
      await ctx.db.patch(serverId, { settings: { ...server.settings, kanbanEnabled: true } });
    });
    const channelId = await seedChannel(t);
    const otherChannelId = await seedChannel(t);
    const boardId = await t.run((ctx) =>
      ctx.db.insert("kanbanBoards", {
        contentCiphertext: "board",
        private: false,
        memberIds: [],
        creatorId: "alice",
        archived: false,
        updatedAt: 1,
      }),
    );
    const alice = t.withIdentity({ subject: "alice" });
    const storageId = await storeBlob(t, 3);
    const args = { storageId, name: "retry", mime: "text/plain", channelId };
    const id = await alice.action(api.files.finalize, args);
    expect(await alice.action(api.files.finalize, args)).toBe(id);
    for (const scope of [{ channelId: otherChannelId }, {}, { kanbanBoardId: boardId }]) {
      await expect(
        alice.action(api.files.finalize, {
          storageId,
          name: "retry",
          mime: "text/plain",
          ...scope,
        }),
      ).rejects.toThrow("different channel or board scope");
      const row = await t.run((ctx) => ctx.db.get(id));
      if (row === null) throw new Error("Missing file");
      await expect(
        t.mutation(internal.files.insertFinalized, {
          storageId: row.storageId,
          sealedStorageId: storageId,
          uploaderId: "alice",
          sizeBytes: 3,
          keyVersion: row.keyVersion,
          nameCiphertext: "",
          mimeCiphertext: "",
          ...scope,
        }),
      ).rejects.toThrow("different channel or board scope");
    }
  });
});
