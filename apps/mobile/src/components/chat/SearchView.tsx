import { activityLabel, type ChannelView, type PresenceRow, type SearchHit } from "@aulora/core";
import { Icon, Spinner, Text, usePalette } from "@aulora/ui-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { selectionFeedback } from "../../lib/haptics";
import { highlightParts } from "../../lib/search-ui";
import type { MobileMemberEntry } from "../../providers/ChatProvider";
import { PaneHeader, useDockClearance } from "./HubPane";
import { ListGroup, ListHeader, ListRow } from "./List";
import { MemberAvatar } from "./MemberAvatar";
import { PresenceAvatar } from "./PresenceAvatar";
import { HorizontalScroll } from "./SwipePanes";

type Scope = "all" | "messages" | "conversations" | "people";

const SCOPES: readonly { readonly key: Scope; readonly label: string }[] = [
  { key: "all", label: "All" },
  { key: "messages", label: "Messages" },
  { key: "conversations", label: "Conversations" },
  { key: "people", label: "People" },
];

const RECENT_LIMIT = 6;

export function SearchView({
  channels,
  titles,
  members,
  memberNames,
  presence,
  ownUserId,
  recentKey,
  search,
  loadHistory,
  onOpen,
  onOpenMember,
}: {
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
}) {
  const palette = usePalette();
  const clearance = useDockClearance();
  const keyboard = useReanimatedKeyboardAnimation();
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [hits, setHits] = useState<readonly SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archive, setArchive] = useState<"loading" | "complete" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  const [recent, setRecent] = useState<readonly string[]>([]);
  const trimmed = query.trim();

  useEffect(() => {
    void AsyncStorage.getItem(recentKey)
      .then((stored) => {
        const parsed: unknown = stored === null ? [] : JSON.parse(stored);
        if (Array.isArray(parsed)) setRecent(parsed.filter((entry) => typeof entry === "string"));
      })
      .catch(() => undefined);
  }, [recentKey]);

  function remember() {
    if (trimmed.length < 2) return;
    const next = [trimmed, ...recent.filter((entry) => entry !== trimmed)].slice(0, RECENT_LIMIT);
    setRecent(next);
    void AsyncStorage.setItem(recentKey, JSON.stringify(next)).catch(() => undefined);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` restarts the history read after a failure
  useEffect(() => {
    let cancelled = false;
    setHits([]);
    setError(null);
    setArchive("loading");
    setBusy(trimmed.length > 0);
    if (trimmed.length === 0) return;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const results = await search(trimmed);
          if (cancelled) return;
          setHits(results);
        } catch {
          if (!cancelled) setError("Couldn't search messages. Try again.");
          return;
        } finally {
          if (!cancelled) setBusy(false);
        }
        // Results from loaded history show at once; older pages refine them.
        try {
          for (;;) {
            const complete = await loadHistory();
            if (cancelled) return;
            setHits(await search(trimmed));
            if (cancelled) return;
            if (complete) break;
          }
          setArchive("complete");
        } catch {
          if (!cancelled) setArchive("failed");
        }
      })();
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, search, loadHistory, attempt]);

  const needle = trimmed.toLocaleLowerCase();
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
  const messages = useMemo(
    () => hits.filter((hit) => channels.some((channel) => channel.id === hit.channelId)),
    [hits, channels],
  );

  const showConversations =
    (scope === "all" || scope === "conversations") && conversations.length > 0;
  const showPeople = (scope === "all" || scope === "people") && people.length > 0;
  const showMessages = scope === "all" || scope === "messages";
  const settled = !busy && error === null && archive !== "loading";
  const nothing =
    trimmed.length > 0 &&
    settled &&
    !showConversations &&
    !showPeople &&
    (!showMessages || messages.length === 0);

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

        {trimmed.length === 0 &&
          (recent.length > 0 ? (
            <View>
              <ListHeader
                title="Recent"
                action={
                  <Pressable
                    accessibilityRole="button"
                    hitSlop={8}
                    className="min-h-9 justify-center px-3"
                    onPress={() => {
                      setRecent([]);
                      void AsyncStorage.removeItem(recentKey).catch(() => undefined);
                    }}
                  >
                    <Text size="xs" tone="muted">
                      Clear
                    </Text>
                  </Pressable>
                }
              />
              <ListGroup>
                {recent.map((entry) => (
                  <ListRow
                    key={entry}
                    icon="search"
                    title={entry}
                    onPress={() => setQuery(entry)}
                  />
                ))}
              </ListGroup>
            </View>
          ) : (
            <View className="items-center gap-2 px-8 pt-16">
              <View className="h-14 w-14 items-center justify-center rounded-pill bg-surface-2">
                <Icon name="search" size={26} color={palette["text-muted"]} />
              </View>
              <Text tone="muted" className="text-center">
                Find a message by what was said, or jump straight to a conversation or a person.
              </Text>
            </View>
          ))}

        {showConversations && (
          <View>
            <ListHeader title="Conversations" />
            <ListGroup>
              {conversations.slice(0, scope === "all" ? 4 : undefined).map((channel) => (
                <ListRow
                  key={channel.id}
                  icon={
                    channel.kind === "dm" || channel.kind === "group_dm"
                      ? "at"
                      : channel.isPrivate === true
                        ? "lock"
                        : channel.kind === "announcement"
                          ? "megaphone"
                          : "hash"
                  }
                  title={titles.get(channel.id) ?? channel.name}
                  subtitle={channel.topic ?? undefined}
                  chevron
                  onPress={() => {
                    remember();
                    onOpen(channel.id);
                  }}
                />
              ))}
            </ListGroup>
          </View>
        )}

        {showPeople && (
          <View>
            <ListHeader title="People" />
            <ListGroup>
              {people.slice(0, scope === "all" ? 4 : undefined).map((member) => {
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
                      remember();
                      onOpenMember(member.userId);
                    }}
                  />
                );
              })}
            </ListGroup>
          </View>
        )}

        {trimmed.length > 0 && showMessages && (messages.length > 0 || busy) && (
          <View>
            <ListHeader title={busy ? "Messages" : `Messages · ${messages.length}`} />
            {busy ? (
              <View className="items-center py-6">
                <Spinner label="Searching messages" />
              </View>
            ) : (
              <ListGroup inset={56}>
                {messages.map((hit) => (
                  <Pressable
                    key={hit.messageId}
                    accessibilityRole="button"
                    android_ripple={{ color: palette["surface-3"] }}
                    className="flex-row gap-3 px-3 py-2.5 active:bg-surface-3"
                    onPress={() => {
                      remember();
                      onOpen(hit.channelId, hit.messageId);
                    }}
                  >
                    <MemberAvatar userId={hit.authorId} size={32} />
                    <View className="min-w-0 flex-1 gap-0.5">
                      <View className="flex-row items-baseline gap-2">
                        <Text size="sm" className="shrink font-semibold" numberOfLines={1}>
                          {memberNames.get(hit.authorId) ?? "Member"}
                        </Text>
                        <Text size="xs" tone="muted" className="flex-1" numberOfLines={1}>
                          {titles.get(hit.channelId) ?? "Conversation"}
                          {hit.threadRootId !== undefined ? " · thread" : ""}
                        </Text>
                        <Text size="xs" tone="muted">
                          {activityLabel(hit.createdAt)}
                        </Text>
                      </View>
                      <Text size="sm" tone="muted" numberOfLines={3}>
                        {highlightParts(hit.snippet, trimmed).map((part, index) =>
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
                ))}
              </ListGroup>
            )}
          </View>
        )}

        {error !== null && (
          <Text tone="danger" accessibilityRole="alert" className="px-4">
            {error}
          </Text>
        )}
        {nothing && (
          <View className="items-center gap-1 px-8 pt-10">
            <Text className="font-semibold">No results for “{trimmed}”</Text>
            <Text size="sm" tone="muted" className="text-center">
              Check the spelling, or try a different word from the message.
            </Text>
          </View>
        )}
        {trimmed.length > 0 && !busy && error === null && archive === "loading" && showMessages && (
          <View className="flex-row items-center justify-center gap-2">
            <Spinner size={16} label="Searching earlier messages" />
            <Text tone="muted" size="xs">
              Searching earlier messages…
            </Text>
          </View>
        )}
        {trimmed.length > 0 && !busy && error === null && archive === "failed" && (
          <Pressable
            accessibilityRole="button"
            className="items-center gap-1 px-6 active:opacity-70"
            onPress={() => setAttempt((current) => current + 1)}
          >
            <Text size="xs" tone="muted" className="text-center" accessibilityRole="alert">
              Couldn't reach earlier messages, so these results only cover history already on this
              device.
            </Text>
            <Text size="sm" tone="accent">
              Try again
            </Text>
          </Pressable>
        )}
      </ScrollView>

      <View className="gap-2 px-3 pt-2">
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
                  setScope(entry.key);
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
        <Pressable
          accessible={false}
          onPress={() => inputRef.current?.focus()}
          className="min-h-12 flex-row items-center gap-2 rounded-pill border border-border bg-surface-2 px-4"
        >
          <Icon name="search" size={20} color={palette["text-muted"]} />
          <TextInput
            ref={inputRef}
            autoFocus
            accessibilityLabel="Search"
            placeholder="Search this workspace"
            placeholderTextColor={palette["text-muted"]}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={remember}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            maxFontSizeMultiplier={1.6}
            className="min-h-12 flex-1 py-0 text-[17px] text-text"
          />
          {query.length > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={10}
              onPress={() => setQuery("")}
              className="h-6 w-6 items-center justify-center rounded-pill bg-surface-3"
            >
              <Icon name="x" size={14} color={palette["text-muted"]} />
            </Pressable>
          )}
        </Pressable>
      </View>
    </Animated.View>
  );
}
