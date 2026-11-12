import { Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { clampPageSize } from "../convex/lib/pagination";
import { newTest, seedChannel, seedWorkspace, storeBlob } from "./helpers";

async function setup() {
  const t = newTest();
  const { serverId } = await seedWorkspace(t, {
    members: [{ userId: "alice" }, { userId: "bob" }],
  });
  const channelId = await seedChannel(t, { memberIds: ["alice", "bob"] });
  return {
    t,
    serverId,
    channelId,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
  };
}

describe("storage reference isolation", () => {
  it("rejects adopting another avatar and retains legacy shared avatars on clear", async () => {
    const { t, alice, bob } = await setup();
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["image"], { type: "image/png" })),
    );
    await bob.mutation(api.members.setAvatar, { storageId });
    await expect(alice.mutation(api.members.setAvatar, { storageId })).rejects.toThrow(
      "already in use",
    );
    await t.run(async (ctx) => {
      const member = (await ctx.db.query("members").collect()).find(
        (row) => row.userId === "alice",
      );
      if (member === undefined) throw new Error("Missing member");
      await ctx.db.patch(member._id, { avatarStorageId: storageId });
    });
    await alice.mutation(api.members.setAvatar, {});
    expect(await t.run(async (ctx) => ctx.storage.getUrl(storageId))).not.toBeNull();
  });

  it.each(["avatar", "logo", "file", "sealed", "thumbnail"] as const)(
    "preserves %s blobs on finalize and reclamation",
    async (kind) => {
      const { t, serverId, alice } = await setup();
      const storageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob(["image"], { type: "image/png" })),
      );
      await t.run(async (ctx) => {
        if (kind === "avatar") {
          const member = (await ctx.db.query("members").collect()).find(
            (row) => row.userId === "bob",
          );
          if (member === undefined) throw new Error("Missing member");
          await ctx.db.patch(member._id, { avatarStorageId: storageId });
        } else if (kind === "logo") {
          await ctx.db.patch(serverId, { logoStorageId: storageId });
        } else {
          const other = await ctx.storage.store(new Blob(["other"]));
          await ctx.db.insert("files", {
            storageId: kind === "file" ? storageId : other,
            sealedStorageId: kind === "sealed" ? storageId : other,
            ...(kind === "thumbnail" ? { thumbnailStorageId: storageId } : {}),
            uploaderId: "bob",
            sizeBytes: 5,
            keyVersion: "1",
          });
        }
      });
      const owner = t.withIdentity({ subject: "owner-1" });
      if (kind === "logo") {
        // Re-selecting the workspace's existing logo remains valid.
        await expect(owner.mutation(api.server.setLogo, { storageId })).resolves.toBeNull();
      } else {
        await expect(owner.mutation(api.server.setLogo, { storageId })).rejects.toThrow(
          "already in use",
        );
      }
      await expect(alice.mutation(api.members.setAvatar, { storageId })).rejects.toThrow(
        "already in use",
      );
      await expect(
        alice.action(api.files.finalize, { storageId, name: "stolen", mime: "image/png" }),
      ).rejects.toThrow("already in use");
      expect(await alice.mutation(internal.files.reclaimUploadSource, { storageId })).toBe(false);
      expect(await t.run(async (ctx) => ctx.storage.getUrl(storageId))).not.toBeNull();
    },
  );

  it("rechecks reference changes between upload authorization and insertion", async () => {
    const { t, alice } = await setup();
    const storageId = await storeBlob(t, 8);
    await alice.mutation(internal.files.authorizeUpload, { storageId });
    await t.run(async (ctx) => {
      const member = (await ctx.db.query("members").collect()).find((row) => row.userId === "bob");
      if (member === undefined) throw new Error("Missing member");
      await ctx.db.patch(member._id, { avatarStorageId: storageId });
    });
    await expect(
      alice.mutation(internal.files.insertFinalized, {
        storageId: await storeBlob(t, 16),
        sealedStorageId: storageId,
        uploaderId: "alice",
        sizeBytes: 8,
        keyVersion: "1",
        nameCiphertext: "name",
        mimeCiphertext: "mime",
      }),
    ).rejects.toThrow("already in use");
    expect(await alice.mutation(internal.files.reclaimUploadSource, { storageId })).toBe(false);
    expect(await t.run(async (ctx) => ctx.storage.getUrl(storageId))).not.toBeNull();
  });

  it("preserves plaintext uploads and thumbnails on early failure", async () => {
    const { t, alice } = await setup();
    await t.run(async (ctx) =>
      ctx.db.insert("instanceSettings", {
        storageQuotaBytes: 0,
        maxUploadBytes: 16,
        pushRelayEnabled: false,
        backupsEnabled: true,
      }),
    );
    const storageId = await storeBlob(t, 17);
    const thumbnailStorageId = await storeBlob(t, 8);
    await expect(
      alice.action(api.files.finalize, {
        storageId,
        thumbnailStorageId,
        name: "large",
        mime: "text/plain",
      }),
    ).rejects.toThrow("size cap");
    for (const id of [storageId, thumbnailStorageId]) {
      expect(await t.run(async (ctx) => ctx.storage.getUrl(id))).not.toBeNull();
    }
  });

  it.each(["missing", "oversized"] as const)(
    "allows retrying the same source after a %s thumbnail fails",
    async (kind) => {
      const { t, alice } = await setup();
      const storageId = await storeBlob(t, 8);
      const thumbnailStorageId = await storeBlob(t, kind === "oversized" ? 1024 * 1024 + 1 : 8);
      if (kind === "missing") await t.run(async (ctx) => ctx.storage.delete(thumbnailStorageId));
      await expect(
        alice.action(api.files.finalize, {
          storageId,
          thumbnailStorageId,
          name: "retry",
          mime: "image/png",
        }),
      ).rejects.toThrow(kind === "missing" ? "Upload not found" : "Thumbnail exceeds");
      expect(await t.run(async (ctx) => ctx.storage.getUrl(storageId))).not.toBeNull();
      if (kind === "oversized") {
        expect(await t.run(async (ctx) => ctx.storage.getUrl(thumbnailStorageId))).not.toBeNull();
      }
      const fileId = await alice.action(api.files.finalize, {
        storageId,
        name: "retry",
        mime: "image/png",
      });
      expect(await alice.query(api.files.get, { fileId })).not.toBeNull();
      expect(await t.run(async (ctx) => ctx.storage.getUrl(storageId))).toBeNull();
    },
  );

  it("preserves both uploads when rate limited and reclaims them after a successful retry", async () => {
    const { t, alice } = await setup();
    const storageId = await storeBlob(t, 8);
    const thumbnailStorageId = await storeBlob(t, 4);
    const bucketId = await t.run(async (ctx) =>
      ctx.db.insert("rateLimits", {
        key: "upload:user:alice",
        windowStart: Date.now(),
        count: 1000,
      }),
    );
    const args = { storageId, thumbnailStorageId, name: "retry", mime: "image/png" };
    await expect(alice.action(api.files.finalize, args)).rejects.toThrow("Rate limit");
    for (const id of [storageId, thumbnailStorageId]) {
      expect(await t.run(async (ctx) => ctx.storage.getUrl(id))).not.toBeNull();
    }
    await t.run(async (ctx) => ctx.db.delete(bucketId));
    const fileId = await alice.action(api.files.finalize, args);
    expect(await alice.query(api.files.get, { fileId })).not.toBeNull();
    for (const id of [storageId, thumbnailStorageId]) {
      expect(await t.run(async (ctx) => ctx.storage.getUrl(id))).toBeNull();
    }
  });

  it.each(["avatar", "logo", "file", "sealed", "thumbnail", "unshared"] as const)(
    "account deletion respects %s avatar references",
    async (kind) => {
      const { t, serverId } = await setup();
      const storageId = await storeBlob(t, 8);
      const memberId = await t.run(async (ctx) => {
        const member = (await ctx.db.query("members").collect()).find(
          (row) => row.userId === "alice",
        );
        if (member === undefined) throw new Error("Missing member");
        await ctx.db.patch(member._id, { avatarStorageId: storageId });
        if (kind === "avatar") {
          const bob = (await ctx.db.query("members").collect()).find((row) => row.userId === "bob");
          if (bob === undefined) throw new Error("Missing member");
          await ctx.db.patch(bob._id, { avatarStorageId: storageId });
        } else if (kind === "logo") {
          await ctx.db.patch(serverId, { logoStorageId: storageId });
        } else if (kind !== "unshared") {
          const other = await ctx.storage.store(new Blob(["other"]));
          await ctx.db.insert("files", {
            storageId: kind === "file" ? storageId : other,
            sealedStorageId: kind === "sealed" ? storageId : other,
            ...(kind === "thumbnail" ? { thumbnailStorageId: storageId } : {}),
            uploaderId: "bob",
            sizeBytes: 8,
            keyVersion: "1",
          });
        }
        return member._id;
      });
      await t.mutation(internal.accountDeletion.deleteUserData, { userId: "alice" });
      expect(await t.run(async (ctx) => ctx.db.get(memberId))).toBeNull();
      const url = await t.run(async (ctx) => ctx.storage.getUrl(storageId));
      if (kind === "unshared") expect(url).toBeNull();
      else expect(url).not.toBeNull();
    },
  );
});

describe("message content guards", () => {
  it("redacts deleted roots and replies across history, context, and thread inbox", async () => {
    const { t, alice, bob, channelId } = await setup();
    const root = await alice.mutation(api.messages.send, { channelId, body: "root secret" });
    const reply = await bob.mutation(api.messages.send, {
      channelId,
      body: "reply secret",
      threadRootId: root,
    });
    const anchor = await alice.mutation(api.messages.send, { channelId, body: "anchor" });
    const storageId = await storeBlob(t, 1);
    const fileId = await alice.action(api.files.finalize, {
      storageId,
      name: "secret",
      mime: "text/plain",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(root, {
        deletedAt: Date.now(),
        attachmentIds: [fileId],
        ciphertext: "aulora-sse-v1:invalid",
      });
      await ctx.db.patch(reply, {
        deletedAt: Date.now(),
        attachmentIds: [fileId],
        ciphertext: "aulora-sse-v1:invalid",
      });
    });
    const opts = { numItems: 100, cursor: null };
    const list = await alice.query(api.messages.list, { channelId, paginationOpts: opts });
    expect(list.page.find((m) => m.id === root)).toMatchObject({ body: "", attachmentIds: [] });
    const thread = await alice.query(api.messages.listThread, {
      threadRootId: root,
      paginationOpts: opts,
    });
    expect(thread.page[0]).toMatchObject({ body: "", attachmentIds: [] });
    const context = await alice.query(api.messages.context, { messageId: anchor });
    expect(context?.history.find((m) => m.id === root)).toMatchObject({
      body: "",
      attachmentIds: [],
    });
    const inbox = await bob.query(api.messages.threadInbox, {});
    expect(inbox.find((m) => m.id === root)?.body).toBe("");
    await expect(
      alice.mutation(api.messages.edit, { messageId: root, body: "resurrect" }),
    ).rejects.toThrow("deleted");
    await expect(
      alice.mutation(api.messages.send, { channelId, body: "reply", threadRootId: root }),
    ).rejects.toThrow("Thread root not found");
  });

  it("blocks timed-out edits and removals", async () => {
    const { t, alice, channelId } = await setup();
    const messageId = await alice.mutation(api.messages.send, {
      channelId,
      body: "before timeout",
    });
    await t.run(async (ctx) => {
      const member = (await ctx.db.query("members").collect()).find(
        (row) => row.userId === "alice",
      );
      if (member === undefined) throw new Error("Missing member");
      await ctx.db.patch(member._id, { timeoutUntil: Date.now() + 60_000 });
    });
    await expect(alice.mutation(api.messages.edit, { messageId, body: "after" })).rejects.toThrow();
    await expect(alice.mutation(api.messages.remove, { messageId })).rejects.toThrow();
  });

  it("bounds bodies and attachments, and refuses empty sends", async () => {
    const { t, alice, channelId } = await setup();
    for (const body of ["", "  \n", "x".repeat(4001)]) {
      await expect(alice.mutation(api.messages.send, { channelId, body })).rejects.toThrow();
    }
    const storageId = await storeBlob(t, 1);
    const fileId = await alice.action(api.files.finalize, {
      storageId,
      name: "file",
      mime: "text/plain",
    });
    await expect(
      alice.mutation(api.messages.send, {
        channelId,
        body: "",
        attachmentIds: Array.from({ length: 11 }, () => fileId),
      }),
    ).rejects.toThrow("Too many attachments");
    await expect(
      alice.mutation(api.messages.send, { channelId, body: "", attachmentIds: [fileId] }),
    ).resolves.toBeDefined();
    await expect(
      alice.mutation(api.messages.send, { channelId, body: "x".repeat(4000) }),
    ).resolves.toBeDefined();
  });

  it("validates attachment ownership, channel scope, existence, and current AttachFiles permission", async () => {
    const { t, alice, bob, channelId } = await setup();
    const other = await seedChannel(t);
    const upload = async (scope?: typeof channelId) =>
      alice.action(api.files.finalize, {
        storageId: await storeBlob(t, 1),
        name: "file",
        mime: "text/plain",
        ...(scope === undefined ? {} : { channelId: scope }),
      });
    const personal = await upload();
    const shared = await upload(channelId);
    const elsewhere = await upload(other);
    for (const fileId of [personal, elsewhere]) {
      await expect(
        bob.mutation(api.messages.send, { channelId, body: "file", attachmentIds: [fileId] }),
      ).rejects.toThrow("Attachment not available");
    }
    await expect(
      bob.mutation(api.messages.send, { channelId, body: "file", attachmentIds: [shared] }),
    ).resolves.toBeDefined();
    await expect(bob.query(api.files.get, { fileId: personal })).rejects.toThrow("access");
    expect(await bob.query(api.files.get, { fileId: shared })).not.toBeNull();
    await t.run(async (ctx) => ctx.db.delete(personal));
    await expect(
      alice.mutation(api.messages.send, { channelId, body: "missing", attachmentIds: [personal] }),
    ).rejects.toThrow("Attachment not available");
    await t.run(async (ctx) =>
      ctx.db.patch(channelId, {
        overrides: [
          { targetType: "member", targetId: "bob", allow: 0n, deny: Permission.AttachFiles },
        ],
      }),
    );
    await expect(
      bob.mutation(api.messages.send, { channelId, body: "file", attachmentIds: [shared] }),
    ).rejects.toThrow("permission to attach");
  });

  it("scopes an unscoped upload to the channel once its uploader sends it", async () => {
    const { t, alice, bob, channelId } = await setup();
    const fileId = await alice.action(api.files.finalize, {
      storageId: await storeBlob(t, 1),
      name: "file",
      mime: "text/plain",
    });
    await expect(bob.query(api.files.get, { fileId })).rejects.toThrow("access");
    await alice.mutation(api.messages.send, { channelId, body: "file", attachmentIds: [fileId] });
    expect(await bob.query(api.files.get, { fileId })).not.toBeNull();
  });

  it("excludes thread replies from unread totals and mentions", async () => {
    const { t, alice, bob, channelId } = await setup();
    const root = await alice.mutation(api.messages.send, { channelId, body: "root" });
    await bob.mutation(api.readStates.set, { channelId, lastReadMessageId: root });
    await alice.mutation(api.messages.send, {
      channelId,
      body: "reply",
      threadRootId: root,
      mentionUserIds: ["bob"],
    });
    expect(await bob.query(api.notifications.unreadSummary, {})).toEqual({ total: 0, mentions: 0 });
    await t.finishAllScheduledFunctions(() => {});
  });
});

describe("public pagination bounds", () => {
  it("retains normal sizes and bounds invalid/extreme sizes", () => {
    expect(clampPageSize(25)).toBe(25);
    for (const size of [101, 100000, Number.NaN, Number.POSITIVE_INFINITY])
      expect(clampPageSize(size)).toBe(100);
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(-2)).toBe(1);
    expect(clampPageSize(2.8)).toBe(2);
  });

  it("caps the other public history and directory windows", async () => {
    const { t, alice, channelId } = await setup();
    const owner = t.withIdentity({ subject: "owner-1" });
    const root = await alice.mutation(api.messages.send, { channelId, body: "root" });
    await t.run(async (ctx) => {
      for (let i = 0; i < 105; i++) {
        await ctx.db.insert("messages", {
          channelId,
          authorId: "alice",
          ciphertext: "reply",
          attachmentIds: [],
          mentionUserIds: [],
          threadRootId: root,
        });
        await ctx.db.insert("messages", {
          channelId,
          authorId: "alice",
          ciphertext: "pin",
          attachmentIds: [],
          mentionUserIds: [],
          pinnedAt: i,
        });
        await ctx.db.insert("channels", { kind: "text", overrides: [], archived: false });
        const dm = await ctx.db.insert("channels", {
          kind: "dm",
          dmKey: `alice:synthetic-${i}`,
          overrides: [],
          archived: false,
        });
        await ctx.db.insert("channelMembers", { channelId: dm, userId: "alice", joinedAt: i });
        await ctx.db.insert("invites", {
          code: `synthetic-${i}`,
          createdBy: "owner-1",
          maxUses: 1,
          uses: 0,
        });
        await ctx.db.insert("auditLog", { actorId: "owner-1", action: "synthetic", at: i });
      }
    });
    const paginationOpts = { numItems: 10000, cursor: null };
    const results = await Promise.all([
      alice.query(api.messages.listThread, { threadRootId: root, paginationOpts }),
      alice.query(api.messages.listPins, { channelId, paginationOpts }),
      alice.query(api.channels.list, { paginationOpts }),
      alice.query(api.channels.listDms, { paginationOpts }),
      owner.query(api.invites.list, { paginationOpts }),
      owner.query(api.auditLog.list, { paginationOpts }),
    ]);
    for (const result of results) {
      expect(result.page).toHaveLength(100);
      expect(result.isDone).toBe(false);
    }
  });

  it("caps timeline pages and preserves continuation", async () => {
    const { t, alice, channelId } = await setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 105; i++)
        await ctx.db.insert("messages", {
          channelId,
          authorId: "alice",
          ciphertext: `message ${i}`,
          attachmentIds: [],
          mentionUserIds: [],
        });
    });
    const page = await alice.query(api.messages.list, {
      channelId,
      paginationOpts: { numItems: 10000, cursor: null },
    });
    expect(page.page).toHaveLength(100);
    expect(page.isDone).toBe(false);
    const next = await alice.query(api.messages.list, {
      channelId,
      paginationOpts: { numItems: 10000, cursor: page.continueCursor },
    });
    expect(next.page).toHaveLength(5);
    expect(next.isDone).toBe(true);
  });
});
