import { EVERYONE_ROLE_ID, hasPermission, Permission } from "../permissions.js";

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

/** True for direct or broadcast mentions; authors never ping themselves. */
export function messageMentionsUser(
  message: {
    readonly authorId?: string;
    readonly mentionUserIds?: readonly string[];
    readonly mentionEveryone?: boolean;
    readonly mentionHere?: boolean;
  },
  userId: string,
): boolean {
  return (
    message.authorId !== userId &&
    (message.mentionUserIds?.includes(userId) === true ||
      message.mentionEveryone === true ||
      message.mentionHere === true)
  );
}

export interface ServerCapabilities {
  readonly mentionMarkers: boolean;
}

/** Public config is untrusted and older servers omit capabilities entirely. */
export function resolveServerCapabilities(value: unknown): ServerCapabilities {
  if (typeof value !== "object" || value === null || !("capabilities" in value))
    return { mentionMarkers: false };
  const capabilities = value.capabilities;
  return {
    mentionMarkers:
      typeof capabilities === "object" &&
      capabilities !== null &&
      "mentionMarkers" in capabilities &&
      capabilities.mentionMarkers === true,
  };
}

export function buildSendMentions(input: {
  readonly resolution: MentionResolution;
  readonly canMentionEveryone: boolean;
  readonly memberIds: readonly string[];
  readonly capabilities: ServerCapabilities;
  readonly channels?: ChannelMentionResolution;
}) {
  const { resolution, canMentionEveryone, memberIds, capabilities } = input;
  const gated = {
    ...resolution,
    here: canMentionEveryone && resolution.here,
    everyone: canMentionEveryone && resolution.everyone,
  };
  return {
    mentionUserIds: capabilities.mentionMarkers
      ? resolution.explicitUserIds
      : expandBroadcast(gated, memberIds),
    mentionRoleIds: resolution.roleIds,
    mentionChannelIds: input.channels?.channelIds ?? [],
    mentionCategoryIds: input.channels?.categoryIds ?? [],
    ...(capabilities.mentionMarkers
      ? { mentionEveryone: gated.everyone, mentionHere: gated.here }
      : {}),
  };
}

export interface MentionResolution {
  /** Direct user mentions, without role expansion. */
  readonly explicitUserIds: readonly string[];
  /** De-duplicated user ids to store as plaintext `mentionUserIds`. */
  readonly userIds: readonly string[];
  /**
   * De-duplicated role ids mentioned as `@role`. Servers that support it expand
   * these to member ids themselves, so a client without the full roster can
   * still route role mentions.
   */
  readonly roleIds: readonly string[];
  readonly here: boolean;
  readonly everyone: boolean;
}

/** A bare URL, ending at whitespace, an angle bracket, a quote or a backtick (\x60). */
const URL_PATTERN = /(?<![^\s([{])https?:\/\/[^\s<>"'\x60]+/gi;
const FENCE_MARKER = /^ {0,3}(\x60{3,}|~{3,})(.*)$/;

interface Fence {
  readonly char: string;
  readonly length: number;
  /** Text after the marker; a closing fence has none. */
  readonly rest: string;
}

function fenceMarker(line: string): Fence | undefined {
  const match = FENCE_MARKER.exec(line);
  if (match === null) return undefined;
  const [, run = "", rest = ""] = match;
  return { char: run.charAt(0), length: run.length, rest };
}

/** Blank quoted lines and fenced code, keeping every line and character position. */
function maskQuotesAndFences(body: string): string {
  let fence: Fence | undefined;
  return body
    .split(/(\r?\n)/)
    .map((line) => {
      if (/^\r?\n$/.test(line)) return line;
      // Quoted lines cannot open or close a fence in the surrounding prose.
      if (/^\s*>/.test(line)) return line.replace(/[^\r\n]/g, " ");
      const marker = fenceMarker(line);
      if (fence !== undefined) {
        if (
          marker !== undefined &&
          marker.char === fence.char &&
          marker.length >= fence.length &&
          marker.rest.trim() === ""
        )
          fence = undefined;
        return line.replace(/[^\r\n]/g, " ");
      }
      if (marker !== undefined) {
        fence = marker;
        return line.replace(/[^\r\n]/g, " ");
      }
      return line;
    })
    .join("");
}

/** Blank inline code spans. Only equal-length backtick runs delimit a span; unmatched runs are prose. */
function maskInlineCode(prose: string): string {
  const runs = [...prose.matchAll(/\x60+/g)];
  let result = "";
  let start = 0;
  // Runs before this index already belong to a masked span.
  let spanEnd = 0;
  for (const [i, opener] of runs.entries()) {
    if (i < spanEnd) continue;
    const end = runs.findIndex((run, j) => j > i && run[0].length === opener[0].length);
    if (end === -1) continue;
    const closer = runs.at(end);
    if (closer === undefined) continue;
    result +=
      prose.slice(start, opener.index) + " ".repeat(closer.index + closer[0].length - opener.index);
    start = closer.index + closer[0].length;
    spanEnd = end + 1;
  }
  return result + prose.slice(start);
}

/** Mask quoted/code text while preserving positions for token consumers. */
export function broadcastMentionText(body: string): string {
  return maskInlineCode(maskQuotesAndFences(body)).replace(URL_PATTERN, (url) => " ".repeat(url.length));
}

const BROADCAST_TOKEN = /(?<![\w@.-])@(everyone|here)(?![\w.-])/gi;

export function hasBroadcastToken(text: string, name?: "everyone" | "here"): boolean {
  for (const match of broadcastMentionText(text).matchAll(BROADCAST_TOKEN)) {
    const [, token = ""] = match;
    if (name === undefined || token.toLowerCase() === name) return true;
  }
  return false;
}

/**
 * Whether `text` contains `prefix + name` as a whole tag, case-insensitively.
 * A tag ends at the end of the text or before any word character, `.` or `-`,
 * matching the former `(?![\w.-])` boundary without compiling a regex per name.
 */
function hasTag(text: string, name: string, prefix: "@" | "#"): boolean {
  if (name.length === 0) {
    return false;
  }
  const haystack = text;
  const needle = `${prefix}${name}`.toLowerCase();
  let from = haystack.indexOf(needle);
  while (from !== -1) {
    const after = haystack.charAt(from + needle.length);
    if (!/[\w@.-]/.test(haystack.charAt(from - 1)) && (after === "" || !/[\w.-]/.test(after))) {
      return true;
    }
    from = haystack.indexOf(needle, from + 1);
  }
  return false;
}

/** Index known names once, then walk only names sharing each text prefix. */
function mentionedNames(text: string, names: readonly string[]): Set<string> {
  interface Node {
    children: Map<string, Node>;
    name?: string;
  }
  const root: Node = { children: new Map() };
  for (const name of names) {
    const lower = name.toLowerCase();
    if (lower.length === 0) continue;
    let node = root;
    for (const char of lower.split("")) {
      let child = node.children.get(char);
      if (child === undefined) {
        child = { children: new Map() };
        node.children.set(char, child);
      }
      node = child;
    }
    node.name = lower;
  }
  const found = new Set<string>();
  for (let start = text.indexOf("@"); start !== -1; start = text.indexOf("@", start + 1)) {
    if (/[\w@.-]/.test(text.charAt(start - 1))) continue;
    let longest: string | undefined;
    let node = root;
    for (let index = start + 1; index < text.length; index++) {
      const child = node.children.get(text.charAt(index));
      if (child === undefined) break;
      node = child;
      if (node.name !== undefined && !/[\w.-]/.test(text.charAt(index + 1))) longest = node.name;
    }
    if (longest !== undefined) found.add(longest);
  }
  return found;
}

/**
 * Resolves mentions in `text` against the channel's members and roles.
 * Longest display name wins so `@alice` does not shadow `@alice.smith`.
 */
export function resolveMentions(
  text: string,
  members: readonly MentionTarget[],
  roles: readonly RoleMentionTarget[] = [],
  options: { readonly expandRoles?: boolean } = {},
): MentionResolution {
  const userIds = new Set<string>();
  const roleIds = new Set<string>();
  const explicitUserIds = new Set<string>();
  let here = false;
  let everyone = false;

  if (hasBroadcastToken(text, "here")) {
    here = true;
  }
  if (hasBroadcastToken(text, "everyone")) {
    everyone = true;
  }

  const directMembers = [...members].sort((a, b) => b.displayName.length - a.displayName.length);
  // The default role is reached through `@everyone`, never as a role mention.
  const mentionableRoles = roles.filter(
    (role) => role.mentionable && role.roleId !== EVERYONE_ROLE_ID,
  );

  const lowerText = broadcastMentionText(text).toLowerCase();
  const foundNames = mentionedNames(lowerText, [
    ...members.map((member) => member.displayName),
    ...mentionableRoles.map((role) => role.name),
  ]);
  foundNames.delete("here");
  foundNames.delete("everyone");
  for (const member of directMembers) {
    if (foundNames.has(member.displayName.toLowerCase())) {
      userIds.add(member.userId);
      explicitUserIds.add(member.userId);
    }
  }
  for (const role of mentionableRoles) {
    if (foundNames.has(role.name.toLowerCase())) {
      roleIds.add(role.roleId);
      if (options.expandRoles !== false) {
        for (const userId of role.memberUserIds) userIds.add(userId);
      }
    }
  }

  return {
    explicitUserIds: [...explicitUserIds].sort(),
    userIds: [...userIds].sort(),
    roleIds: [...roleIds].sort(),
    here,
    everyone,
  };
}

/** Legacy servers only: expands broadcast markers into channel-visible member ids. */
export function expandBroadcast(
  resolution: MentionResolution,
  memberIds: readonly string[],
): string[] {
  const ids = new Set(resolution.userIds);
  if (resolution.everyone) {
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
  text = broadcastMentionText(text);
  const channelIds = new Set<string>();
  const categoryIds = new Set<string>();

  if (text.match(CHANNEL_TOKEN) === null) {
    return { channelIds: [], categoryIds: [] };
  }

  const channel = [...channels]
    .sort((a, b) => b.name.length - a.name.length)
    .find((candidate) => hasTag(text.toLowerCase(), candidate.name, "#"));
  if (channel !== undefined) {
    channelIds.add(channel.channelId);
  } else {
    const category = [...categories]
      .sort((a, b) => b.name.length - a.name.length)
      .find((candidate) => hasTag(text.toLowerCase(), candidate.name, "#"));
    if (category !== undefined) {
      categoryIds.add(category.categoryId);
    }
  }

  return {
    channelIds: [...channelIds].sort(),
    categoryIds: [...categoryIds].sort(),
  };
}

/** Channel preferences override the workspace preference for broadcast cues. */
export function suppressesBroadcast(
  message: {
    channelId: string;
    mentionEveryone?: boolean;
    mentionHere?: boolean;
    mentionUserIds?: readonly string[];
    broadcastDirectUserIds?: readonly string[];
  },
  userId: string,
  prefs:
    | readonly {
        scope: string;
        channelId: string | null;
        suppressMassMentions?: boolean | null | undefined;
      }[]
    | undefined,
): boolean {
  if ((message.broadcastDirectUserIds ?? message.mentionUserIds)?.includes(userId)) return false;
  if (message.mentionEveryone !== true && message.mentionHere !== true) return false;
  const pref =
    prefs?.find(
      (row) =>
        row.scope === "channel" &&
        row.channelId === message.channelId &&
        row.suppressMassMentions != null,
    ) ?? prefs?.find((row) => row.scope === "server");
  return pref?.suppressMassMentions === true;
}

/** Mass mentions are only available in channel messages, never replies or DMs. */
export function canUseMassMentions(
  channel: { readonly kind: string } | undefined,
  threadRootId: string | null | undefined,
  permissions: bigint,
): boolean {
  return (
    channel !== undefined &&
    channel.kind !== "dm" &&
    channel.kind !== "group_dm" &&
    !threadRootId &&
    hasPermission(permissions, Permission.MentionEveryone)
  );
}
