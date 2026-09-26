/**
 * Mention detection.
 *
 * Runs entirely on the client: the decrypted text is scanned for `@user`,
 * `@role`, `@here` and `@everyone`, and the result is a plaintext list of user
 * ids. The server only ever receives those ids (by design, so it can count
 * mentions and route push); the mention text itself stays encrypted.
 */

export interface MentionTarget {
  readonly userId: string;
  /** Display name, without the leading `@`. */
  readonly displayName: string;
  /** Role ids the user holds, used for `@role` mentions. */
  readonly roleIds?: readonly string[];
}

export interface RoleMentionTarget {
  readonly roleId: string;
  readonly name: string;
  readonly mentionable: boolean;
  readonly memberUserIds: readonly string[];
}

export interface MentionResolution {
  /** De-duplicated user ids to store as plaintext `mentionUserIds`. */
  readonly userIds: readonly string[];
  readonly here: boolean;
  readonly everyone: boolean;
}

const MENTION_TOKEN = /@([A-Za-z0-9_.-]+)/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolves mentions in `text` against the channel's members and roles.
 * Longest display name wins so `@alice` does not shadow `@alice.smith`.
 */
export function resolveMentions(
  text: string,
  members: readonly MentionTarget[],
  roles: readonly RoleMentionTarget[] = [],
): MentionResolution {
  const userIds = new Set<string>();
  let here = false;
  let everyone = false;

  const directMembers = [...members].sort((a, b) => b.displayName.length - a.displayName.length);
  const directPatterns = directMembers.map((member) => ({
    member,
    pattern: new RegExp(`@${escapeRegExp(member.displayName)}(?![\\w.-])`, "i"),
  }));
  const rolePatterns = roles
    .filter((role) => role.mentionable)
    .map((role) => ({
      role,
      pattern: new RegExp(`@${escapeRegExp(role.name)}(?![\\w.-])`, "i"),
    }));

  if (/(^|\s)@here(?![A-Za-z0-9_.-])/i.test(text)) {
    here = true;
  }
  if (/(^|\s)@everyone(?![A-Za-z0-9_.-])/i.test(text)) {
    everyone = true;
  }

  for (const token of text.matchAll(MENTION_TOKEN)) {
    const raw = token[1] ?? "";
    if (raw.toLowerCase() === "here") {
      here = true;
      continue;
    }
    if (raw.toLowerCase() === "everyone") {
      everyone = true;
      continue;
    }
    for (const { member, pattern } of directPatterns) {
      if (pattern.test(text)) {
        userIds.add(member.userId);
        break;
      }
    }
    for (const { role, pattern } of rolePatterns) {
      if (pattern.test(text)) {
        for (const userId of role.memberUserIds) {
          userIds.add(userId);
        }
        break;
      }
    }
  }

  return {
    userIds: [...userIds].sort(),
    here,
    everyone,
  };
}

/** `@here`/`@everyone` expands to every channel member. */
export function expandBroadcast(
  resolution: MentionResolution,
  memberIds: readonly string[],
): string[] {
  const ids = new Set(resolution.userIds);
  if (resolution.here || resolution.everyone) {
    for (const id of memberIds) {
      ids.add(id);
    }
  }
  return [...ids].sort();
}
