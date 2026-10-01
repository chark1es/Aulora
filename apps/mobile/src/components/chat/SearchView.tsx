import type { ChannelView, SearchHit } from "@aulora/core";
import { Button, Input, Spinner, Text } from "@aulora/ui-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

export function SearchView({
  channels,
  titles,
  memberNames,
  search,
  loadHistory,
  onOpen,
}: {
  readonly channels: readonly ChannelView[];
  readonly titles: ReadonlyMap<string, string>;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly search: (query: string) => Promise<readonly SearchHit[]>;
  /** Indexes one more page of server history; resolves `true` when none is left. */
  readonly loadHistory: () => Promise<boolean>;
  readonly onOpen: (channelId: string, messageId?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<readonly SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archive, setArchive] = useState<"loading" | "complete" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  const trimmed = query.trim();
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
  const matches = channels.filter((channel) =>
    (titles.get(channel.id) ?? channel.name)
      .toLocaleLowerCase()
      .includes(trimmed.toLocaleLowerCase()),
  );
  return (
    <View className="flex-1 gap-3 px-4 pt-3">
      <Input
        label="Search"
        placeholder="Conversations and messages"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 8, paddingBottom: 24 }}
      >
        <Text tone="muted" size="sm">
          Conversations
        </Text>
        {matches.map((channel) => (
          <Pressable
            key={channel.id}
            accessibilityRole="button"
            className="min-h-12 justify-center rounded-input bg-surface-2 px-3 py-3"
            onPress={() => onOpen(channel.id)}
          >
            <Text>{titles.get(channel.id) ?? channel.name}</Text>
          </Pressable>
        ))}
        {matches.length === 0 && <Text tone="muted">No matching conversations.</Text>}
        {trimmed.length > 0 && (
          <>
            <Text tone="muted" size="sm" className="mt-3">
              Messages
            </Text>
            {busy && <Spinner label="Searching messages" />}
            {error !== null && (
              <Text tone="danger" accessibilityRole="alert">
                {error}
              </Text>
            )}
            {!busy && error === null && archive === "complete" && hits.length === 0 && (
              <Text tone="muted">No matching messages.</Text>
            )}
            {hits
              .filter((hit) => channels.some((channel) => channel.id === hit.channelId))
              .map((hit) => (
                <Pressable
                  key={hit.messageId}
                  accessibilityRole="button"
                  className="gap-1 rounded-input bg-surface-2 px-3 py-3"
                  onPress={() => onOpen(hit.channelId, hit.messageId)}
                >
                  <Text size="sm" tone="muted">
                    {titles.get(hit.channelId) ?? "Conversation"} ·{" "}
                    {memberNames.get(hit.authorId) ?? "Member"}
                  </Text>
                  <Text>{hit.snippet}</Text>
                </Pressable>
              ))}
            {!busy && error === null && archive === "loading" && (
              <View className="flex-row items-center gap-2">
                <Spinner size={18} label="Searching earlier messages" />
                <Text tone="muted" size="sm">
                  Searching earlier messages…
                </Text>
              </View>
            )}
            {!busy && error === null && archive === "failed" && (
              <View className="gap-2">
                <Text tone="muted" accessibilityRole="alert">
                  Couldn't reach earlier messages. These results cover history already on this
                  device.
                </Text>
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={() => setAttempt((current) => current + 1)}
                >
                  Try again
                </Button>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
