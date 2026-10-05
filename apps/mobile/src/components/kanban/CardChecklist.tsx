import { Button, Icon, Text, usePalette } from "@aulora/ui-native";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import Animated, { FadeInDown, FadeOut, LinearTransition } from "react-native-reanimated";
import { newItemId } from "../../lib/kanban";
import { CheckBox, SectionTitle } from "./parts";
import type { CardDraft, CardEditor } from "./use-card-editor";

interface SectionProps {
  readonly editor: CardEditor;
}

/** The shared look of the sheet's text fields. */
export const field =
  "rounded-input border border-border bg-surface-3 px-3 py-2.5 text-[16px] leading-[22px] text-text";

export function CardNotes({ editor }: SectionProps) {
  const palette = usePalette();
  return (
    <View className="gap-2">
      <SectionTitle icon="note" title="Notes" />
      <TextInput
        accessibilityLabel="Notes"
        editable={editor.canEdit}
        multiline
        scrollEnabled={false}
        textAlignVertical="top"
        maxLength={30000}
        placeholder={editor.canEdit ? "Add details, context or links…" : "No notes"}
        placeholderTextColor={palette["text-muted"]}
        value={editor.draft.notes}
        onChangeText={(notes) => {
          editor.setDraft({ ...editor.draft, notes });
        }}
        className={`min-h-[96px] ${field}`}
      />
    </View>
  );
}

type Item = CardDraft["checklist"][number];

interface ItemRowProps extends SectionProps {
  readonly item: Item;
}

function ItemRow({ editor, item }: ItemRowProps) {
  const palette = usePalette();
  const { draft } = editor;
  const setItems = (checklist: Item[]) => {
    editor.setDraft({ ...draft, checklist });
  };
  return (
    <Animated.View
      entering={FadeInDown.duration(180)}
      exiting={FadeOut.duration(120)}
      layout={LinearTransition.duration(220)}
      className="flex-row items-center"
    >
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.done, disabled: !editor.canEdit }}
        accessibilityLabel={item.text}
        disabled={!editor.canEdit}
        className="min-h-11 flex-1 flex-row items-center gap-3 py-1.5 active:opacity-70"
        onPress={() => {
          setItems(
            draft.checklist.map((entry) =>
              entry.id === item.id ? { ...entry, done: !entry.done } : entry,
            ),
          );
        }}
      >
        <CheckBox checked={item.done} />
        <Text
          size="sm"
          tone={item.done ? "muted" : "default"}
          className={`flex-1 ${item.done ? "line-through" : ""}`}
        >
          {item.text}
        </Text>
      </Pressable>
      {editor.canEdit && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove checklist item ${item.text}`}
          hitSlop={6}
          className="h-9 w-9 items-center justify-center rounded-input active:bg-surface-3"
          onPress={() => {
            setItems(draft.checklist.filter((entry) => entry.id !== item.id));
          }}
        >
          <Icon name="x" size={16} color={palette["text-muted"]} />
        </Pressable>
      )}
    </Animated.View>
  );
}

function AddItem({ editor }: SectionProps) {
  const palette = usePalette();
  const [text, setText] = useState("");
  const { draft } = editor;
  const add = () => {
    if (!text.trim() || draft.checklist.length >= 100) return;
    const item = { id: newItemId(), text: text.trim(), done: false };
    editor.setDraft({ ...draft, checklist: [...draft.checklist, item] });
    setText("");
  };
  return (
    <View className="flex-row gap-2">
      <TextInput
        accessibilityLabel="New checklist item"
        placeholder="Add an item"
        placeholderTextColor={palette["text-muted"]}
        maxLength={500}
        returnKeyType="done"
        submitBehavior="submit"
        value={text}
        onChangeText={setText}
        onSubmitEditing={add}
        className={`flex-1 ${field}`}
      />
      <Button
        variant="secondary"
        disabled={!text.trim() || draft.checklist.length >= 100}
        onPress={add}
      >
        Add
      </Button>
    </View>
  );
}

function Progress({ done, total }: { readonly done: number; readonly total: number }) {
  const palette = usePalette();
  return (
    <View className="h-1.5 overflow-hidden rounded-pill bg-surface-3">
      <Animated.View
        layout={LinearTransition.duration(260)}
        className="h-full rounded-pill"
        style={{
          width: `${(done / total) * 100}%`,
          backgroundColor: done === total ? palette.secondary : palette.accent,
        }}
      />
    </View>
  );
}

export function CardChecklist({ editor }: SectionProps) {
  const items = editor.draft.checklist;
  const done = items.filter((item) => item.done).length;
  return (
    <View className="gap-2">
      <SectionTitle
        icon="checklist"
        title="Checklist"
        aside={
          items.length > 0 && (
            <Text size="xs" tone="muted" style={{ fontVariant: ["tabular-nums"] }}>
              {done} of {items.length} done
            </Text>
          )
        }
      />
      {items.length > 0 && <Progress done={done} total={items.length} />}
      {items.map((item) => (
        <ItemRow key={item.id} editor={editor} item={item} />
      ))}
      {items.length === 0 && !editor.canEdit && (
        <Text size="sm" tone="muted">
          No checklist items.
        </Text>
      )}
      {editor.canEdit && <AddItem editor={editor} />}
    </View>
  );
}
