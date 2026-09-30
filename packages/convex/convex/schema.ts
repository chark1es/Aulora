import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Aulora data model (one server = one workspace, so no `workspaceId`).
 *
 * Content is encrypted server-side with an external key manager (EKM): the
 * server seals structured values into AES-256-GCM `aulora-sse-v1` envelopes
 * (see `lib/ekm.ts` and `lib/sse.ts`) using a root key the deployment holds
 * outside the database. Columns that read as ciphertext/envelope hold those
 * server-produced sealed strings, never client-produced ciphertext. Clients
 * send and receive plaintext; the server seals on write and opens on read.
 * Plaintext metadata (`mentionUserIds`, authorship, timestamps, indexes) stays
 * readable so the server can route, count and page without the key.
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
  /**
   * Voice policy. Optional so workspaces created before calling existed remain
   * valid; readers treat an absent value as enabled (`?? true`).
   */
  voiceEnabled: v.optional(v.boolean()),
  videoEnabled: v.optional(v.boolean()),
  screenShareEnabled: v.optional(v.boolean()),
  maxCallParticipants: v.optional(v.number()),
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
  v.literal("voice"),
  v.literal("dm"),
  v.literal("group_dm"),
);

const callKind = v.union(v.literal("voice"), v.literal("video"));
const callStatus = v.union(v.literal("ringing"), v.literal("active"), v.literal("ended"));
const callSignalKind = v.union(
  v.literal("offer"),
  v.literal("answer"),
  v.literal("ice"),
  v.literal("renegotiate"),
);

export default defineSchema({
  workspaceUpdate: defineTable({
    currentVersion: v.string(),
    latestVersion: v.union(v.string(), v.null()),
    updateAvailable: v.boolean(),
    notes: v.union(v.string(), v.null()),
    error: v.union(v.string(), v.null()),
    autoUpdate: v.boolean(),
    phase: v.union(
      v.literal("idle"),
      v.literal("checking"),
      v.literal("downloading"),
      v.literal("ready"),
      v.literal("restarting"),
    ),
    hostSeenAt: v.number(),
    checkedAt: v.number(),
    request: v.optional(v.union(v.literal("check"), v.literal("download"), v.literal("restart"))),
  }),
  server: defineTable({
    name: v.string(),
    iconSeed: v.string(),
    ownerId: v.string(),
    settings: serverSettings,
    licenseKey: v.optional(v.string()),
    licenseValidation: v.optional(
      v.object({
        keyHash: v.string(),
        licenseId: v.optional(v.string()),
        billingModel: v.optional(v.literal("monthly-active-users")),
        state: v.union(
          v.literal("unlicensed"),
          v.literal("active"),
          v.literal("expired"),
          v.literal("invalid"),
        ),
        tier: v.union(v.literal("commercial"), v.literal("noncommercial"), v.null()),
        licensee: v.union(v.string(), v.null()),
        issuedAt: v.union(v.number(), v.null()),
        expiresAt: v.union(v.number(), v.null()),
        checkedAt: v.number(),
        validUntil: v.number(),
        note: v.string(),
        tags: v.array(v.string()),
        seats: v.number(),
      }),
    ),
    description: v.optional(v.string()),
    logoStorageId: v.optional(v.id("_storage")),
  }),

  licenseReportKeys: defineTable({
    licenseId: v.string(),
    keyHash: v.string(),
    ciphertext: v.string(),
    instanceId: v.id("server"),
  }).index("by_license", ["licenseId"]),
  licenseActivity: defineTable({
    licenseId: v.string(),
    month: v.string(),
    userId: v.string(),
  }).index("by_license_month_user", ["licenseId", "month", "userId"]),
  licenseUsageMonths: defineTable({
    licenseId: v.string(),
    month: v.string(),
    activeUsers: v.number(),
    reportedAt: v.optional(v.number()),
    reportedUsers: v.optional(v.number()),
    finalReported: v.optional(v.boolean()),
  }).index("by_license_month", ["licenseId", "month"]),

  /**
   * Instance-level (operator) settings surfaced by the instance admin panel:
   * storage quotas, the push-relay target and the backup policy. A single row;
   * the workspace owner from setup is the instance admin. The relay **token**
   * is never stored here, only its presence in the deployment environment.
   */
  instanceSettings: defineTable({
    /** Total upload quota in bytes; 0 means unlimited. */
    storageQuotaBytes: v.number(),
    /** Largest single upload in bytes. */
    maxUploadBytes: v.number(),
    pushRelayEnabled: v.boolean(),
    pushRelayUrl: v.optional(v.string()),
    /** Stable opaque server id echoed in wakeups. */
    serverId: v.optional(v.string()),
    backupsEnabled: v.boolean(),
    /**
     * Per-provider auth toggles. Absent means "inherits the deployment
     * environment"; an explicit `false` hides a provider even when its
     * credentials are present.
     */
    authProviders: v.optional(
      v.object({
        github: v.optional(v.boolean()),
        google: v.optional(v.boolean()),
        microsoft: v.optional(v.boolean()),
        apple: v.optional(v.boolean()),
        oidc: v.optional(v.boolean()),
      }),
    ),
  }),

  /** Owner-managed mail transport. Secrets are server-sealed and never returned by public queries. */
  emailSettings: defineTable({
    provider: v.union(v.literal("none"), v.literal("resend"), v.literal("smtp")),
    from: v.string(),
    resendApiKeyCiphertext: v.optional(v.string()),
    smtpHost: v.optional(v.string()),
    smtpPort: v.optional(v.number()),
    smtpSecure: v.optional(v.boolean()),
    smtpUser: v.optional(v.string()),
    smtpPasswordCiphertext: v.optional(v.string()),
  }),

  /**
   * Backup run log for the instance admin panel. The Convex cron and the manual
   * control write the intent; the outside backup runner writes the result. Rows
   * never hold key material or database contents.
   */
  backups: defineTable({
    trigger: v.union(v.literal("cron"), v.literal("manual")),
    status: v.union(
      v.literal("requested"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
    ),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    sizeBytes: v.optional(v.number()),
    /** Opaque S3 key or label; never a credential. */
    location: v.optional(v.string()),
    message: v.optional(v.string()),
  }).index("by_started", ["startedAt"]),

  /**
   * Key-version registry for server-side encryption. Rows record which key
   * versions exist, their provider and whether they are still active; they
   * never hold key material or wrapped keys.
   */
  encryptionKeys: defineTable({
    keyVersion: v.string(),
    provider: v.string(),
    kekId: v.string(),
    status: v.union(v.literal("active"), v.literal("retired")),
    createdAt: v.number(),
    retiredAt: v.optional(v.number()),
  }).index("by_key_version", ["keyVersion"]),

  members: defineTable({
    userId: v.string(),
    nickname: v.optional(v.string()),
    bioCiphertext: v.optional(v.string()),
    /** Profile picture for this workspace. Absent means the generated avatar. */
    avatarStorageId: v.optional(v.id("_storage")),
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
    /**
     * Display order within its category; falls back to creation order when
     * unset.
     */
    position: v.optional(v.number()),
    /**
     * A private channel is invisible in `list` unless the viewer is an explicit
     * member (`channelMembers`), regardless of `ViewChannel` overrides. Joining
     * is by invite or by an admin adding them, never by the public join path.
     */
    private: v.optional(v.boolean()),
    /** Server-sealed channel name (`aulora-sse-v1` envelope). */
    nameCiphertext: v.optional(v.string()),
    /** Server-sealed channel topic (`aulora-sse-v1` envelope). */
    topicCiphertext: v.optional(v.string()),
    overrides: v.array(permissionOverwrite),
    archived: v.boolean(),
    /** Dedupe key for DMs and group DMs. */
    dmKey: v.optional(v.string()),
  })
    .index("by_category", ["categoryId"])
    .index("by_dm_key", ["dmKey"]),

  /**
   * Private-channel membership, kept separate from `ViewChannel`: a member can
   * see a public channel without being in `channelMembers`, but a private
   * channel is only visible to its explicit members. DMs and group DMs add
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
    /** Server-sealed message body (`aulora-sse-v1` envelope). */
    ciphertext: v.string(),
    threadRootId: v.optional(v.id("messages")),
    /** The message this one is a quoted inline reply to. */
    replyToId: v.optional(v.id("messages")),
    attachmentIds: v.array(v.id("files")),
    mentionUserIds: v.array(v.string()),
    /** Plaintext ids of channels/categories mentioned as `#name`. */
    mentionChannelIds: v.optional(v.array(v.string())),
    /** Plaintext ids of categories mentioned; absent on legacy rows. */
    mentionCategoryIds: v.optional(v.array(v.string())),
    editedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    /** Set while the message is pinned; cleared on unpin. */
    pinnedAt: v.optional(v.number()),
    /** Thread roots only: number of replies, bumped on each reply send. */
    replyCount: v.optional(v.number()),
    /** Thread roots only: creation time of the newest reply. */
    lastReplyAt: v.optional(v.number()),
  })
    // Convex appends `_creationTime` to every index, so this is
    // (channelId, _creationTime): chronological messages per channel.
    .index("by_channel_created", ["channelId"])
    // Roots-only timeline: `threadRootId` is absent for roots, and Convex
    // indexes a missing optional field as `undefined`, so an equality of
    // `undefined` selects exactly the roots without scanning replies.
    .index("by_channel_thread", ["channelId", "threadRootId"])
    .index("by_thread", ["threadRootId"])
    .index("by_channel_pinned", ["channelId", "pinnedAt"]),

  reactions: defineTable({
    messageId: v.id("messages"),
    userId: v.string(),
    /** Server-sealed emoji (`aulora-sse-v1` envelope). */
    emojiCiphertext: v.string(),
  }).index("by_message", ["messageId"]),

  readStates: defineTable({
    userId: v.string(),
    channelId: v.id("channels"),
    lastReadMessageId: v.optional(v.id("messages")),
    mentionCount: v.number(),
  }).index("by_user_channel", ["userId", "channelId"]),

  files: defineTable({
    /** Storage id of the server-sealed bytes. */
    storageId: v.id("_storage"),
    /**
     * Storage id whose bytes were sealed. It is the SSE `recordId` for
     * `file.bytes`, so `openBytes` needs it to authenticate and decrypt.
     */
    sealedStorageId: v.id("_storage"),
    uploaderId: v.string(),
    /** Plaintext byte length of the original upload. */
    sizeBytes: v.number(),
    /** Master-key version used when the bytes were sealed. */
    keyVersion: v.string(),
    nameCiphertext: v.optional(v.string()),
    mimeCiphertext: v.optional(v.string()),
    dimensionsCiphertext: v.optional(v.string()),
    blurhashCiphertext: v.optional(v.string()),
    channelId: v.optional(v.id("channels")),
  })
    .index("by_uploader", ["uploaderId"])
    .index("by_channel", ["channelId"]),

  devices: defineTable({
    userId: v.string(),
    platform: v.string(),
    pushToken: v.optional(v.string()),
    lastSeen: v.number(),
  }).index("by_user", ["userId"]),

  presence: defineTable({
    userId: v.string(),
    status: presenceStatus,
    customStatusCiphertext: v.optional(v.string()),
    lastHeartbeat: v.number(),
    /** Last heartbeat while visibly online, idle, or in do-not-disturb. */
    lastOnlineAt: v.optional(v.number()),
    /**
     * True when the user picked a status deliberately (anything other than
     * `online`). A manual status is immune to heartbeats and the staleness
     * sweep until the user explicitly sets `online` again. Absent/false means
     * the row follows automatic online/idle/offline behaviour.
     */
    manual: v.optional(v.boolean()),
  }).index("by_user", ["userId"]),

  typing: defineTable({
    channelId: v.id("channels"),
    userId: v.string(),
    expiresAt: v.number(),
  }).index("by_channel", ["channelId"]),

  /**
   * An active (or recently ended) voice/video call on a channel. Media never
   * touches the database: this row plus `callSignals` is only the WebRTC
   * signalling and presence layer. Voice channels keep one call at a time;
   * DM/group-DM calls start `ringing` until someone answers.
   */
  calls: defineTable({
    channelId: v.id("channels"),
    kind: callKind,
    initiatorId: v.string(),
    status: callStatus,
    /** Users still being rung; empty once answered or for voice channels. */
    ringingUserIds: v.array(v.string()),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    /** Plaintext id of the participant currently sharing their screen. */
    screenShareUserId: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_channel", ["channelId"])
    .index("by_status", ["status"])
    .index("by_channel_status", ["channelId", "status"]),

  /**
   * Who is currently in a call, and their live media flags. `lastSeen` is the
   * heartbeat the sweep uses to drop abandoned participants (a client crash).
   * A user has at most one row: `clientId` is the device that holds it, and
   * `session` bumps when a different device takes over.
   */
  callParticipants: defineTable({
    callId: v.id("calls"),
    channelId: v.id("channels"),
    userId: v.string(),
    /** Install id of the device in the call. Absent on rows from before device seats. */
    clientId: v.optional(v.string()),
    /** Increments when another device takes this seat, so peers renegotiate. */
    session: v.optional(v.number()),
    muted: v.boolean(),
    deafened: v.boolean(),
    video: v.boolean(),
    sharingScreen: v.boolean(),
    joinedAt: v.number(),
    lastSeen: v.number(),
  })
    .index("by_call", ["callId"])
    .index("by_call_user", ["callId", "userId"])
    .index("by_user", ["userId"])
    .index("by_channel", ["channelId"]),

  /**
   * Short-lived WebRTC signalling envelopes (SDP offers/answers and ICE
   * candidates) addressed to one participant. Rows are deleted once the
   * recipient has processed them; the sweep clears orphans from dropped peers.
   */
  callSignals: defineTable({
    callId: v.id("calls"),
    channelId: v.id("channels"),
    fromUserId: v.string(),
    toUserId: v.string(),
    kind: callSignalKind,
    payload: v.string(),
    /** Sender's seat generation. Receivers drop envelopes from an older one. */
    session: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_call", ["callId"])
    .index("by_to", ["toUserId"])
    .index("by_call_to", ["callId", "toUserId"]),

  notificationPrefs: defineTable({
    userId: v.string(),
    scope: notificationScope,
    channelId: v.optional(v.id("channels")),
    level: notificationLevel,
    muteUntil: v.optional(v.number()),
    /** Hidden from the sidebar for this viewer (per-channel only). */
    hidden: v.optional(v.boolean()),
  })
    .index("by_user_scope", ["userId", "scope"])
    .index("by_user_channel", ["userId", "channelId"]),

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
    /** Absent means permanent; `expiresAt <= Date.now()` is no longer banned. */
    expiresAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  /**
   * A private, per-author note about another member. The body is
   * server-sealed (`userNote` scope); the target and author stay plaintext so
   * the row can be looked up and shown without the key.
   */
  userNotes: defineTable({
    authorId: v.string(),
    targetUserId: v.string(),
    bodyCiphertext: v.string(),
    updatedAt: v.number(),
  })
    .index("by_author", ["authorId"])
    .index("by_author_target", ["authorId", "targetUserId"])
    .index("by_target", ["targetUserId"]),

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
