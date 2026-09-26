import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Aulora data model (one server = one workspace, so no `workspaceId`).
 *
 * Every `*Ciphertext`, `keyPackage`, `identityKey`, `backupCiphertext` and
 * `commitCiphertext` value is an opaque string produced by a client. Server
 * code stores, relays and indexes it, but never parses or decrypts it.
 * `mentionUserIds` stays plaintext by design so the server can count mentions
 * and route push notifications.
 */

const permissionOverwrite = v.object({
  targetId: v.string(),
  targetType: v.union(v.literal("role"), v.literal("member")),
  allow: v.int64(),
  deny: v.int64(),
});

const serverSettings = v.object({
  signupEnabled: v.boolean(),
  inviteOnly: v.boolean(),
  allowedEmailDomains: v.array(v.string()),
});

const notificationScope = v.union(v.literal("server"), v.literal("channel"));
const notificationLevel = v.union(v.literal("all"), v.literal("mentions"), v.literal("nothing"));

const presenceStatus = v.union(
  v.literal("online"),
  v.literal("idle"),
  v.literal("dnd"),
  v.literal("offline"),
);

const channelKind = v.union(
  v.literal("text"),
  v.literal("announcement"),
  v.literal("dm"),
  v.literal("group_dm"),
);

export default defineSchema({
  server: defineTable({
    name: v.string(),
    iconSeed: v.string(),
    ownerId: v.string(),
    settings: serverSettings,
    licenseKey: v.optional(v.string()),
  }),

  members: defineTable({
    userId: v.string(),
    nickname: v.optional(v.string()),
    roleIds: v.array(v.string()),
    joinedAt: v.number(),
    timeoutUntil: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  roles: defineTable({
    /** Stable key such as `@everyone`; `_id` is used when absent. */
    key: v.optional(v.string()),
    name: v.string(),
    color: v.optional(v.string()),
    position: v.number(),
    permissions: v.int64(),
    hoisted: v.boolean(),
    mentionable: v.boolean(),
  }).index("by_position", ["position"]),

  categories: defineTable({
    name: v.string(),
    position: v.number(),
    overrides: v.array(permissionOverwrite),
  }).index("by_position", ["position"]),

  channels: defineTable({
    categoryId: v.optional(v.id("categories")),
    kind: channelKind,
    nameCiphertext: v.optional(v.string()),
    topicCiphertext: v.optional(v.string()),
    mlsGroupId: v.optional(v.string()),
    overrides: v.array(permissionOverwrite),
    archived: v.boolean(),
    /** Dedupe key for DMs and group DMs. */
    dmKey: v.optional(v.string()),
  })
    .index("by_category", ["categoryId"])
    .index("by_dm_key", ["dmKey"]),

  messages: defineTable({
    channelId: v.id("channels"),
    authorDeviceId: v.optional(v.id("devices")),
    ciphertext: v.string(),
    epoch: v.number(),
    threadRootId: v.optional(v.id("messages")),
    attachmentIds: v.array(v.id("files")),
    mentionUserIds: v.array(v.string()),
    editedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  })
    // Convex appends `_creationTime` to every index, so this is
    // (channelId, _creationTime): chronological messages per channel.
    .index("by_channel_created", ["channelId"])
    .index("by_thread", ["threadRootId"]),

  reactions: defineTable({
    messageId: v.id("messages"),
    userId: v.string(),
    emojiCiphertext: v.string(),
  }).index("by_message", ["messageId"]),

  readStates: defineTable({
    userId: v.string(),
    channelId: v.id("channels"),
    lastReadMessageId: v.optional(v.id("messages")),
    mentionCount: v.number(),
  }).index("by_user_channel", ["userId", "channelId"]),

  files: defineTable({
    storageId: v.id("_storage"),
    uploaderId: v.string(),
    sizeBytes: v.number(),
    nameCiphertext: v.optional(v.string()),
    mimeCiphertext: v.optional(v.string()),
    dimensionsCiphertext: v.optional(v.string()),
    blurhashCiphertext: v.optional(v.string()),
  }).index("by_uploader", ["uploaderId"]),

  devices: defineTable({
    userId: v.string(),
    platform: v.string(),
    pushToken: v.optional(v.string()),
    identityKey: v.string(),
    lastSeen: v.number(),
  }).index("by_user", ["userId"]),

  keyPackages: defineTable({
    deviceId: v.id("devices"),
    keyPackage: v.string(),
    usedAt: v.optional(v.number()),
  }).index("by_device_unused", ["deviceId", "usedAt"]),

  mlsCommits: defineTable({
    channelId: v.id("channels"),
    epoch: v.number(),
    commitCiphertext: v.string(),
    welcomeCiphertext: v.optional(v.string()),
  }).index("by_channel_epoch", ["channelId", "epoch"]),

  keyBackups: defineTable({
    userId: v.string(),
    backupCiphertext: v.string(),
    kdfParams: v.string(),
  }).index("by_user", ["userId"]),

  presence: defineTable({
    userId: v.string(),
    status: presenceStatus,
    customStatusCiphertext: v.optional(v.string()),
    lastHeartbeat: v.number(),
  }).index("by_user", ["userId"]),

  typing: defineTable({
    channelId: v.id("channels"),
    userId: v.string(),
    expiresAt: v.number(),
  }).index("by_channel", ["channelId"]),

  notificationPrefs: defineTable({
    userId: v.string(),
    scope: notificationScope,
    channelId: v.optional(v.id("channels")),
    level: notificationLevel,
    muteUntil: v.optional(v.number()),
    keywordsCiphertext: v.optional(v.string()),
  }).index("by_user_scope", ["userId", "scope"]),

  invites: defineTable({
    code: v.string(),
    createdBy: v.string(),
    maxUses: v.number(),
    uses: v.number(),
    expiresAt: v.optional(v.number()),
  }).index("by_code", ["code"]),

  auditLog: defineTable({
    actorId: v.string(),
    action: v.string(),
    targetId: v.optional(v.string()),
    meta: v.optional(v.string()),
    at: v.number(),
  }).index("by_at", ["at"]),
});
