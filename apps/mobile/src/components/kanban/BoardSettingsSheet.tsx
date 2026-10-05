/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { KanbanBoardContent } from "@aulora/core";
import { Button, Input, Text } from "@aulora/ui-native";
import { useMutation } from "convex/react";
import { useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { type Board, type BoardMember, failure } from "../../lib/kanban";
import { MemberAvatar } from "../chat/MemberAvatar";
import { Sheet } from "../chat/Sheet";
import { ColumnsEditor, LabelsEditor } from "./BoardListEditors";
import { PickerSheet } from "./PickerSheet";
import { AvatarStack } from "./parts";
import { Toggle } from "./settings-parts";

function contentOf(board: Board): KanbanBoardContent {
  return {
    name: board.name,
    description: board.description,
    columns: board.columns,
    labels: board.labels,
  };
}

/** The board's settings as edited, and whether they differ from what is saved. */
function useSettingsDraft(board: Board) {
  const [draft, setDraft] = useState<KanbanBoardContent>(() => contentOf(board));
  const [isPrivate, setPrivate] = useState(board.private);
  const [memberIds, setMemberIds] = useState<readonly string[]>(board.memberIds);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(contentOf(board)) ||
    isPrivate !== board.private ||
    JSON.stringify(memberIds) !== JSON.stringify(board.memberIds);
  return { draft, setDraft, isPrivate, setPrivate, memberIds, setMemberIds, dirty };
}

function membersLabel(count: number): string {
  if (count === 0) return "Add members";
  return count === 1 ? "1 member" : `${count} members`;
}

interface MembersRowProps {
  readonly memberIds: readonly string[];
  readonly members: readonly BoardMember[];
  readonly onChange: (memberIds: string[]) => void;
}

/** Who may open a private board, with a checklist to change it. */
function MembersRow({ memberIds, members, onChange }: MembersRowProps) {
  const [picking, setPicking] = useState(false);
  const former = memberIds
    .filter((id) => !members.some((member) => member.userId === id))
    .map((id) => ({ userId: id, displayName: "Former member" }));
  return (
    <Animated.View entering={FadeInDown.duration(180)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Board members"
        className="min-h-12 flex-row items-center gap-3 rounded-input bg-surface-2 px-3 active:bg-surface-3"
        onPress={() => {
          setPicking(true);
        }}
      >
        <AvatarStack userIds={memberIds} members={members} max={5} ring="surface-2" />
        <Text size="sm" className="flex-1" tone={memberIds.length > 0 ? "default" : "muted"}>
          {membersLabel(memberIds.length)}
        </Text>
        <Text size="sm" tone="accent">
          Edit
        </Text>
      </Pressable>
      {picking && (
        <PickerSheet
          multiple
          title="Board members"
          searchPlaceholder="Find a person"
          options={[...former, ...members].map((member) => ({
            id: member.userId,
            label: member.displayName,
            leading: <MemberAvatar userId={member.userId} size={28} />,
          }))}
          selected={memberIds}
          onChange={onChange}
          onClose={() => {
            setPicking(false);
          }}
        />
      )}
    </Animated.View>
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
  const settings = useSettingsDraft(board);
  const { draft, setDraft, dirty } = settings;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const close = () => {
    if (busy) return;
    if (!dirty) {
      onClose();
      return;
    }
    Alert.alert("Discard unsaved board settings?", undefined, [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: onClose },
    ]);
  };
  const save = () => {
    setBusy(true);
    setError(undefined);
    update({
      boardId: board.id,
      expectedUpdatedAt: board.updatedAt,
      ...draft,
      private: settings.isPrivate,
      memberIds: [...settings.memberIds],
    })
      .then(onClose)
      .catch((cause: unknown) => {
        setError(failure(cause));
      })
      .finally(() => {
        setBusy(false);
      });
  };
  return (
    <Sheet
      visible
      title="Board settings"
      onClose={close}
      swipeToClose={!dirty}
      dismiss={dirty ? "cancel" : "done"}
      footer={
        <View className="gap-2 border-t border-border bg-surface-1 px-4 py-3">
          {error !== undefined && (
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
          onChangeText={(name) => {
            setDraft({ ...draft, name });
          }}
        />
        <Input
          label="Description"
          multiline
          maxLength={5000}
          textAlignVertical="top"
          className="min-h-[88px]"
          value={draft.description}
          onChangeText={(description) => {
            setDraft({ ...draft, description });
          }}
        />
        <View className="gap-3">
          <Toggle
            label="Private board"
            description="Only selected members and board managers can access it."
            value={settings.isPrivate}
            onChange={settings.setPrivate}
          />
          {settings.isPrivate && (
            <MembersRow
              memberIds={settings.memberIds}
              members={members}
              onChange={settings.setMemberIds}
            />
          )}
        </View>
        <ColumnsEditor draft={draft} onChange={setDraft} />
        <LabelsEditor draft={draft} onChange={setDraft} />
      </ScrollView>
    </Sheet>
  );
}
