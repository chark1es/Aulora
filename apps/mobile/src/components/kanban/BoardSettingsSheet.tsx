import type { KanbanBoardContent } from "@aulora/core";
import { Button, Icon, Input, Text, usePalette } from "@aulora/ui-native";
import { useMutation } from "convex/react";
import { type ReactNode, useState } from "react";
import { Alert, Pressable, ScrollView, Switch, TextInput, View } from "react-native";
import Animated, { FadeInDown, FadeOut, LinearTransition } from "react-native-reanimated";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import type { Id } from "../../../../../packages/convex/convex/_generated/dataModel";
import { type Board, type BoardMember, failure, newItemId } from "../../lib/kanban";
import { MemberAvatar } from "../chat/MemberAvatar";
import { Sheet } from "../chat/Sheet";
import { AvatarStack } from "./parts";
import { BottomSheet, PickerSheet, useSheetClose } from "./sheets";

const LABEL_COLORS = [
  "#E5484D",
  "#E4571C",
  "#E8A33B",
  "#46A758",
  "#12A594",
  "#3E63DD",
  "#8E4EC6",
  "#D6409F",
  "#8B8D98",
];

function Toggle({
  label,
  description,
  value,
  onChange,
}: {
  readonly label: string;
  readonly description: string;
  readonly value: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  const palette = usePalette();
  return (
    <View className="flex-row items-center gap-3">
      <View className="min-w-0 flex-1">
        <Text className="font-medium">{label}</Text>
        <Text size="xs" tone="muted">
          {description}
        </Text>
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: palette.accent, false: palette["surface-3"] }}
      />
    </View>
  );
}

function Group({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="font-semibold" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

function RowButton({
  label,
  icon,
  disabled = false,
  danger = false,
  onPress,
}: {
  readonly label: string;
  readonly icon: "arrow-up" | "arrow-down" | "trash";
  readonly disabled?: boolean;
  readonly danger?: boolean;
  readonly onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      className={`h-10 w-9 items-center justify-center rounded-input active:bg-surface-3 ${
        disabled ? "opacity-30" : ""
      }`}
    >
      <Icon name={icon} size={18} color={danger ? palette.danger : palette["text-muted"]} />
    </Pressable>
  );
}

const cell = "min-h-11 rounded-input border border-border bg-surface-3 px-3 text-[16px] text-text";

export function NewBoardSheet({
  ownUserId,
  onCreated,
  onClose,
}: {
  readonly ownUserId: string;
  readonly onCreated: (boardId: Id<"kanbanBoards">) => void;
  readonly onClose: () => void;
}) {
  const create = useMutation(api.kanban.createBoard);
  const [name, setName] = useState("");
  const [isPrivate, setPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    create({ name, private: isPrivate, memberIds: [ownUserId] })
      .then((id) => {
        onCreated(id);
        onClose();
      })
      .catch((cause: unknown) => setError(failure(cause)))
      .finally(() => setBusy(false));
  };
  return (
    <Sheet visible title="New board" onClose={onClose} closeLabel="Cancel">
      <View className="gap-5 p-4">
        <Input
          label="Board name"
          placeholder="e.g. Website launch"
          autoFocus
          maxLength={120}
          returnKeyType="done"
          value={name}
          onChangeText={setName}
          onSubmitEditing={submit}
        />
        <Toggle
          label="Private board"
          description="Only you and board managers have access at first. Add members in Board settings."
          value={isPrivate}
          onChange={setPrivate}
        />
        {error !== null && (
          <Text size="sm" tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        )}
        <Button loading={busy} disabled={!name.trim()} onPress={submit}>
          Create board
        </Button>
      </View>
    </Sheet>
  );
}

export function BoardSettingsSheet({
  board,
  members,
  onClose,
}: {
  readonly board: Board;
  readonly members: readonly BoardMember[];
  readonly onClose: () => void;
}) {
  const update = useMutation(api.kanban.updateBoard);
  const original = {
    name: board.name,
    description: board.description,
    columns: board.columns,
    labels: board.labels,
  };
  const [draft, setDraft] = useState<KanbanBoardContent>(original);
  const [isPrivate, setPrivate] = useState(board.private);
  const [memberIds, setMemberIds] = useState<readonly string[]>(board.memberIds);
  const [picker, setPicker] = useState<"members" | { color: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(original) ||
    isPrivate !== board.private ||
    JSON.stringify(memberIds) !== JSON.stringify(board.memberIds);
  const close = () => {
    if (busy) return;
    if (!dirty) return onClose();
    Alert.alert("Discard unsaved board settings?", undefined, [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: onClose },
    ]);
  };
  const save = () => {
    setBusy(true);
    setError(null);
    update({
      boardId: board.id,
      expectedUpdatedAt: board.updatedAt,
      ...draft,
      private: isPrivate,
      memberIds: [...memberIds],
    })
      .then(onClose)
      .catch((cause: unknown) => setError(failure(cause)))
      .finally(() => setBusy(false));
  };
  const setColumn = (
    id: string,
    change: (column: Board["columns"][number]) => Board["columns"][number],
  ) =>
    setDraft({
      ...draft,
      columns: draft.columns.map((column) => (column.id === id ? change(column) : column)),
    });
  const swap = (index: number, other: number) => {
    const columns = [...draft.columns];
    const a = columns[index];
    const b = columns[other];
    if (!a || !b) return;
    columns[index] = b;
    columns[other] = a;
    setDraft({ ...draft, columns });
  };
  return (
    <Sheet
      visible
      title="Board settings"
      onClose={close}
      swipeToClose={!dirty}
      closeLabel={dirty ? "Cancel" : "Done"}
      footer={
        <View className="gap-2 border-t border-border bg-surface-1 px-4 py-3">
          {error !== null && (
            <Text size="sm" tone="danger" accessibilityRole="alert">
              {error}
            </Text>
          )}
          <Button loading={busy} disabled={!dirty || !draft.name.trim()} onPress={save}>
            Save board
          </Button>
        </View>
      }
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 24 }}
      >
        <Input
          label="Board name"
          maxLength={120}
          value={draft.name}
          onChangeText={(name) => setDraft({ ...draft, name })}
        />
        <Input
          label="Description"
          multiline
          maxLength={5000}
          textAlignVertical="top"
          className="min-h-[88px]"
          value={draft.description}
          onChangeText={(description) => setDraft({ ...draft, description })}
        />
        <View className="gap-3">
          <Toggle
            label="Private board"
            description="Only selected members and board managers can access it."
            value={isPrivate}
            onChange={setPrivate}
          />
          {isPrivate && (
            <Animated.View entering={FadeInDown.duration(180)}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Board members"
                className="min-h-12 flex-row items-center gap-3 rounded-input bg-surface-2 px-3 active:bg-surface-3"
                onPress={() => setPicker("members")}
              >
                <AvatarStack userIds={memberIds} members={members} max={5} ring="surface-2" />
                <Text size="sm" className="flex-1" tone={memberIds.length ? "default" : "muted"}>
                  {memberIds.length === 0
                    ? "Add members"
                    : memberIds.length === 1
                      ? "1 member"
                      : `${memberIds.length} members`}
                </Text>
                <Text size="sm" tone="accent">
                  Edit
                </Text>
              </Pressable>
            </Animated.View>
          )}
        </View>

        <Group title="Columns and limits">
          <Text size="xs" tone="muted">
            A limit caps how many active cards a column takes. Move every card out of a column
            before removing it.
          </Text>
          {draft.columns.map((column, index) => (
            <Animated.View
              key={column.id}
              entering={FadeInDown.duration(180)}
              exiting={FadeOut.duration(120)}
              layout={LinearTransition.duration(220)}
              className="flex-row items-center gap-1.5"
            >
              <TextInput
                accessibilityLabel={`Column ${index + 1} name`}
                maxLength={80}
                value={column.name}
                onChangeText={(name) => setColumn(column.id, (entry) => ({ ...entry, name }))}
                className={`flex-1 ${cell}`}
              />
              <TextInput
                accessibilityLabel={`Limit for ${column.name}`}
                keyboardType="number-pad"
                placeholder="Limit"
                maxLength={3}
                value={column.wipLimit === undefined ? "" : String(column.wipLimit)}
                onChangeText={(text) => {
                  const limit = Number(text.replace(/\D/g, ""));
                  setColumn(column.id, (entry) => ({
                    id: entry.id,
                    name: entry.name,
                    ...(limit > 0 ? { wipLimit: Math.min(limit, 500) } : {}),
                  }));
                }}
                className={`w-[68px] text-center ${cell}`}
              />
              <RowButton
                label={`Move ${column.name} column up`}
                icon="arrow-up"
                disabled={index === 0}
                onPress={() => swap(index, index - 1)}
              />
              <RowButton
                label={`Move ${column.name} column down`}
                icon="arrow-down"
                disabled={index === draft.columns.length - 1}
                onPress={() => swap(index, index + 1)}
              />
              <RowButton
                label={`Remove ${column.name} column`}
                icon="trash"
                danger
                disabled={draft.columns.length === 1}
                onPress={() =>
                  setDraft({
                    ...draft,
                    columns: draft.columns.filter((entry) => entry.id !== column.id),
                  })
                }
              />
            </Animated.View>
          ))}
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            disabled={draft.columns.length >= 20}
            onPress={() =>
              setDraft({
                ...draft,
                columns: [...draft.columns, { id: newItemId(), name: "New column" }],
              })
            }
          >
            Add column
          </Button>
        </Group>

        <Group title="Labels">
          {draft.labels.map((label) => (
            <Animated.View
              key={label.id}
              entering={FadeInDown.duration(180)}
              exiting={FadeOut.duration(120)}
              layout={LinearTransition.duration(220)}
              className="flex-row items-center gap-1.5"
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Color for ${label.name}`}
                className="h-11 w-11 items-center justify-center rounded-input border border-border bg-surface-3 active:opacity-70"
                onPress={() => setPicker({ color: label.id })}
              >
                <View className="h-5 w-5 rounded-pill" style={{ backgroundColor: label.color }} />
              </Pressable>
              <TextInput
                accessibilityLabel="Label name"
                maxLength={50}
                value={label.name}
                onChangeText={(name) =>
                  setDraft({
                    ...draft,
                    labels: draft.labels.map((entry) =>
                      entry.id === label.id ? { ...entry, name } : entry,
                    ),
                  })
                }
                className={`flex-1 ${cell}`}
              />
              <RowButton
                label={`Remove ${label.name} label`}
                icon="trash"
                danger
                onPress={() =>
                  setDraft({
                    ...draft,
                    labels: draft.labels.filter((entry) => entry.id !== label.id),
                  })
                }
              />
            </Animated.View>
          ))}
          {draft.labels.length === 0 && (
            <Text size="sm" tone="muted">
              No labels yet.
            </Text>
          )}
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            disabled={draft.labels.length >= 50}
            onPress={() =>
              setDraft({
                ...draft,
                labels: [
                  ...draft.labels,
                  {
                    id: newItemId(),
                    name: "New label",
                    color: LABEL_COLORS[draft.labels.length % LABEL_COLORS.length] ?? "#E4571C",
                  },
                ],
              })
            }
          >
            Add label
          </Button>
        </Group>
      </ScrollView>

      {picker === "members" && (
        <PickerSheet
          multiple
          title="Board members"
          searchPlaceholder="Find a person"
          options={[
            ...memberIds
              .filter((id) => !members.some((member) => member.userId === id))
              .map((id) => ({ userId: id, displayName: "Former member" })),
            ...members,
          ].map((member) => ({
            id: member.userId,
            label: member.displayName,
            leading: <MemberAvatar userId={member.userId} size={28} />,
          }))}
          selected={memberIds}
          onChange={setMemberIds}
          onClose={() => setPicker(null)}
        />
      )}
      {typeof picker === "object" && picker !== null && (
        <BottomSheet title="Label color" onClose={() => setPicker(null)}>
          <View className="flex-row flex-wrap gap-3 px-5 pb-3">
            {LABEL_COLORS.map((color) => (
              <ColorSwatch
                key={color}
                color={color}
                selected={
                  draft.labels.find((label) => label.id === picker.color)?.color.toLowerCase() ===
                  color.toLowerCase()
                }
                onPress={() =>
                  setDraft({
                    ...draft,
                    labels: draft.labels.map((label) =>
                      label.id === picker.color ? { ...label, color } : label,
                    ),
                  })
                }
              />
            ))}
          </View>
        </BottomSheet>
      )}
    </Sheet>
  );
}

function ColorSwatch({
  color,
  selected,
  onPress,
}: {
  readonly color: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const palette = usePalette();
  const close = useSheetClose();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`Color ${color}`}
      accessibilityState={{ checked: selected }}
      className="h-12 w-12 items-center justify-center rounded-pill active:opacity-70"
      style={{ backgroundColor: color }}
      onPress={() => close(onPress)}
    >
      {selected && <Icon name="check" size={22} color={palette["on-accent"]} />}
    </Pressable>
  );
}
