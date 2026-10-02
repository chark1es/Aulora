/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { activityLabel, type ChannelView, type PresenceRow, type SearchHit } from "@aulora/core";
import type { IconName } from "@aulora/tokens";
import { Icon, Spinner, Text, usePalette } from "@aulora/ui-native";
import { Pressable, View } from "react-native";
import { highlightParts } from "../../lib/search-ui";
import type { MessageSearch, RecentSearches } from "../../lib/use-search";
import type { MobileMemberEntry } from "../../providers/ChatProvider";
import { ListGroup, ListHeader, ListRow } from "./List";
import { MemberAvatar } from "./MemberAvatar";
import { PresenceAvatar } from "./PresenceAvatar";

/** How many conversations or people the "All" scope shows before narrowing. */
const PREVIEW_COUNT = 4;

function conversationIcon(channel: ChannelView): IconName {
  if (channel.kind === "dm" || channel.kind === "group_dm") return "at";
  if (channel.isPrivate === true) return "lock";
  return channel.kind === "announcement" ? "megaphone" : "hash";
}

interface RecentListProps {
  readonly searches: RecentSearches;
  readonly onPick: (query: string) => void;
}

/** What shows before anything is typed: past queries, or a hint when there are none. */
export function RecentList({ searches, onPick }: RecentListProps) {
  const palette = usePalette();
  if (searches.recent.length === 0) {
    return (
      <View className="items-center gap-2 px-8 pt-16">
        <View className="h-14 w-14 items-center justify-center rounded-pill bg-surface-2">
          <Icon name="search" size={26} color={palette["text-muted"]} />
        </View>
        <Text tone="muted" className="text-center">
          Find a message by what was said, or jump straight to a conversation or a person.
        </Text>
      </View>
    );
  }
  return (
    <View>
      <ListHeader
        title="Recent"
        action={
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            className="min-h-9 justify-center px-3"
            onPress={searches.clear}
          >
            <Text size="xs" tone="muted">
              Clear
            </Text>
          </Pressable>
        }
      />
      <ListGroup>
        {searches.recent.map((entry) => (
          <ListRow
            key={entry}
            icon="search"
            title={entry}
            onPress={() => {
              onPick(entry);
            }}
          />
        ))}
      </ListGroup>
    </View>
  );
}

interface ConversationResultsProps {
  readonly conversations: readonly ChannelView[];
  readonly titles: ReadonlyMap<string, string>;
  /** Show only the first few, as the "All" scope does. */
  readonly preview: boolean;
  readonly onOpen: (channelId: string) => void;
}

export function ConversationResults(props: ConversationResultsProps) {
  const { conversations, titles, preview } = props;
  return (
    <View>
      <ListHeader title="Conversations" />
      <ListGroup>
        {conversations.slice(0, preview ? PREVIEW_COUNT : undefined).map((channel) => (
          <ListRow
            key={channel.id}
            icon={conversationIcon(channel)}
            title={titles.get(channel.id) ?? channel.name}
            subtitle={channel.topic ?? undefined}
            chevron
            onPress={() => {
              props.onOpen(channel.id);
            }}
          />
        ))}
      </ListGroup>
    </View>
  );
}

interface PeopleResultsProps {
  readonly people: readonly MobileMemberEntry[];
  readonly presence: readonly PresenceRow[];
  /** Show only the first few, as the "All" scope does. */
  readonly preview: boolean;
  readonly onOpen: (userId: string) => void;
}

export function PeopleResults({ people, presence, preview, onOpen }: PeopleResultsProps) {
  return (
    <View>
      <ListHeader title="People" />
      <ListGroup>
        {people.slice(0, preview ? PREVIEW_COUNT : undefined).map((member) => {
          const row = presence.find((entry) => entry.userId === member.userId);
          return (
            <ListRow
              key={member.userId}
              title={member.displayName}
              subtitle={row?.customStatus ?? undefined}
              leading={
                <PresenceAvatar
                  userId={member.userId}
                  status={row?.status ?? "offline"}
                  roleColor={member.roleColor}
                  size={36}
                />
              }
              chevron
              onPress={() => {
                onOpen(member.userId);
              }}
            />
          );
        })}
      </ListGroup>
    </View>
  );
}

interface MessageHitProps {
  readonly hit: SearchHit;
  readonly query: string;
  readonly author: string;
  readonly place: string;
  readonly onOpen: () => void;
}

/** One matching message: who said it, where and when, with the match marked. */
function MessageHit({ hit, query, author, place, onOpen }: MessageHitProps) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      className="flex-row gap-3 px-3 py-2.5 active:bg-surface-3"
      onPress={onOpen}
    >
      <MemberAvatar userId={hit.authorId} size={32} />
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row items-baseline gap-2">
          <Text size="sm" className="shrink font-semibold" numberOfLines={1}>
            {author}
          </Text>
          <Text size="xs" tone="muted" className="flex-1" numberOfLines={1}>
            {place}
          </Text>
          <Text size="xs" tone="muted">
            {activityLabel(hit.createdAt)}
          </Text>
        </View>
        <Text size="sm" tone="muted" numberOfLines={3}>
          {highlightParts(hit.snippet, query).map((part, index) =>
            part.match ? (
              <Text
                // biome-ignore lint/suspicious/noArrayIndexKey: parts of one static snippet
                key={index}
                size="sm"
                className="font-semibold"
                style={{ backgroundColor: palette["accent-soft"] }}
              >
                {part.text}
              </Text>
            ) : (
              part.text
            ),
          )}
        </Text>
      </View>
    </Pressable>
  );
}

interface MessageResultsProps {
  readonly messages: readonly SearchHit[];
  readonly busy: boolean;
  readonly query: string;
  readonly titles: ReadonlyMap<string, string>;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly onOpen: (channelId: string, messageId: string) => void;
}

export function MessageResults(props: MessageResultsProps) {
  const { messages, busy, query, titles, memberNames } = props;
  return (
    <View>
      <ListHeader title={busy ? "Messages" : `Messages · ${messages.length}`} />
      {busy ? (
        <View className="items-center py-6">
          <Spinner label="Searching messages" />
        </View>
      ) : (
        <ListGroup inset={56}>
          {messages.map((hit) => (
            <MessageHit
              key={hit.messageId}
              hit={hit}
              query={query}
              author={memberNames.get(hit.authorId) ?? "Member"}
              place={`${titles.get(hit.channelId) ?? "Conversation"}${
                hit.threadRootId !== undefined ? " · thread" : ""
              }`}
              onOpen={() => {
                props.onOpen(hit.channelId, hit.messageId);
              }}
            />
          ))}
        </ListGroup>
      )}
    </View>
  );
}

interface SearchStatusProps {
  readonly query: string;
  readonly state: MessageSearch;
  /** Nothing matched in any visible section once searching settled. */
  readonly nothing: boolean;
  /** The current scope includes messages. */
  readonly showsMessages: boolean;
}

/** The line under the results: an error, "no results", or progress through older history. */
export function SearchStatus({ query, state, nothing, showsMessages }: SearchStatusProps) {
  if (state.error !== null) {
    return (
      <Text tone="danger" accessibilityRole="alert" className="px-4">
        {state.error}
      </Text>
    );
  }
  if (nothing) {
    return (
      <View className="items-center gap-1 px-8 pt-10">
        <Text className="font-semibold">{`No results for “${query}”`}</Text>
        <Text size="sm" tone="muted" className="text-center">
          Check the spelling, or try a different word from the message.
        </Text>
      </View>
    );
  }
  if (query.length === 0 || state.busy) return null;
  if (state.archive === "loading" && showsMessages) {
    return (
      <View className="flex-row items-center justify-center gap-2">
        <Spinner size={16} label="Searching earlier messages" />
        <Text tone="muted" size="xs">
          Searching earlier messages…
        </Text>
      </View>
    );
  }
  if (state.archive !== "failed") return null;
  return (
    <Pressable
      accessibilityRole="button"
      className="items-center gap-1 px-6 active:opacity-70"
      onPress={state.retry}
    >
      <Text size="xs" tone="muted" className="text-center" accessibilityRole="alert">
        Couldn't reach earlier messages, so these results only cover history already on this device.
      </Text>
      <Text size="sm" tone="accent">
        Try again
      </Text>
    </Pressable>
  );
}
