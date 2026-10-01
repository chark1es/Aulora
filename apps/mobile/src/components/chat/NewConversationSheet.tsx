import { Button, Input, Text } from "@aulora/ui-native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import type { MobileMemberEntry } from "../../lib/permissions";
import { MemberAvatar } from "./MemberAvatar";
import { Sheet } from "./Sheet";

export function NewConversationSheet({
  members,
  ownUserId,
  onCreate,
  onClose,
}: {
  readonly members: readonly MobileMemberEntry[];
  readonly ownUserId: string;
  readonly onCreate: (memberIds: readonly string[]) => Promise<void>;
  readonly onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choices = members.filter(
    (member) =>
      member.userId !== ownUserId &&
      member.displayName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <Sheet visible title="New message" onClose={onClose}>
      <View className="flex-1 gap-3 p-4">
        <Input
          label="Find people"
          value={query}
          onChangeText={setQuery}
          clearButtonMode="while-editing"
        />
        <Text tone="muted" size="sm">
          Choose one person for a direct message or several for a group.
        </Text>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 4 }}>
          {choices.map((member) => {
            const checked = selected.includes(member.userId);
            return (
              <Pressable
                key={member.userId}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                className="min-h-12 flex-row items-center gap-3 rounded-input bg-surface-2 p-3"
                onPress={() =>
                  setSelected((current) =>
                    checked
                      ? current.filter((id) => id !== member.userId)
                      : [...current, member.userId],
                  )
                }
              >
                <MemberAvatar userId={member.userId} size={32} />
                <Text className="flex-1">{member.displayName}</Text>
                <Text>{checked ? "✓" : ""}</Text>
              </Pressable>
            );
          })}
          {choices.length === 0 && <Text tone="muted">No matching people.</Text>}
        </ScrollView>
        {error !== null && (
          <Text tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        )}
        <Button
          loading={busy}
          disabled={selected.length === 0}
          onPress={() => {
            setBusy(true);
            setError(null);
            void onCreate(selected)
              .catch((cause: unknown) =>
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Couldn't start the conversation. Try again.",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          {selected.length > 1 ? `Start group message (${selected.length})` : "Start message"}
        </Button>
      </View>
    </Sheet>
  );
}
