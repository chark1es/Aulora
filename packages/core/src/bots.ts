import { ALL_PERMISSIONS, Permission } from "./permissions";

/** Languages a hosted bot can be written in. */
export const BOT_LANGUAGES = ["typescript", "python"] as const;
export type BotLanguage = (typeof BOT_LANGUAGES)[number];

/** Entry file a hosted bot starts from, by language. */
export const BOT_ENTRY_FILES: Readonly<Record<BotLanguage, string>> = {
  typescript: "main.ts",
  python: "main.py",
};

/** Prefix of a bot's user id (`bot_<botDocId>`), which is also its JWT subject. */
export const BOT_USER_ID_PREFIX = "bot_";

export function isBotUserId(userId: string): boolean {
  return userId.startsWith(BOT_USER_ID_PREFIX);
}

/**
 * Permissions that can never be granted to a bot. Anything that edits roles,
 * the workspace, invites, bots themselves or the audit log would let a bot (or
 * whoever controls its code) escalate beyond what the workspace owner reviewed.
 */
export const BOT_BLOCKED_PERMISSIONS: bigint =
  Permission.Administrator |
  Permission.ManageRoles |
  Permission.ManageWorkspace |
  Permission.ManageBots |
  Permission.ManageWebhooks |
  Permission.CreateInvites |
  Permission.DeleteInvites |
  Permission.ViewAuditLog;

/** Every permission an admin may grant a bot. A new bot starts with none. */
export const BOT_GRANTABLE_PERMISSIONS: bigint = ALL_PERMISSIONS & ~BOT_BLOCKED_PERMISSIONS;

/** True when `grants` only contains bits an admin may give a bot. */
export function isValidBotGrant(grants: bigint): boolean {
  return grants >= 0n && (grants & ~BOT_GRANTABLE_PERMISSIONS) === 0n;
}

/** Hosted-bot source and config limits, enforced server-side. */
export const BOT_LIMITS = {
  maxBots: 25,
  maxFiles: 50,
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 1024 * 1024,
  maxEnvVars: 32,
  maxEnvValueBytes: 4096,
  maxNameLength: 32,
  maxDescriptionLength: 200,
  maxLogLines: 500,
  maxLogLineBytes: 4096,
} as const;

/** Claims of the short-lived JWT a bot exchanges its API token for. */
export const BOT_JWT_ISSUER = "https://bots.aulora.invalid";
export const BOT_JWT_AUDIENCE = "aulora-bots";
export const BOT_JWT_ALGORITHM = "ES256";
export const BOT_JWT_TTL_SECONDS = 3600;

/** API tokens are `abt_` followed by 43 base64url characters (256 random bits). */
export const BOT_TOKEN_PREFIX = "abt_";
