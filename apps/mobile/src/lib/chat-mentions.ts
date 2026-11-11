import {
  buildSendMentions,
  type RoleMentionTarget,
  resolveChannelMentions,
  resolveMentions,
} from "@aulora/core";

/** Everything `@` and `#` autocomplete resolves against when a message is sent. */
export interface SendMentionTargets {
  readonly userTargets: readonly { readonly userId: string; readonly displayName: string }[];
  readonly memberIds: readonly string[];
  readonly canMentionEveryone?: boolean;
  readonly roles: readonly RoleMentionTarget[];
  readonly channelTargets: readonly { readonly channelId: string; readonly name: string }[];
  readonly categoryTargets: readonly { readonly categoryId: string; readonly name: string }[];
}

/** Mention ids ready to pass to `sendMessage`; empty kinds are omitted. */
export interface SendMentionOptions {
  readonly mentionUserIds?: readonly string[];
  readonly mentionEveryone?: boolean;
  readonly mentionHere?: boolean;
  readonly mentionChannelIds?: readonly string[];
  readonly mentionCategoryIds?: readonly string[];
  readonly mentionRoleIds?: readonly string[];
}

/**
 * Resolves the text of a message (main composer or a thread reply) into every
 * mention kind the server stores, so replies cannot silently drop mentions.
 */
export function resolveSendMentions(text: string, targets: SendMentionTargets): SendMentionOptions {
  const resolution = resolveMentions(text, targets.userTargets, targets.roles, {
    expandRoles: false,
  });
  const channels = resolveChannelMentions(text, targets.channelTargets, targets.categoryTargets);
  const built = buildSendMentions({
    resolution,
    memberIds: targets.memberIds,
    capabilities: { mentionMarkers: true },
    canMentionEveryone: targets.canMentionEveryone ?? false,
  });
  return {
    ...(built.mentionEveryone === true ? { mentionEveryone: built.mentionEveryone } : {}),
    ...(built.mentionHere === true ? { mentionHere: built.mentionHere } : {}),
    ...(built.mentionUserIds.length > 0 ? { mentionUserIds: built.mentionUserIds } : {}),
    ...(channels.channelIds.length > 0 ? { mentionChannelIds: channels.channelIds } : {}),
    ...(channels.categoryIds.length > 0 ? { mentionCategoryIds: channels.categoryIds } : {}),
    ...(resolution.roleIds.length > 0 ? { mentionRoleIds: resolution.roleIds } : {}),
  };
}
