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
    /** Latest MLS epoch published for the channel, if any. */
    currentEpoch: v.optional(v.number()),
  })
    .index("by_category", ["categoryId"])
    .index("by_dm_key", ["dmKey"]),

  /**
   * MLS group membership, kept separate from `ViewChannel`: a member can see a
   * public channel without being in its MLS group yet. DMs and group DMs add
   * every participant on creation.
   */
  channelMembers: defineTable({
    channelId: v.id("channels"),
    userId: v.string(),
    joinedAt: v.number(),
  })
    .index("by_channel", ["channelId"])
    .index("by_user", ["userId"])
    .index("by_channel_user", ["channelId", "userId"]),

  messages: defineTable({
    channelId: v.id("channels"),
    /** Plaintext metadata: the user who authored the message. */
    authorId: v.string(),
    authorDeviceId: v.optional(v.id("devices")),
    ciphertext: v.string(),
    epoch: v.number(),
    threadRootId: v.optional(v.id("messages")),
    attachmentIds: v.array(v.id("files")),
    mentionUserIds: v.array(v.string()),
    editedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    /** Set while the message is pinned; cleared on unpin. */
    pinnedAt: v.optional(v.number()),
  })
    // Convex appends `_creationTime` to every index, so this is
    // (channelId, _creationTime): chronological messages per channel.
    .index("by_channel_created", ["channelId"])
    .index("by_thread", ["threadRootId"])
    .index("by_channel_pinned", ["channelId", "pinnedAt"]),

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
    /** X25519 public key a sender seals a history bundle to (Phase 5). */
    sharingKey: v.optional(v.string()),
    lastSeen: v.number(),
    /** Set once an existing verified device (or bootstrap) approves it. */
    verifiedAt: v.optional(v.number()),
    /** The device that approved this one, when approval was device-to-device. */
    verifiedByDeviceId: v.optional(v.id("devices")),
    verificationMethod: v.optional(
      v.union(v.literal("safety_number"), v.literal("qr"), v.literal("bootstrap")),
    ),
  }).index("by_user", ["userId"]),

  /**
   * Append-only record of device approvals. The `devices` row carries the
   * current state; this table is the audit trail of who verified whom.
   */
  deviceApprovals: defineTable({
    userId: v.string(),
    deviceId: v.id("devices"),
    /** The verifying device, or the device itself for a bootstrap approval. */
    approverDeviceId: v.id("devices"),
    method: v.union(v.literal("safety_number"), v.literal("qr"), v.literal("bootstrap")),
    /** 60-digit safety number the approver confirmed (empty for bootstrap). */
    safetyNumber: v.string(),
    approvedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_device", ["deviceId"]),

  keyPackages: defineTable({
    deviceId: v.id("devices"),
    keyPackage: v.string(),
    usedAt: v.optional(v.number()),
  }).index("by_device_unused", ["deviceId", "usedAt"]),

  /**
   * A device asking to be added to a channel's MLS group. `keyPackage` is a
   * public KeyPackage; an online member's client reads it, builds the Add
   * commit + Welcome, appends them through `mls.appendCommit`, then marks the
   * intent serviced. The server never sees a private key.
   */
  joinIntents: defineTable({
    channelId: v.id("channels"),
    userId: v.string(),
    deviceId: v.id("devices"),
    keyPackage: v.string(),
    createdAt: v.number(),
    servicedAt: v.optional(v.number()),
  })
    .index("by_channel", ["channelId"])
    .index("by_channel_serviced", ["channelId", "servicedAt"])
    .index("by_device", ["deviceId"]),

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
    updatedAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  /**
   * Opaque history bundles: an existing device seals a channel history key to a
   * new device's X25519 `sharingKey`. The server relays the envelope and can
   * never open it. `consumedAt` lets a device mark a bundle imported.
   */
  historyBundles: defineTable({
    channelId: v.id("channels"),
    recipientUserId: v.string(),
    recipientDeviceId: v.id("devices"),
    envelope: v.string(),
    createdAt: v.number(),
    consumedAt: v.optional(v.number()),
  })
    .index("by_recipient_device", ["recipientDeviceId"])
    .index("by_channel", ["channelId"]),

  /**
   * Encrypted channel-history snapshots. The ciphertext is encrypted under the
   * channel history key, so only devices that received the key via a bundle can
   * read it. At most one snapshot per (channel, epoch).
   */
  historyArchives: defineTable({
    channelId: v.id("channels"),
    epoch: v.number(),
    archiveCiphertext: v.string(),
    createdAt: v.number(),
  }).index("by_channel_epoch", ["channelId", "epoch"]),

  /**
   * A new device asking an online member to share a channel's history key. The
   * member reads the requester's `sharingKey`, seals the key and writes a
   * `historyBundles` row, then marks the request serviced.
   */
  historyRequests: defineTable({
    channelId: v.id("channels"),
    userId: v.string(),
    deviceId: v.id("devices"),
    createdAt: v.number(),
    servicedAt: v.optional(v.number()),
  })
    .index("by_channel", ["channelId"])
    .index("by_device", ["deviceId"]),

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

  /**
   * Invite links. `code` stores the SHA-256 hex digest of the plaintext code,
   * never the code itself; the plaintext is returned only once, at creation.
   * `maxUses` of 0 means unlimited.
   */
  invites: defineTable({
    code: v.string(),
    createdBy: v.string(),
    maxUses: v.number(),
    uses: v.number(),
    expiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  }).index("by_code", ["code"]),

  /**
   * Permanently banned users. A ban removes the member and their channel
   * memberships; the row here is what blocks a later invite redemption.
   */
  bans: defineTable({
    userId: v.string(),
    actorId: v.string(),
    reason: v.optional(v.string()),
    at: v.number(),
  }).index("by_user", ["userId"]),

  auditLog: defineTable({
    actorId: v.string(),
    action: v.string(),
    targetId: v.optional(v.string()),
    meta: v.optional(v.string()),
    at: v.number(),
  }).index("by_at", ["at"]),

  /**
   * Fixed-window rate-limit counters. `key` is namespaced by action and actor,
   * for example `send:user:<id>` or `upload:ip:<addr>`. Server-only; never
   * returned to clients.
   */
  rateLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),
});
