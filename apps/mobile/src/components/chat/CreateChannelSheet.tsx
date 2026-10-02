import { Button, Input, Text, usePalette } from "@aulora/ui-native";
import { useState } from "react";
import { Pressable, ScrollView, Switch, View } from "react-native";
import { Sheet } from "./Sheet";

export type NewChannelKind = "text" | "announcement" | "voice";

const KIND_OPTIONS: readonly { readonly value: NewChannelKind; readonly label: string }[] = [
  { value: "text", label: "Text" },
  { value: "announcement", label: "Announcement" },
  { value: "voice", label: "Voice" },
];

export interface CreateChannelSheetProps {
  readonly visible: boolean;
  readonly categories: readonly { readonly id: string; readonly name: string }[];
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onCreateChannel: (input: {
    readonly kind: NewChannelKind;
    readonly name: string;
    readonly topic?: string;
    readonly categoryId?: string;
    readonly private: boolean;
  }) => void | Promise<void>;
  readonly onCreateCategory: (name: string) => void | Promise<void>;
  readonly onClose: () => void;
}

/** Create a text/voice channel or a category, mirroring the web dialogs. */
export function CreateChannelSheet({
  visible,
  categories,
  busy = false,
  error = null,
  onCreateChannel,
  onCreateCategory,
  onClose,
}: CreateChannelSheetProps) {
  const palette = usePalette();
  const [kind, setKind] = useState<NewChannelKind>("text");
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [isPrivate, setIsPrivate] = useState(false);

  const trimmed = name.trim();
  const disabled = trimmed.length === 0 || busy;

  function reset() {
    setName("");
    setTopic("");
    setCategoryId(undefined);
    setIsPrivate(false);
    setKind("text");
  }

  return (
    <Sheet
      visible={visible}
      title={"Create channel"}
      onClose={() => {
        reset();
        onClose();
      }}
    >
      <View className="flex-1 p-4">
        <View className="mt-3 flex-row gap-2">
          {KIND_OPTIONS.map((option) => {
            const active = option.value === kind;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  setKind(option.value);
                }}
                className={
                  active
                    ? "flex-1 items-center rounded-input border border-accent bg-accent-soft px-2 py-2"
                    : "flex-1 items-center rounded-input border border-border bg-surface-3 px-2 py-2"
                }
              >
                <Text size="sm" tone={active ? "accent" : "muted"}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <ScrollView contentContainerStyle={{ gap: 12, paddingVertical: 12 }}>
          <Input
            label="Name"
            value={name}
            onChangeText={setName}
            maxLength={80}
            placeholder={kind === "text" ? "e.g. product-launch" : "e.g. Standup"}
          />
          {kind !== "voice" && (
            <Input
              label="Topic (optional)"
              value={topic}
              onChangeText={setTopic}
              maxLength={160}
              placeholder="What is this channel about?"
            />
          )}

          {categories.length > 0 && (
            <View className="gap-1.5">
              <Text size="sm">Category</Text>
              <View className="flex-row flex-wrap gap-2">
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: categoryId === undefined }}
                  onPress={() => {
                    setCategoryId(undefined);
                  }}
                  className={
                    categoryId === undefined
                      ? "rounded-pill border border-accent bg-accent-soft px-3 py-1"
                      : "rounded-pill border border-border bg-surface-3 px-3 py-1"
                  }
                >
                  <Text size="xs" tone={categoryId === undefined ? "accent" : "default"}>
                    None
                  </Text>
                </Pressable>
                {categories.map((category) => {
                  const active = category.id === categoryId;
                  return (
                    <Pressable
                      key={category.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => {
                        setCategoryId(category.id);
                      }}
                      className={
                        active
                          ? "rounded-pill border border-accent bg-accent-soft px-3 py-1"
                          : "rounded-pill border border-border bg-surface-3 px-3 py-1"
                      }
                    >
                      <Text size="xs" tone={active ? "accent" : "default"}>
                        {category.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          <View className="flex-row items-center justify-between rounded-input border border-border bg-surface-2 px-3 py-2">
            <Text size="sm">Private channel</Text>
            <Switch
              value={isPrivate}
              onValueChange={setIsPrivate}
              trackColor={{ false: palette.border, true: palette.accent }}
              thumbColor={palette["on-accent"]}
              accessibilityLabel="Private channel"
            />
          </View>

          {error !== null && (
            <Text size="sm" tone="danger" accessibilityRole="alert">
              {error}
            </Text>
          )}

          <View>
            <Button
              disabled={disabled}
              loading={busy}
              onPress={() => {
                const topicValue = topic.trim();
                void Promise.resolve(
                  onCreateChannel({
                    kind,
                    name: trimmed,
                    ...(topicValue.length > 0 ? { topic: topicValue } : {}),
                    ...(categoryId !== undefined ? { categoryId } : {}),
                    private: isPrivate,
                  }),
                ).then(reset);
              }}
            >
              Create
            </Button>
          </View>

          <View className="mt-2 border-t border-border pt-3">
            <Text size="sm" tone="muted" className="pb-2">
              Or use the name above for a new category
            </Text>
            <Button
              variant="secondary"
              disabled={disabled}
              onPress={() => {
                void Promise.resolve(onCreateCategory(trimmed)).then(reset);
              }}
            >
              {`Create category “${trimmed.length > 0 ? trimmed : "…"}”`}
            </Button>
          </View>
        </ScrollView>
      </View>
    </Sheet>
  );
}
