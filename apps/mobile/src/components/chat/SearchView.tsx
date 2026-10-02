/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { ChannelView, PresenceRow, SearchHit } from "@aulora/core";
import { Icon, Text, usePalette } from "@aulora/ui-native";
import { useMemo, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { selectionFeedback } from "../../lib/haptics";
import { useMessageSearch, useRecentSearches } from "../../lib/use-search";
import type { MobileMemberEntry } from "../../providers/ChatProvider";
import { PaneHeader, useDockClearance } from "./HubPane";
import {
  ConversationResults,
  MessageResults,
  PeopleResults,
  RecentList,
  SearchStatus,
} from "./SearchResults";
import { HorizontalScroll } from "./SwipePanes";

type Scope = "all" | "messages" | "conversations" | "people";

const SCOPES: readonly { readonly key: Scope; readonly label: string }[] = [
  { key: "all", label: "All" },
  { key: "messages", label: "Messages" },
  { key: "conversations", label: "Conversations" },
  { key: "people", label: "People" },
];

export interface SearchViewProps {
  readonly channels: readonly ChannelView[];
  readonly titles: ReadonlyMap<string, string>;
  readonly members: readonly MobileMemberEntry[];
  readonly memberNames: ReadonlyMap<string, string>;
  readonly presence: readonly PresenceRow[];
  readonly ownUserId: string;
  /** Where recent searches are stored; scoped to this server and account. */
  readonly recentKey: string;
  readonly search: (query: string) => Promise<readonly SearchHit[]>;
  /** Indexes one more page of server history; resolves `true` when none is left. */
  readonly loadHistory: () => Promise<boolean>;
  readonly onOpen: (channelId: string, messageId?: string) => void;
  readonly onOpenMember: (userId: string) => void;
}

interface ScopeChipsProps {
  readonly scope: Scope;
  readonly onScope: (scope: Scope) => void;
}

function ScopeChips({ scope, onScope }: ScopeChipsProps) {
  const palette = usePalette();
  return (
    <HorizontalScroll keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>
      {SCOPES.map((entry) => {
        const active = entry.key === scope;
        return (
          <Pressable
            key={entry.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            hitSlop={{ top: 6, bottom: 6 }}
            onPress={() => {
              if (!active) selectionFeedback();
              onScope(entry.key);
            }}
            className={`min-h-9 justify-center rounded-pill px-4 ${
              active ? "bg-accent" : "bg-surface-2"
            }`}
          >
            <Text
              size="sm"
              className={active ? "font-semibold" : ""}
              style={{ color: active ? palette["on-accent"] : palette["text-muted"] }}
              maxFontSizeMultiplier={1.4}
            >
              {entry.label}
            </Text>
          </Pressable>
        );
      })}
    </HorizontalScroll>
  );
}

interface ClearButtonProps {
  readonly onPress: () => void;
}

function ClearButton({ onPress }: ClearButtonProps) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Clear search"
      hitSlop={10}
      onPress={onPress}
      className="h-6 w-6 items-center justify-center rounded-pill bg-surface-3"
    >
      <Icon name="x" size={14} color={palette["text-muted"]} />
    </Pressable>
  );
}

interface SearchFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
}

/** The query field. It sits just above the dock so it stays within thumb reach. */
function SearchField({ value, onChange, onSubmit }: SearchFieldProps) {
  const palette = usePalette();
  const inputRef = useRef<TextInput>(null);
  // Tapping anywhere on the pill, not just the text, focuses the field.
  function focusInput() {
    inputRef.current?.focus();
  }
  return (
    <Pressable
      accessible={false}
      onPress={focusInput}
      className="min-h-12 flex-row items-center gap-2 rounded-pill border border-border bg-surface-2 px-4"
    >
      <Icon name="search" size={20} color={palette["text-muted"]} />
      <TextInput
        ref={inputRef}
        autoFocus
        accessibilityLabel="Search"
        placeholder="Search this workspace"
        placeholderTextColor={palette["text-muted"]}
        value={value}
        onChangeText={onChange}
        onSubmitEditing={onSubmit}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        maxFontSizeMultiplier={1.6}
        className="min-h-12 flex-1 py-0 text-[17px] text-text"
      />
      {value.length > 0 && (
        <ClearButton
          onPress={() => {
            onChange("");
          }}
        />
      )}
    </Pressable>
  );
}

/** Conversations and people whose names contain the query. */
function useNameMatches(props: SearchViewProps, query: string) {
  const { channels, titles, members, ownUserId } = props;
  const needle = query.toLocaleLowerCase();
  const conversations = useMemo(
    () =>
      needle.length === 0
        ? []
        : channels.filter(
            (channel) =>
              channel.kind !== "voice" &&
              (titles.get(channel.id) ?? channel.name).toLocaleLowerCase().includes(needle),
          ),
    [channels, titles, needle],
  );
  const people = useMemo(
    () =>
      needle.length === 0
        ? []
        : members.filter(
            (member) =>
              member.userId !== ownUserId &&
              member.displayName.toLocaleLowerCase().includes(needle),
          ),
    [members, ownUserId, needle],
  );
  return { conversations, people };
}

/** Everything the results list shows for the current query and scope. */
function useSearchModel(props: SearchViewProps, query: string, scope: Scope) {
  const recents = useRecentSearches(props.recentKey);
  const state = useMessageSearch(query, props.search, props.loadHistory);
  const { conversations, people } = useNameMatches(props, query);
  const { channels } = props;
  const messages = useMemo(
    () => state.hits.filter((hit) => channels.some((channel) => channel.id === hit.channelId)),
    [state.hits, channels],
  );
  const showsMessages = scope === "all" || scope === "messages";
  const showConversations =
    (scope === "all" || scope === "conversations") && conversations.length > 0;
  const showPeople = (scope === "all" || scope === "people") && people.length > 0;
  const settled = !state.busy && state.error === null && state.archive !== "loading";
  const found = showConversations || showPeople || (showsMessages && messages.length > 0);
  return {
    recents,
    state,
    conversations,
    people,
    messages,
    showsMessages,
    showConversations,
    showPeople,
    nothing: query.length > 0 && settled && !found,
  };
}

interface SearchBodyProps {
  readonly view: SearchViewProps;
  readonly model: ReturnType<typeof useSearchModel>;
  readonly query: string;
  readonly preview: boolean;
  readonly onPickRecent: (query: string) => void;
}

/** The scrolling results: recents before typing, then each kind of match. */
function SearchBody({ view, model, query, preview, onPickRecent }: SearchBodyProps) {
  const { recents, state, messages } = model;
  const showMessages = query.length > 0 && model.showsMessages;
  return (
    <>
      {query.length === 0 && <RecentList searches={recents} onPick={onPickRecent} />}
      {model.showConversations && (
        <ConversationResults
          conversations={model.conversations}
          titles={view.titles}
          preview={preview}
          onOpen={(channelId) => {
            recents.remember(query);
            view.onOpen(channelId);
          }}
        />
      )}
      {model.showPeople && (
        <PeopleResults
          people={model.people}
          presence={view.presence}
          preview={preview}
          onOpen={(userId) => {
            recents.remember(query);
            view.onOpenMember(userId);
          }}
        />
      )}
      {showMessages && (messages.length > 0 || state.busy) && (
        <MessageResults
          messages={messages}
          busy={state.busy}
          query={query}
          titles={view.titles}
          memberNames={view.memberNames}
          onOpen={(channelId, messageId) => {
            recents.remember(query);
            view.onOpen(channelId, messageId);
          }}
        />
      )}
      <SearchStatus
        query={query}
        state={state}
        nothing={model.nothing}
        showsMessages={model.showsMessages}
      />
    </>
  );
}

/** The hub's search tab: messages, conversations and people, with the field at thumb height. */
export function SearchView(props: SearchViewProps) {
  const clearance = useDockClearance();
  const keyboard = useReanimatedKeyboardAnimation();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const trimmed = query.trim();
  const model = useSearchModel(props, trimmed, scope);

  const lift = useAnimatedStyle(() => ({
    flex: 1,
    paddingBottom: Math.max(clearance, -keyboard.height.value + 8),
  }));

  return (
    <Animated.View style={lift}>
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16, gap: 16 }}
      >
        <View className="-mx-3">
          <PaneHeader title="Search" subtitle="Messages, conversations and people" />
        </View>
        <SearchBody
          view={props}
          model={model}
          query={trimmed}
          preview={scope === "all"}
          onPickRecent={setQuery}
        />
      </ScrollView>

      <View className="gap-2 px-3 pt-2">
        <ScopeChips scope={scope} onScope={setScope} />
        <SearchField
          value={query}
          onChange={setQuery}
          onSubmit={() => {
            model.recents.remember(trimmed);
          }}
        />
      </View>
    </Animated.View>
  );
}
