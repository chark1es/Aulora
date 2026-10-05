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

/**
 * Whether `text` contains `prefix + name` as a whole tag, case-insensitively.
 * A tag ends at the end of the text or before any word character, `.` or `-`,
 * matching the former `(?![\w.-])` boundary without compiling a regex per name.
 */
function hasTag(text: string, name: string, prefix: "@" | "#"): boolean {
  if (name.length === 0) {
    return false;
  }
  const haystack = text.toLowerCase();
  const needle = `${prefix}${name}`.toLowerCase();
  let from = haystack.indexOf(needle);
  while (from !== -1) {
    const after = haystack.charAt(from + needle.length);
    if (after === "" || !/[\w.-]/.test(after)) {
      return true;
    }
    from = haystack.indexOf(needle, from + 1);
  }
  return false;
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

  if (/(^|\s)@here(?![A-Za-z0-9_.-])/i.test(text)) {
    here = true;
  }
  if (/(^|\s)@everyone(?![A-Za-z0-9_.-])/i.test(text)) {
    everyone = true;
  }

  const directMembers = [...members].sort((a, b) => b.displayName.length - a.displayName.length);
  const mentionableRoles = roles.filter((role) => role.mentionable);

  for (const token of text.matchAll(MENTION_TOKEN)) {
    const raw = token.at(1) ?? "";
    if (raw.toLowerCase() === "here") {
      here = true;
      continue;
    }
    if (raw.toLowerCase() === "everyone") {
      everyone = true;
      continue;
    }
    for (const member of directMembers) {
      if (hasTag(text, member.displayName, "@")) {
        userIds.add(member.userId);
        break;
      }
    }
    for (const role of mentionableRoles) {
      if (hasTag(text, role.name, "@")) {
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

/** A channel that `#name` may refer to. */
export interface ChannelMentionTarget {
  readonly channelId: string;
  /** Channel display name, without the leading `#`. */
  readonly name: string;
}

/** A category that `#name` may refer to. */
export interface CategoryMentionTarget {
  readonly categoryId: string;
  readonly name: string;
}

export interface ChannelMentionResolution {
  /** De-duplicated channel ids mentioned as `#name`. */
  readonly channelIds: readonly string[];
  /** De-duplicated category ids mentioned as `#name`. */
  readonly categoryIds: readonly string[];
}

const CHANNEL_TOKEN = /#([A-Za-z0-9_.-]+)/g;

/**
 * Resolves `#channel` and `#category` mentions against the workspace's known
 * channels and categories. Longest name wins so `#general` does not shadow
 * `#general-announcements`.
 */
export function resolveChannelMentions(
  text: string,
  channels: readonly ChannelMentionTarget[],
  categories: readonly CategoryMentionTarget[] = [],
): ChannelMentionResolution {
  const channelIds = new Set<string>();
  const categoryIds = new Set<string>();

  if (text.match(CHANNEL_TOKEN) === null) {
    return { channelIds: [], categoryIds: [] };
  }

  const channel = [...channels]
    .sort((a, b) => b.name.length - a.name.length)
    .find((candidate) => hasTag(text, candidate.name, "#"));
  if (channel !== undefined) {
    channelIds.add(channel.channelId);
  } else {
    const category = [...categories]
      .sort((a, b) => b.name.length - a.name.length)
      .find((candidate) => hasTag(text, candidate.name, "#"));
    if (category !== undefined) {
      categoryIds.add(category.categoryId);
    }
  }

  return {
    channelIds: [...channelIds].sort(),
    categoryIds: [...categoryIds].sort(),
  };
}
