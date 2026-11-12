import { orderMentionSuggestions, type RoleMentionTarget } from "@aulora/core";
import { useMemo } from "react";

export interface MentionCandidate {
  readonly key: string;
  readonly label: string;
  readonly insert: string;
  readonly detail: string;
}

/** `@name` or `#channel` being typed at the end of the draft. */
export const MENTION_TRIGGER = /(^|\s)([@#])([^\s@#]*)$/;

const MAX_SUGGESTIONS = 6;

export interface MentionSources {
  readonly canMentionEveryone: boolean;
  readonly members: readonly { readonly userId: string; readonly displayName: string }[];
  readonly roles: readonly RoleMentionTarget[];
  readonly channels: readonly { readonly id: string; readonly name: string }[];
}

const BROADCAST_CANDIDATES: readonly MentionCandidate[] = [
  { key: "@here", label: "here", insert: "@here", detail: "Notify online members" },
  {
    key: "@everyone",
    label: "everyone",
    insert: "@everyone",
    detail: "Notify everyone in this channel",
  },
];

/** Every mention the viewer could insert, in the order the list shows them. */
export function buildMentionCandidates(sources: MentionSources) {
  const { canMentionEveryone, members, roles, channels } = sources;
  return orderMentionSuggestions([
    ...(canMentionEveryone ? BROADCAST_CANDIDATES : []),
    ...members.map((member) => ({
      key: `@${member.userId}`,
      label: member.displayName,
      insert: `@${member.displayName}`,
      detail: "Member",
    })),
    ...roles
      .filter((role) => role.mentionable)
      .map((role) => ({
        key: `role:${role.roleId}`,
        label: role.name,
        insert: `@${role.name}`,
        detail: "Role",
      })),
    ...channels.map((channel) => ({
      key: `#${channel.id}`,
      label: channel.name,
      insert: `#${channel.name}`,
      detail: "Channel",
    })),
  ]);
}

/** The candidates matching the trigger at the end of the draft, at most six. */
export const matchMentionSuggestions = (
  value: string,
  candidates: readonly MentionCandidate[],
): MentionCandidate[] => {
  const trigger = MENTION_TRIGGER.exec(value);
  if (trigger === null) return [];
  const [, , prefix = "", rawQuery = ""] = trigger;
  const query = rawQuery.toLowerCase();
  return candidates
    .filter((candidate) => candidate.insert.startsWith(prefix))
    .filter((candidate) => candidate.label.toLowerCase().includes(query))
    .slice(0, MAX_SUGGESTIONS);
};

/** The draft with the trigger at its end replaced by the chosen mention. */
export function insertMention(value: string, candidate: MentionCandidate) {
  return value.replace(
    MENTION_TRIGGER,
    (_match, leading: string) => `${leading}${candidate.insert} `,
  );
}

/** Suggestions for the mention being typed, from members, roles and channels. */
export function useMentionSuggestions(value: string, sources: MentionSources) {
  const { canMentionEveryone, members, roles, channels } = sources;
  const candidates = useMemo(
    () => buildMentionCandidates({ canMentionEveryone, members, roles, channels }),
    [canMentionEveryone, members, roles, channels],
  );
  return useMemo(() => matchMentionSuggestions(value, candidates), [value, candidates]);
}
