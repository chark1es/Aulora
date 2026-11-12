export { AttachmentSizeError, attachmentUploadErrorMessage } from "./attachment-errors";
export {
  downloadAttachment,
  downloadThumbnail,
  parseAttachmentDescriptor,
  type UploadAttachmentInput,
  uploadAttachment,
} from "./attachments";
export * from "./auth-events";
export {
  CONVEX_AUTH_CLIENT_OPTIONS,
  type ConvexTokenResponse,
  createProviderTokenFetcher,
  isTokenRejection,
  type ProviderTokenFetcher,
  type ProviderTokenFetcherOptions,
  tokenExpiryMs,
} from "./auth-token";
export {
  base64ToBytes,
  base64UrlToBytes,
  bytesToBase64,
  bytesToBase64Url,
  concatBytes,
  timingSafeEqual,
  utf8Decode,
  utf8Encode,
} from "./binary";
export { blurhashDecode, blurhashEncode } from "./blurhash";
export * from "./bots";
export * from "./call-addons-access";
export { summaryMentionIncreased } from "./chat/broadcast-feedback.js";
export * from "./chat/index";
export { orderMentionSuggestions } from "./chat/mention-suggestions.js";
export { sendThreadReply } from "./chat/thread-send.js";
export {
  type ClientVersionPolicy,
  type ClientVersionState,
  clientVersionState,
  compareClientVersions,
} from "./client-version";
export * from "./conversation-opening";
export {
  createDebugLog,
  DEBUG_LOG_MAX_BYTES,
  DEBUG_LOG_MAX_ENTRIES,
  type DebugLogEntry,
  debugLog,
  installDebugConsole,
  recordDebugFailure,
  redactDebugText,
} from "./debug-log";
export {
  classifyError,
  DEFAULT_ERROR_MESSAGE,
  type ErrorDisposition,
  isAuthenticationError,
  messageSendError,
  userFacingError,
} from "./errors/index";
export {
  DEFAULT_FEATURE_FLAGS,
  FEATURE_FLAG_NAMES,
  type FeatureFlagName,
  type FeatureFlags,
  resolveFeatureFlags,
} from "./feature-flags";
export * from "./format-bytes";
export * from "./guest-calls";
export {
  allowlistAdmits,
  CUSTOM_INVITE_CODE_MAX_LENGTH,
  CUSTOM_INVITE_CODE_MIN_LENGTH,
  type CustomInviteCodeProblem,
  type CustomInviteCodeResult,
  formatAccessCode,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  INVITE_KINDS,
  type InviteKind,
  isAccessCodeShape,
  isInviteInputReady,
  isValidEmail,
  joinCodeFailureMessage,
  maskEmail,
  normalizeEmail,
  normalizeInviteCode,
  parseAllowlistEntry,
  type RedeemOutcome,
  redeemOutcomeMessage,
  validateCustomInviteCode,
} from "./invites";
export * from "./kanban.js";
export * from "./last-defined";
export {
  groupMembersByHoistedRole,
  type MembersGroupingMember,
  type MembersGroupingResult,
  type MembersGroupingRole,
  type MembersGroupingRoleSection,
} from "./members-grouping";
export { MESSAGE_MAX_ATTACHMENTS, MESSAGE_MAX_LENGTH } from "./message-limits";
export { NATIVE_AUTH_EXPIRED_ERROR, NATIVE_AUTH_TX_TTL_MS } from "./native-auth";
export * from "./notes/index.js";
export {
  type EnqueueInput,
  type FlushOptions,
  type FlushResult,
  isConnectivityError,
  memoryOutboxStore,
  Outbox,
  type OutboxFailure,
  type OutboxItem,
  type OutboxOptions,
  type OutboxStatus,
  type OutboxStore,
} from "./outbox/index";
export {
  ADMINISTRATOR,
  ALL_PERMISSIONS,
  canGrantPermissions,
  canManageRole,
  canModerate,
  canModerateMember,
  EVERYONE_ROLE_ID,
  hasPermission,
  highestRolePosition,
  type ModerateMemberInput,
  type ModeratorLike,
  type Overwrite,
  PERMISSION_NAMES,
  Permission,
  type PermissionActor,
  type PermissionName,
  type Permissions,
  permissionNames,
  permissionsFromNames,
  type ResolvePermissionsInput,
  type Role,
  resolvePermissions,
} from "./permissions";
export * from "./presence-label";
export * from "./presence-scope";
export {
  activateProfileInStore,
  activeProfileOf,
  addProfileToStore,
  createMemoryProfileStore,
  createServerProfile,
  type ProfileSnapshot,
  type ProfileStore,
  profileId,
  readProfileSnapshot,
  readProfileSnapshotSafely,
  removeProfileFromStore,
  type ServerProfile,
  type StorageLike,
  UnknownProfileError,
  type WebLocalStorageStoreOptions,
  webLocalStorageStore,
} from "./profiles";
export * from "./provider-auth";
export * from "./relative-time";
export * from "./role-color";
export * from "./roles";
export * from "./scheduled-calls";
export * from "./scheduled-calls-view";
export {
  ArchiveBackfill,
  type ArchiveSource,
  memorySearchStore,
  type SearchDocument,
  type SearchHit,
  SearchIndex,
  type SearchOptions,
  type SearchStore,
  searchDocumentFor,
  searchScopeKey,
  tokenize,
} from "./search/index";
export {
  isLocalHostname,
  normalizeServerUrl,
  ServerUrlError,
  tryNormalizeServerUrl,
  wellKnownUrl,
} from "./server-url";
export {
  assessOwnerPassword,
  OWNER_PASSWORD_MIN_LENGTH,
  OWNER_PASSWORD_PASSPHRASE_LENGTH,
  type OwnerPasswordAssessment,
} from "./setup";
export { resolveSignInMethods, type SignInMethods } from "./sign-in";
export {
  DEFAULT_SOUND_SETTINGS,
  loadSoundSettings,
  memorySoundSettingsStore,
  mergeSoundSettings,
  SOUND_EVENTS,
  SOUND_SETTINGS_KEY,
  type SoundEvent,
  type SoundSettings,
  saveSoundSettings,
  soundVolume,
} from "./sounds";
export * from "./stuck-timeout";
export * from "./transcript-view";
export * from "./transcription";
export {
  advanceCursor,
  countMentions,
  countUnread,
  EMPTY_CURSOR,
  emptyCursor,
  firstUnreadMessage,
  hasUnread,
  isMessageRead,
  type MessageMeta,
  type ReadCursor,
  summarizeUnread,
  type UnreadSummary,
} from "./unread";
export {
  autoUpdateEnabled,
  compareSemver,
  DEFAULT_UPDATE_GITHUB_REPO,
  DEFAULT_UPDATE_MANIFEST_URL,
  isReleaseTag,
  loadPublishedRelease,
  type PublishedRelease,
  parseSemver,
  planWorkspaceUpdate,
  readDeclaredVersion,
  releaseTag,
  resolveGitHubRepo,
  resolveManifestUrl,
  type Semver,
  type UpdateChannel,
  updateChannel,
  type WorkspaceApply,
  type WorkspaceUpdatePlan,
} from "./updates";
export * from "./voice/index";
export * from "./watch-local-query";
export * from "./webhooks";
export {
  containsSecretField,
  type FetchWellKnownOptions,
  fetchWellKnown,
  isWellKnown,
  parseWellKnown,
  WELL_KNOWN_PATH,
  type WellKnown,
  type WellKnownAuth,
  type WellKnownEncryption,
  WellKnownError,
  type WellKnownErrorCode,
  type WellKnownLocalAuth,
  type WellKnownOAuthProvider,
  type WellKnownOidcProvider,
  type WellKnownProvider,
} from "./well-known";
