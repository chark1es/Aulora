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
  readonly onCreateChannel: (_input: {
    readonly kind: NewChannelKind;
    readonly name: string;
    readonly topic?: string;
    readonly categoryId?: string;
    readonly private: boolean;
  }) => void | Promise<void>;
  readonly onCreateCategory: (_name: string) => void | Promise<void>;
  readonly onClose: () => void;
}

function KindPicker({
  kind,
  onChange,
}: {
  readonly kind: NewChannelKind;
  readonly onChange: (_kind: NewChannelKind) => void;
}) {
  return (
    <View className="mt-3 flex-row gap-2">
      {KIND_OPTIONS.map((option) => {
        const active = option.value === kind;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => {
              onChange(option.value);
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
  );
}

function ChannelFields({
  kind,
  name,
  onNameChange,
  topic,
  onTopicChange,
}: {
  readonly kind: NewChannelKind;
  readonly name: string;
  readonly onNameChange: (_name: string) => void;
  readonly topic: string;
  readonly onTopicChange: (_topic: string) => void;
}) {
  return (
    <>
      <Input
        label="Name"
        value={name}
        onChangeText={onNameChange}
        maxLength={80}
        placeholder={kind === "text" ? "e.g. product-launch" : "e.g. Standup"}
      />
      {kind !== "voice" && (
        <Input
          label="Topic (optional)"
          value={topic}
          onChangeText={onTopicChange}
          maxLength={160}
          placeholder="What is this channel about?"
        />
      )}
    </>
  );
}

function CategoryPicker({
  categories,
  categoryId,
  onChange,
}: {
  readonly categories: readonly { readonly id: string; readonly name: string }[];
  readonly categoryId: string | undefined;
  readonly onChange: (_categoryId: string | undefined) => void;
}) {
  if (categories.length === 0) {
    return null;
  }
  return (
    <View className="gap-1.5">
      <Text size="sm">Category</Text>
      <View className="flex-row flex-wrap gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: categoryId === undefined }}
          onPress={() => {
            onChange(undefined);
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
                onChange(category.id);
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
  );
}

function PrivateToggle({
  value,
  onChange,
}: {
  readonly value: boolean;
  readonly onChange: (_value: boolean) => void;
}) {
  const palette = usePalette();
  return (
    <View className="flex-row items-center justify-between rounded-input border border-border bg-surface-2 px-3 py-2">
      <Text size="sm">Private channel</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: palette.border, true: palette.accent }}
        thumbColor={palette["on-accent"]}
        accessibilityLabel="Private channel"
      />
    </View>
  );
}

function ChannelFormActions(props: {
  readonly kind: NewChannelKind;
  readonly trimmed: string;
  readonly topic: string;
  readonly categoryId: string | undefined;
  readonly isPrivate: boolean;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly error: string | null;
  readonly onCreateChannel: CreateChannelSheetProps["onCreateChannel"];
  readonly onCreateCategory: CreateChannelSheetProps["onCreateCategory"];
  readonly onReset: () => void;
}) {
  const {
    kind,
    trimmed,
    topic,
    categoryId,
    isPrivate,
    busy,
    disabled,
    error,
    onCreateChannel,
    onCreateCategory,
    onReset,
  } = props;
  return (
    <>
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
            ).then(onReset);
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
            void Promise.resolve(onCreateCategory(trimmed)).then(onReset);
          }}
        >
          {`Create category “${trimmed.length > 0 ? trimmed : "…"}”`}
        </Button>
      </View>
    </>
  );
}

function ChannelFormBody({
  form,
  categories,
  busy,
  error,
  onCreateChannel,
  onCreateCategory,
}: {
  readonly form: ReturnType<typeof useChannelForm>;
  readonly categories: readonly { readonly id: string; readonly name: string }[];
  readonly busy: boolean;
  readonly error: string | null;
  readonly onCreateChannel: CreateChannelSheetProps["onCreateChannel"];
  readonly onCreateCategory: CreateChannelSheetProps["onCreateCategory"];
}) {
  const trimmed = form.name.trim();
  const disabled = trimmed.length === 0 || busy;
  return (
    <ScrollView contentContainerStyle={{ gap: 12, paddingVertical: 12 }}>
      <ChannelFields
        kind={form.kind}
        name={form.name}
        onNameChange={form.setName}
        topic={form.topic}
        onTopicChange={form.setTopic}
      />
      <CategoryPicker
        categories={categories}
        categoryId={form.categoryId}
        onChange={form.setCategoryId}
      />
      <PrivateToggle value={form.isPrivate} onChange={form.setIsPrivate} />
      <ChannelFormActions
        kind={form.kind}
        trimmed={trimmed}
        topic={form.topic}
        categoryId={form.categoryId}
        isPrivate={form.isPrivate}
        busy={busy}
        disabled={disabled}
        error={error}
        onCreateChannel={onCreateChannel}
        onCreateCategory={onCreateCategory}
        onReset={form.reset}
      />
    </ScrollView>
  );
}

function useChannelForm() {
  const [kind, setKind] = useState<NewChannelKind>("text");
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [isPrivate, setIsPrivate] = useState(false);
  function reset() {
    setName("");
    setTopic("");
    setCategoryId(undefined);
    setIsPrivate(false);
    setKind("text");
  }
  return {
    kind,
    setKind,
    name,
    setName,
    topic,
    setTopic,
    categoryId,
    setCategoryId,
    isPrivate,
    setIsPrivate,
    reset,
  };
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
  const form = useChannelForm();

  return (
    <Sheet
      visible={visible}
      title={"Create channel"}
      onClose={() => {
        form.reset();
        onClose();
      }}
    >
      <View className="flex-1 p-4">
        <KindPicker kind={form.kind} onChange={form.setKind} />
        <ChannelFormBody
          form={form}
          categories={categories}
          busy={busy}
          error={error}
          onCreateChannel={onCreateChannel}
          onCreateCategory={onCreateCategory}
        />
      </View>
    </Sheet>
  );
}
