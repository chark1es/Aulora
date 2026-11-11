import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { botTables } from "./botSchema";
import { webhookTables } from "./webhookSchema";

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
  kanbanEnabled: v.optional(v.boolean()),
  notesEnabled: v.optional(v.boolean()),
  /**
   * Call addons. Optional and absent by default: a workspace that predates the
   * addons reads every flag as disabled (`=== true`).
   */
  transcriptionEnabled: v.optional(v.boolean()),
  scheduledCallsEnabled: v.optional(v.boolean()),
  guestCallsEnabled: v.optional(v.boolean()),
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
  /**
   * Operator kill switches. Optional and absent by default; absent or `false`
   * means the feature stays on. Readers normalize with
   * `resolveFeatureFlags`, so a malformed stored value cannot disable a
   * feature.
   */
  disableNewCallTransport: v.optional(v.boolean()),
  disablePipVideo: v.optional(v.boolean()),
  disableAutoDegrade: v.optional(v.boolean()),
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
/**
 * Why a call ended when the reason is not simply that its last participant
 * left. `alone` is the solo-call auto-disconnect (see `calls.enforceAlone`).
 */
const callEndedReason = v.union(v.literal("alone"));
const callSignalKind = v.union(
  v.literal("offer"),
  v.literal("answer"),
  v.literal("ice"),
  v.literal("renegotiate"),
);

export default defineSchema({
  coolifyUpdate: defineTable({
    targetVersion: v.string(),
    gitTag: v.string(),
    githubRepo: v.string(),
    phase: v.union(v.literal("installing"), v.literal("installed"), v.literal("failed")),
    startedAt: v.number(),
    deploymentUuid: v.optional(v.string()),
    error: v.union(v.string(), v.null()),
  }),
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
  /** Internal migration bookkeeping; never read by publicConfig. */
  migrationProgress: defineTable({
    key: v.string(),
    cursor: v.optional(v.string()),
    processed: v.number(),
    skippedReferences: v.number(),
  }).index("by_key", ["key"]),
  server: defineTable({
    name: v.string(),
    iconSeed: v.string(),
    /**
     * Legacy single-owner field. It always names an owner so older clients and
     * backups that only understand one owner keep working. Multi-owner servers
     * keep it in sync with the first entry of `ownerIds`.
     */
    ownerId: v.string(),
    /**
     * Every workspace owner. Optional so workspaces created before multiple
     * owners existed remain valid; readers use `ownerIdsOf` in
     * `lib/owners.ts`, which falls back to `[ownerId]`. New writes maintain
     * both fields, and `ownerId` always stays one of these ids.
     */
    ownerIds: v.optional(v.array(v.string())),
    settings: serverSettings,
    /**
     * Maintained number of `members` rows, kept on join/kick/ban/bot-create.
     * Optional so workspaces created before it remain valid; an absent value
     * means "not backfilled yet" and readers fall back to a member scan.
     */
    memberCount: v.optional(v.number()),
    /**
     * True once `maintenance:backfillMemberRoles` has seeded the whole
     * `memberRoles` reverse table. Role deletion uses the reverse table only
     * after this marker, so a partially backfilled workspace keeps the safe
     * full-scan fallback.
     */
    memberRolesBackfilled: v.optional(v.boolean()),
    memberRolesBackfillCursor: v.optional(v.string()),
    attachmentScopesBackfilled: v.optional(v.boolean()),
    attachmentScopesBackfillCursor: v.optional(v.string()),
    /**
     * One-shot data migrations already completed for this workspace. The setup
     * container checks a marker before re-running a value-based migration, so
     * an owner's later intentional change is not undone on the next deploy.
     * Optional: a workspace without it simply has not recorded any marker yet.
     */
    appliedMigrations: v.optional(v.array(v.string())),
    /**
     * Ownership transitions reserved while an owner deletes their account. A
     * reservation is a short-lived pending-deletion marker, not an ownership
     * change: the owner keeps their place until cleanup commits. Reservations
     * count against the last-owner guard so two concurrent deletions cannot
     * both pass it, and they expire so a failed deletion releases itself.
     * Optional: older workspaces have no pending deletions.
     */
    ownerDeletionReservations: v.optional(
      v.array(v.object({ userId: v.string(), reservedAt: v.number() })),
    ),
    /**
     * Owner ids the recovery path has flagged as orphaned (an auth user is gone
     * and no other live owner remains). Persisting the flagged state lets the
     * hourly prune record one `owner.deletion.orphaned` audit transition instead
     * of appending another row on every run. Cleared when the workspace heals.
     * Optional: older workspaces have never flagged anyone.
     */
    ownerDeletionAlerts: v.optional(v.array(v.string())),
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
  }).index("by_logo_storage", ["logoStorageId"]),

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
   * One-time first-run claim proof. A fresh instance prints a random setup
   * token in the setup container's logs and stores only its SHA-256 digest
   * here; the row is deleted when the owner is claimed. `SETUP_TOKEN` in the
   * deployment environment is an optional operator override and is never
   * copied into this table. There is at most one row.
   */
  setupClaims: defineTable({
    tokenHash: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  }),

  /**
   * One-time OAuth handoff codes for native and desktop clients. `codeHash`
   * is the SHA-256 hex digest of a random 256-bit code; the plaintext is never
   * stored. `challenge` is the PKCE-style SHA-256 digest of the client-held
   * verifier, so `native/exchange` can only consume a code from the client that
   * started that sign-in. `sessionCiphertext` is the session token sealed with
   * the server-side `aulora-sse-v1` envelope. A row is deleted when consumed or
   * when the bounded expiry prune reaches it.
   */
  nativeAuthHandoffs: defineTable({
    codeHash: v.string(),
    challenge: v.string(),
    sessionCiphertext: v.string(),
    /** Workspace origin that minted the code, as returned to the client. */
    server: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_code_hash", ["codeHash"])
    // The prune reads only expired rows instead of scanning the table.
    .index("by_expires", ["expiresAt"]),

  /**
   * One in-flight native/desktop OAuth start, created by `native/start` and
   * consumed by `native/finish`. `txHash` is the SHA-256 digest of the
   * client-generated transaction id that is also held in an HttpOnly cookie, so
   * a finish URL replayed in another browser cannot redeem the session cookie
   * that navigation carries. `returnTarget` is the exact `return` value the
   * client asked for, and `challenge` the PKCE-style verifier digest. Rows live
   * at most ten minutes and are swept through `by_expires`.
   */
  nativeAuthTransactions: defineTable({
    txHash: v.string(),
    challenge: v.string(),
    returnTarget: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    /**
     * Finish attempts charged against this one live transaction in the current
     * fixed window. Keeping the counter on the row isolates it by the actual
     * transaction id instead of a shared hash bucket, so one caller cannot
     * exhaust another flow's allowance. Additive: older rows have neither.
     */
    finishAttempts: v.optional(v.number()),
    finishWindowStart: v.optional(v.number()),
  })
    .index("by_tx_hash", ["txHash"])
    .index("by_expires", ["expiresAt"]),

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
     * credentials are present. `local` gates email/password sign-in and takes
     * precedence over `AUTH_LOCAL_ENABLED`.
     */
    authProviders: v.optional(
      v.object({
        github: v.optional(v.boolean()),
        google: v.optional(v.boolean()),
        microsoft: v.optional(v.boolean()),
        apple: v.optional(v.boolean()),
        oidc: v.optional(v.boolean()),
        local: v.optional(v.boolean()),
      }),
    ),
    /**
     * Maintained row counts for the admin overview, kept in step with the
     * relevant write paths (file finalize/delete, channel create, device
     * upsert/revoke/prune). Optional so a workspace that predates them stays
     * valid; an absent value means "not backfilled yet" and the overview falls
     * back to a bounded scan. Seeded by `maintenance.backfillInstanceCounters`.
     */
    fileCount: v.optional(v.number()),
    fileBytes: v.optional(v.number()),
    channelCount: v.optional(v.number()),
    deviceCount: v.optional(v.number()),
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
   * Operator-saved environment variable overrides from the instance settings
   * UI. Every value is sealed with the server key (`aulora-sse-v1`), secrets
   * and non-secrets alike, so nothing is stored in plaintext. Only allowlisted
   * keys are written; the deployment environment is never returned by any
   * query, so an override cannot be used to read the previous value.
   */
  envOverrides: defineTable({
    key: v.string(),
    valueCiphertext: v.string(),
    updatedAt: v.number(),
    updatedBy: v.string(),
  }).index("by_key", ["key"]),

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
  })
    .index("by_user", ["userId"])
    .index("by_avatar_storage", ["avatarStorageId"])
    // Join order, so the member directory can paginate/search without a full
    // collect. Matches the ascending `joinedAt` order `members.list` sorts by.
    .index("by_joined", ["joinedAt"]),

  /**
   * Reverse index for member↔role membership. `members.roleIds` stays
   * authoritative for reads; this table is maintained alongside it (dual-write)
   * so a role mutation can find just the members holding a role instead of
   * collecting every member. `roleId` stores the same `role.key ?? role._id`
   * reference used in `members.roleIds`. Populated by
   * `maintenance.backfillMemberRoles` for rows that predate it.
   */
  memberRoles: defineTable({
    roleId: v.string(),
    userId: v.string(),
    joinedAt: v.number(),
  })
    .index("by_role", ["roleId"])
    .index("by_user_role", ["userId", "roleId"]),

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
    mentionEveryone: v.optional(v.boolean()),
    mentionHere: v.optional(v.boolean()),
    /** Original explicit/role mentions when legacy broadcast ids share mentionUserIds. */
    broadcastDirectUserIds: v.optional(v.array(v.string())),
    /** Plaintext ids of channels/categories mentioned as `#name`. */
    mentionChannelIds: v.optional(v.array(v.string())),
    /** Plaintext ids of categories mentioned; absent on legacy rows. */
    mentionCategoryIds: v.optional(v.array(v.string())),
    editedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    /** Set while the message is pinned; cleared on unpin. */
    pinnedAt: v.optional(v.number()),
    /**
     * A system event rendered as a quiet timeline line instead of a bubble.
     * Absent on ordinary messages, so existing rows stay valid.
     */
    systemKind: v.optional(v.union(v.literal("pin"))),
    /** Who triggered a system event (the pinner). */
    systemActorId: v.optional(v.string()),
    /** The message a system event refers to (the pinned message). */
    systemTargetId: v.optional(v.id("messages")),
    /** Thread roots only: number of replies, bumped on each reply send. */
    replyCount: v.optional(v.number()),
    /** Thread roots only: creation time of the newest reply. */
    lastReplyAt: v.optional(v.number()),
    /** Thread roots only: recent distinct repliers, newest first, capped. Absent on older threads. */
    replyParticipantIds: v.optional(v.array(v.string())),
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

  /**
   * Per-user thread participation, maintained on reply/mention so the Threads
   * inbox and badge read bounded candidates from a user index instead of
   * scanning recent messages. Plaintext ids/timestamps only.
   */
  threadParticipants: defineTable({
    userId: v.string(),
    threadRootId: v.id("messages"),
    channelId: v.id("channels"),
    lastReplyAt: v.number(),
    mentioned: v.boolean(),
    /** True when the user posted a reply (not merely a mention). Optional on pre-upgrade rows until backfilled. */
    participated: v.optional(v.boolean()),
  })
    .index("by_user", ["userId", "lastReplyAt"])
    .index("by_user_mentioned", ["userId", "mentioned", "lastReplyAt"])
    .index("by_thread_user", ["threadRootId", "userId"]),

  reactions: defineTable({
    messageId: v.id("messages"),
    userId: v.string(),
    /** Server-sealed emoji (`aulora-sse-v1` envelope). */
    emojiCiphertext: v.string(),
  })
    .index("by_message", ["messageId"])
    // Account deletion removes a departing user's own reactions by user.
    .index("by_user", ["userId"]),

  readStates: defineTable({
    userId: v.string(),
    channelId: v.id("channels"),
    lastReadMessageId: v.optional(v.id("messages")),
    mentionCount: v.number(),
  }).index("by_user_channel", ["userId", "channelId"]),

  kanbanBoards: defineTable({
    deleted: v.optional(v.boolean()),
    contentCiphertext: v.string(),
    private: v.boolean(),
    memberIds: v.array(v.string()),
    creatorId: v.string(),
    archived: v.boolean(),
    updatedAt: v.number(),
  }),
  kanbanCards: defineTable({
    boardId: v.id("kanbanBoards"),
    contentCiphertext: v.string(),
    columnId: v.string(),
    position: v.number(),
    labelIds: v.array(v.string()),
    assigneeIds: v.array(v.string()),
    priority: v.union(
      v.literal("none"),
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("urgent"),
    ),
    startAt: v.optional(v.number()),
    dueAt: v.optional(v.number()),
    estimateMinutes: v.optional(v.number()),
    fileIds: v.array(v.id("files")),
    creatorId: v.string(),
    archived: v.boolean(),
    trackedMs: v.number(),
    timerStartedAt: v.optional(v.number()),
    timerUserId: v.optional(v.string()),
    updatedAt: v.number(),
    revision: v.number(),
  })
    .index("by_board", ["boardId"])
    .index("by_timer_user", ["timerUserId"])
    .index("by_running_timer", ["timerStartedAt"]),
  kanbanComments: defineTable({
    cardId: v.id("kanbanCards"),
    authorId: v.string(),
    bodyCiphertext: v.string(),
    updatedAt: v.number(),
  }).index("by_card", ["cardId"]),
  kanbanActivity: defineTable({
    cardId: v.id("kanbanCards"),
    actorId: v.string(),
    bodyCiphertext: v.string(),
    at: v.number(),
  }).index("by_card", ["cardId"]),
  kanbanGithub: defineTable({
    userId: v.string(),
    tokenCiphertext: v.string(),
  }).index("by_user", ["userId"]),

  /**
   * Notes addon. Names/titles/bodies are server-sealed (`aulora-sse-v1`);
   * structural refs, positions and timestamps stay plaintext so the server can
   * page and filter without the key.
   */
  noteFolders: defineTable({
    nameCiphertext: v.string(),
    parentId: v.optional(v.id("noteFolders")),
    position: v.number(),
    creatorId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_parent", ["parentId"]),
  notePages: defineTable({
    folderId: v.optional(v.id("noteFolders")),
    titleCiphertext: v.string(),
    bodyCiphertext: v.string(),
    tagIds: v.array(v.string()),
    creatorId: v.string(),
    lastEditorId: v.string(),
    archived: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    revision: v.number(),
  })
    .index("by_folder", ["folderId"])
    .index("by_updated", ["updatedAt"]),
  noteRevisions: defineTable({
    noteId: v.id("notePages"),
    actorId: v.string(),
    action: v.string(),
    beforeCiphertext: v.optional(v.string()),
    afterCiphertext: v.optional(v.string()),
    at: v.number(),
  }).index("by_note", ["noteId"]),
  noteTags: defineTable({
    nameCiphertext: v.string(),
    color: v.string(),
    creatorId: v.string(),
    createdAt: v.number(),
  }),

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
    /**
     * Storage id of a small, server-sealed thumbnail variant, when the uploader
     * produced one. Optional so records written before the variant existed (and
     * non-image uploads) keep working; readers fall back to the original bytes.
     */
    thumbnailStorageId: v.optional(v.id("_storage")),
    channelId: v.optional(v.id("channels")),
    kanbanBoardId: v.optional(v.id("kanbanBoards")),
  })
    .index("by_uploader", ["uploaderId"])
    .index("by_kanban_board", ["kanbanBoardId"])
    .index("by_channel", ["channelId"])
    .index("by_storage", ["storageId"])
    .index("by_sealed_storage", ["sealedStorageId"])
    .index("by_thumbnail_storage", ["thumbnailStorageId"]),

  devices: defineTable({
    userId: v.string(),
    platform: v.string(),
    pushToken: v.optional(v.string()),
    lastSeen: v.number(),
  })
    .index("by_user", ["userId"])
    // The retention prune reads only installs unseen past the cutoff.
    .index("by_lastSeen", ["lastSeen"]),

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
  })
    .index("by_user", ["userId"])
    // Ordered by heartbeat so the staleness sweep and the long-term prune can
    // read only rows past a cutoff instead of collecting the whole table.
    .index("by_lastHeartbeat", ["lastHeartbeat"])
    // Status-scoped sweep: offline rows stay in the table for the retention
    // window, so sweeping by status avoids re-reading them every 30 seconds.
    .index("by_status_lastHeartbeat", ["status", "lastHeartbeat"]),

  typing: defineTable({
    channelId: v.id("channels"),
    userId: v.string(),
    expiresAt: v.number(),
  })
    .index("by_channel", ["channelId"])
    // One typing row per (channel, user), looked up directly on set/clear.
    .index("by_channel_user", ["channelId", "userId"])
    // The purge cron reads only expired rows instead of scanning the table.
    .index("by_expires", ["expiresAt"]),

  /**
   * An active (or recently ended) voice/video call on a channel. Media never
   * touches the database: this row plus `callSignals` is only the WebRTC
   * signalling and presence layer. Voice channels keep one call at a time;
   * DM/group-DM calls start `ringing` until someone answers.
   */
  calls: defineTable({
    /**
     * The channel the call lives on. Optional: a standalone scheduled-call room
     * has no channel and is identified by `scheduledCallId` instead. Existing
     * rows always carry it, so readers treat an absent value as standalone.
     */
    channelId: v.optional(v.id("channels")),
    /** The scheduled call this row was created for, when it is a room. */
    scheduledCallId: v.optional(v.id("scheduledCalls")),
    kind: callKind,
    initiatorId: v.string(),
    status: callStatus,
    /** Users still being rung; empty once answered or for voice channels. */
    ringingUserIds: v.array(v.string()),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    /** Plaintext id of the participant currently sharing their screen. */
    screenShareUserId: v.optional(v.string()),
    /**
     * When the call became solo (exactly one distinct user), and the server
     * clock time at which a still-solo call is disconnected. Both are cleared
     * when a second participant joins, so a later solo stretch starts fresh.
     * Absent on calls from before the solo timeout, which the sweep arms.
     */
    aloneSince: v.optional(v.number()),
    aloneDeadline: v.optional(v.number()),
    /**
     * The single pending `enforceAlone` job for this window. Re-arming or
     * clearing the window cancels it, so repeated Stay presses cannot pile up
     * jobs and a call always has at most one enforcement in flight.
     */
    aloneJobId: v.optional(v.id("_scheduled_functions")),
    /** Set when the call ended for a reason other than its last person leaving. */
    endedReason: v.optional(callEndedReason),
    /**
     * The one active transcription session, when transcription is running.
     * Writing it on start/stop makes the "only one session per call" rule a
     * single-document guarantee rather than a read-then-insert race.
     */
    transcriptionSessionId: v.optional(v.id("transcriptionSessions")),
    updatedAt: v.number(),
  })
    .index("by_channel", ["channelId"])
    .index("by_status", ["status"])
    .index("by_channel_status", ["channelId", "status"])
    .index("by_scheduled_call", ["scheduledCallId"]),

  /**
   * Who is currently in a call, and their live media flags. `lastSeen` is the
   * heartbeat the sweep uses to drop abandoned participants (a client crash).
   * A user has at most one row: `clientId` is the device that holds it, and
   * `session` bumps when a different device takes over.
   *
   * A guest row also carries `guestId` (its `callGuestSessions` id) and stores
   * that id in `userId` so the existing per-user addressing, seat counting and
   * signalling key keep working unchanged. `guestNameCiphertext` is the sealed
   * display-name snapshot; members never have it.
   */
  callParticipants: defineTable({
    callId: v.id("calls"),
    /** Optional for a standalone scheduled room, which has no channel. */
    channelId: v.optional(v.id("channels")),
    /**
     * Participant key: a member's account id, or a guest session id for a
     * guest. Kept required so older readers and indexes keep working.
     */
    userId: v.string(),
    /** Set only for a guest participant. */
    guestId: v.optional(v.id("callGuestSessions")),
    /**
     * Opaque per-call key a guest uses to address this participant in
     * signalling. Members address each other and guests by their participant
     * key; a guest never receives a member's account id.
     */
    guestKey: v.optional(v.string()),
    /** Sealed guest display name; absent for members. */
    guestNameCiphertext: v.optional(v.string()),
    /** Install id of the device in the call. Absent on rows from before device seats. */
    clientId: v.optional(v.string()),
    /** Increments when another device takes this seat, so peers renegotiate. */
    session: v.optional(v.number()),
    muted: v.boolean(),
    deafened: v.boolean(),
    video: v.boolean(),
    sharingScreen: v.boolean(),
    /** The device can send and receive screen shares through the streaming server. */
    sfu: v.optional(v.boolean()),
    /**
     * The device can carry microphone and camera through the streaming server
     * (`sfu-call` capability). Absent on older clients and mobile, which keeps a
     * mixed call entirely on the peer mesh.
     */
    sfuCall: v.optional(v.boolean()),
    joinedAt: v.number(),
    lastSeen: v.number(),
  })
    .index("by_call", ["callId"])
    .index("by_call_user", ["callId", "userId"])
    .index("by_call_guest", ["callId", "guestId"])
    .index("by_guest", ["guestId"])
    .index("by_user", ["userId"])
    .index("by_channel", ["channelId"])
    // The sweep drops abandoned seats past a heartbeat cutoff without scanning.
    .index("by_lastSeen", ["lastSeen"]),

  /**
   * Short-lived WebRTC signalling envelopes (SDP offers/answers and ICE
   * candidates) addressed to one participant. Rows are deleted once the
   * recipient has processed them; the sweep clears orphans from dropped peers.
   */
  callSignals: defineTable({
    callId: v.id("calls"),
    channelId: v.optional(v.id("channels")),
    /** Sender/recipient participant keys: a member id or a guest session id. */
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
    .index("by_call_to", ["callId", "toUserId"])
    // The sweep expires orphaned envelopes by age instead of scanning.
    .index("by_created", ["createdAt"]),

  /** Page leases and per-message/user receipts, created asynchronously except the initial page. */
  notificationDeliveryClaims: defineTable({
    messageId: v.id("messages"),
    cursor: v.string(),
    leaseUntil: v.optional(v.number()),
    attempts: v.optional(v.number()),
    retryAt: v.optional(v.number()),
    leaseToken: v.optional(v.string()),
    completed: v.optional(v.boolean()),
    /** Original page to re-drive for a recipient receipt. */
    recoveryCursor: v.optional(v.string()),
  })
    .index("by_message_cursor", ["messageId", "cursor"])
    .index("by_lease", ["completed", "retryAt"]),

  broadcastMentionJobs: defineTable({
    messageId: v.id("messages"),
    cursor: v.string(),
    userIds: v.array(v.string()),
  }),

  notificationPrefs: defineTable({
    userId: v.string(),
    scope: notificationScope,
    channelId: v.optional(v.id("channels")),
    level: notificationLevel,
    suppressMassMentions: v.optional(v.boolean()),
    muteUntil: v.optional(v.number()),
    /** Hidden from the sidebar for this viewer (per-channel only). */
    hidden: v.optional(v.boolean()),
    /** Pinned to the top of this viewer's direct messages (per-channel only). */
    pinned: v.optional(v.boolean()),
    /** When the viewer pinned it; orders the pinned block, oldest pin first. */
    pinnedAt: v.optional(v.number()),
  })
    .index("by_user_scope", ["userId", "scope"])
    .index("by_user_channel", ["userId", "channelId"]),

  /**
   * Invites. `code` stores the SHA-256 hex digest of the normalised plaintext
   * code, never the code itself; the plaintext is returned only once, at
   * creation. `maxUses` of 0 means unlimited and an absent `expiresAt` means the
   * invite never expires. `kind` is how it reaches the person: a shareable
   * `link`, an `email` sent to one address, or a short typed `code`. A
   * `restrictedEmail` limits redemption to the account with that address.
   * Rows written before these fields existed read as unrestricted links.
   */
  invites: defineTable({
    code: v.string(),
    createdBy: v.string(),
    maxUses: v.number(),
    uses: v.number(),
    expiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    kind: v.optional(v.union(v.literal("link"), v.literal("email"), v.literal("code"))),
    restrictedEmail: v.optional(v.string()),
    note: v.optional(v.string()),
    /** Last characters of the plaintext, so an admin can tell links apart. */
    codeHint: v.optional(v.string()),
    emailStatus: v.optional(v.union(v.literal("queued"), v.literal("sent"), v.literal("failed"))),
  })
    .index("by_code", ["code"])
    .index("by_creator", ["createdBy"]),

  /** Who joined through which invite; the history shown beside each invite. */
  inviteRedemptions: defineTable({
    inviteId: v.id("invites"),
    userId: v.string(),
    at: v.number(),
  }).index("by_invite", ["inviteId"]),

  /**
   * Pre-approved addresses. An entry is either `person@example.com` or
   * `@example.com` (a whole domain), always lowercase. A signed-in account whose
   * verified email matches may join an invite-only workspace without a link.
   */
  inviteAllowlist: defineTable({
    pattern: v.string(),
    kind: v.union(v.literal("email"), v.literal("domain")),
    addedBy: v.string(),
    note: v.optional(v.string()),
    addedAt: v.number(),
  }).index("by_pattern", ["pattern"]),

  /**
   * One-time email codes that prove an account owns an allowlisted address.
   * Only the digest is stored; a row is deleted on success and lapses after
   * `expiresAt`.
   */
  joinCodes: defineTable({
    userId: v.string(),
    email: v.string(),
    codeHash: v.string(),
    expiresAt: v.number(),
    attempts: v.number(),
  }).index("by_user", ["userId"]),

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
  })
    .index("by_key", ["key"])
    // The TTL prune reads only counters whose window is long past.
    .index("by_window_start", ["windowStart"]),

  /**
   * Guest invite links. Only the SHA-256 hex digest of the 256-bit URL-safe
   * token is stored; the plaintext is shown once at creation. A link targets a
   * channel call or a scheduled call. Invalid, expired, revoked and exhausted
   * links all return the same generic error so a link cannot be probed.
   */
  callGuestLinks: defineTable({
    tokenHash: v.string(),
    /** Channel call target; absent for a scheduled-call link. */
    channelId: v.optional(v.id("channels")),
    /** Scheduled call target; absent for a channel link. */
    scheduledCallId: v.optional(v.id("scheduledCalls")),
    createdBy: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    maxUses: v.number(),
    uses: v.number(),
    revokedAt: v.optional(v.number()),
    /** Operator-facing note, never shown to a guest. */
    label: v.optional(v.string()),
    /**
     * SHA-256 digests of guest client ids an admitting member removed. A
     * removed guest cannot ask to join through the same link again even though
     * their session token is already dead.
     */
    blockedClientHashes: v.optional(v.array(v.string())),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_channel", ["channelId"])
    .index("by_scheduled_call", ["scheduledCallId"])
    .index("by_creator", ["createdBy"])
    .index("by_expires", ["expiresAt"])
    // Active-link caps count only unrevoked, unexpired rows instead of
    // reading a fixed prefix that old inactive links can fill.
    .index("by_channel_active", ["channelId", "revokedAt", "expiresAt"])
    .index("by_scheduled_active", ["scheduledCallId", "revokedAt", "expiresAt"])
    // Newest-first reads for the link list and the lobby-manager lookup.
    .index("by_creator_created", ["createdBy", "createdAt"])
    .index("by_channel_created", ["channelId", "createdAt"])
    .index("by_scheduled_created", ["scheduledCallId", "createdAt"]),

  /**
   * A guest's lobby request and, once admitted, their call session. The
   * plaintext session token is returned exactly once at `requestJoin`; only its
   * SHA-256 digest is stored. Guests never get a Convex identity, a member row
   * or a workspace membership.
   */
  callGuestSessions: defineTable({
    linkId: v.id("callGuestLinks"),
    tokenHash: v.string(),
    /** Sealed guest-supplied display name. */
    displayNameCiphertext: v.string(),
    /** Sealed optional affiliation. */
    affiliationCiphertext: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("admitted"),
      v.literal("denied"),
      v.literal("removed"),
      v.literal("left"),
      v.literal("expired"),
    ),
    requestedAt: v.number(),
    admittedAt: v.optional(v.number()),
    admittedBy: v.optional(v.string()),
    deniedAt: v.optional(v.number()),
    removedAt: v.optional(v.number()),
    /** The live call this guest was admitted to. */
    callId: v.optional(v.id("calls")),
    /** Install id the guest's browser sends for heartbeat/signalling. */
    clientId: v.optional(v.string()),
    lastSeen: v.optional(v.number()),
    expiresAt: v.number(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_link_status", ["linkId", "status"])
    .index("by_call_status", ["callId", "status"])
    .index("by_call", ["callId"])
    .index("by_expires", ["expiresAt"]),

  /**
   * One transcription of one call. Text-bearing fields are server-sealed; the
   * structural refs and timestamps stay plaintext so the retention cron and the
   * summary action can page without the key.
   */
  transcriptionSessions: defineTable({
    callId: v.id("calls"),
    /** Optional because a standalone scheduled room has no channel. */
    channelId: v.optional(v.id("channels")),
    startedBy: v.string(),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    status: v.union(
      v.literal("active"),
      v.literal("ending"),
      v.literal("ended"),
      v.literal("failed"),
    ),
    /**
     * Finalization deadline for an `ending` session. Ingest still accepts a
     * bounded final window until this time; the scheduled finalizer then moves
     * the session to `ended` and queues its summary.
     */
    endsAt: v.optional(v.number()),
    summaryStatus: v.union(
      v.literal("none"),
      v.literal("pending"),
      v.literal("ready"),
      v.literal("error"),
    ),
    summaryCiphertext: v.optional(v.string()),
    summaryModel: v.optional(v.string()),
    summaryAt: v.optional(v.number()),
    summaryError: v.optional(v.string()),
    /**
     * When the current `pending` summary was queued. The recovery cron only
     * re-queues pending rows older than ten minutes, so a live action is not
     * duplicated every five minutes.
     */
    summaryRequestedAt: v.optional(v.number()),
    /**
     * Identifies the current summary attempt. Completion, abort and the error
     * transition no-op when a newer attempt has replaced this one.
     */
    summaryAttemptId: v.optional(v.string()),
    retentionExpiresAt: v.optional(v.number()),
    /**
     * Maintained aggregate segment count and the last time it was refreshed.
     * Ingest updates per-speaker state on every batch and refreshes this
     * shared session row only periodically, so concurrent speakers do not
     * contend on one hot document.
     */
    segmentCount: v.number(),
    /** @deprecated Per-speaker replay state moved to `transcriptSpeakerState`. */
    lastSeq: v.number(),
    countUpdatedAt: v.optional(v.number()),
  })
    .index("by_call", ["callId"])
    .index("by_call_status", ["callId", "status"])
    .index("by_status", ["status"])
    .index("by_summary_status", ["summaryStatus"])
    .index("by_status_summary", ["status", "summaryStatus"])
    .index("by_started", ["startedAt"])
    .index("by_retention", ["retentionExpiresAt"]),

  /**
   * Per-speaker ingest state for one transcription session. Replay protection
   * is scoped to the speaker, so two speakers (or a reconnect) may both start
   * at sequence 1 without conflicting on the shared session document.
   */
  transcriptSpeakerState: defineTable({
    sessionId: v.id("transcriptionSessions"),
    speakerKey: v.string(),
    lastSeq: v.number(),
    lastStartMs: v.number(),
    segmentCount: v.number(),
    updatedAt: v.number(),
    /** When this speaker left a still-running call; opens a short drain grace. */
    leftAt: v.optional(v.number()),
    /** A moderator removed this speaker; no departure grace applies. */
    blocked: v.optional(v.boolean()),
  }).index("by_session_speaker", ["sessionId", "speakerKey"]),

  /**
   * One speaker-labelled transcript segment. Display order is the session-
   * relative `startMs`, with Convex's implicit `_creationTime` breaking ties.
   */
  transcriptSegments: defineTable({
    sessionId: v.id("transcriptionSessions"),
    seq: v.number(),
    /** `user:<id>` or `guest:<id>`; never a client-supplied identity. */
    speakerKey: v.string(),
    /** Sealed display-name snapshot at the time the segment was spoken. */
    speakerNameCiphertext: v.string(),
    /** Sealed transcript text. */
    textCiphertext: v.string(),
    startMs: v.number(),
    endMs: v.number(),
    confidence: v.optional(v.number()),
    language: v.optional(v.string()),
  })
    .index("by_session_seq", ["sessionId", "seq"])
    // Transcript order: playback time first, then `_creationTime` tie-break.
    .index("by_session_start", ["sessionId", "startMs"]),

  /**
   * Liveness for the optional transcriber container, written by its periodic
   * hello. A single row keyed `service`; kept separate from the config so a
   * heartbeat never contends with an owner editing settings.
   */
  transcriberStatus: defineTable({
    key: v.string(),
    serviceSeenAt: v.number(),
    /** Runtime engine readiness reported by the latest hello, not the owner's selection. */
    runtimeReady: v.optional(v.boolean()),
    runtimeModelId: v.optional(v.string()),
  }).index("by_key", ["key"]),

  /**
   * Single-document transcription configuration. `apiKeyCiphertext` is sealed
   * and never returned by any query or action.
   */
  transcriptionConfig: defineTable({
    modelId: v.string(),
    modelStatus: v.union(
      v.literal("not_installed"),
      v.literal("downloading"),
      v.literal("ready"),
      v.literal("error"),
    ),
    modelProgress: v.optional(v.number()),
    modelError: v.optional(v.string()),
    modelUpdatedAt: v.optional(v.number()),
    provider: v.union(v.literal("openrouter"), v.literal("openai_compatible")),
    baseUrl: v.string(),
    apiKeyCiphertext: v.optional(v.string()),
    model: v.string(),
    summaryLanguage: v.optional(v.string()),
    summaryStyle: v.optional(v.string()),
    retentionDays: v.number(),
    /** Explicit opt-in for SSRF-sensitive private/loopback summary endpoints. */
    allowPrivateEndpoint: v.boolean(),
    updatedAt: v.number(),
    updatedBy: v.string(),
  }),

  /**
   * A scheduled call: channel-bound or a standalone room with invitees. Title
   * and description are sealed; times are UTC epoch milliseconds and the viewer
   * renders them in their own zone.
   */
  scheduledCalls: defineTable({
    titleCiphertext: v.string(),
    descriptionCiphertext: v.optional(v.string()),
    startsAt: v.number(),
    durationMinutes: v.optional(v.number()),
    openLeadMinutes: v.number(),
    /** Channel-bound target; absent for a standalone room. */
    channelId: v.optional(v.id("channels")),
    /** Standalone-room invitees. Empty for a channel call. */
    inviteeUserIds: v.array(v.string()),
    inviteeRoleIds: v.array(v.string()),
    createdBy: v.string(),
    status: v.union(
      v.literal("scheduled"),
      v.literal("open"),
      v.literal("ended"),
      v.literal("cancelled"),
    ),
    /** The live `calls` row once someone joins the window. */
    callId: v.optional(v.id("calls")),
    createdAt: v.number(),
    updatedAt: v.number(),
    cancelledAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    /** Single pending open-time job; re-arming replaces it. */
    openJobId: v.optional(v.id("_scheduled_functions")),
  })
    .index("by_starts", ["startsAt"])
    .index("by_status_starts", ["status", "startsAt"])
    .index("by_creator", ["createdBy"])
    .index("by_channel", ["channelId"])
    .index("by_call", ["callId"]),

  ...botTables,
  ...webhookTables,
});
