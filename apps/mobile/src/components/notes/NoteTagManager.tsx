import { Button, Icon, IconButton, Input, Text, usePalette } from "@aulora/ui-native";
import { type Dispatch, type SetStateAction, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { confirm } from "../kanban/board-menus";
import { BottomSheet } from "../kanban/sheets";
import type { NotesController, NoteTagView } from "./use-notes";

const TAG_COLORS = [
  "#E5484D",
  "#E4571C",
  "#E8A33B",
  "#46A758",
  "#12A594",
  "#3E63DD",
  "#8E4EC6",
  "#D6409F",
  "#8B8D98",
] as const;

type TagDraft = { readonly id: string | undefined; readonly name: string; readonly color: string };
type SetTagDraft = Dispatch<SetStateAction<TagDraft | undefined>>;

function useTagSave(
  ctl: NotesController,
  form: TagDraft | undefined,
  setForm: SetTagDraft,
  busy: boolean,
  setBusy: Dispatch<SetStateAction<boolean>>,
) {
  const save = () => {
    if (!form?.name.trim() || busy) return;
    setBusy(true);
    const work =
      form.id === undefined
        ? () => ctl.mutations.createTag({ name: form.name, color: form.color })
        : () =>
            ctl.mutations.updateTag({
              tagId: form.id as never,
              name: form.name,
              color: form.color,
            });
    void ctl.run(work).then((saved) => {
      setBusy(false);
      if (saved) setForm(undefined);
    });
  };
  return save;
}

function DeleteTagButton({
  ctl,
  tag,
}: {
  readonly ctl: NotesController;
  readonly tag: NoteTagView;
}) {
  const palette = usePalette();
  return (
    <IconButton
      label={`Delete ${tag.name}`}
      size="sm"
      onPress={() => {
        confirm(
          "Delete tag?",
          "The tag is removed from every note. The notes themselves are kept.",
          "Delete tag",
          () => {
            void ctl.run(() => ctl.mutations.deleteTag({ tagId: tag.id as never }));
          },
        );
      }}
    >
      <Icon name="trash" size={18} color={palette.danger} />
    </IconButton>
  );
}

function TagRow({
  ctl,
  tag,
  setForm,
}: {
  readonly ctl: NotesController;
  readonly tag: NoteTagView;
  readonly setForm: SetTagDraft;
}) {
  const palette = usePalette();
  return (
    <View className="min-h-12 flex-row items-center gap-3 px-4 py-1">
      <View className="h-4 w-4 rounded-pill" style={{ backgroundColor: tag.color }} />
      <Text className="min-w-0 flex-1" numberOfLines={1}>
        {tag.name}
      </Text>
      {ctl.permissions.edit && (
        <IconButton
          label={`Rename ${tag.name}`}
          size="sm"
          onPress={() => {
            setForm({ id: tag.id, name: tag.name, color: tag.color });
          }}
        >
          <Icon name="pencil" size={18} color={palette["text-muted"]} />
        </IconButton>
      )}
      {ctl.permissions.remove && <DeleteTagButton ctl={ctl} tag={tag} />}
    </View>
  );
}

function TagColorPicker({
  form,
  setForm,
}: {
  readonly form: TagDraft;
  readonly setForm: SetTagDraft;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {TAG_COLORS.map((color) => (
        <ColorSwatch
          key={color}
          color={color}
          selected={form.color.toLowerCase() === color.toLowerCase()}
          onPick={() => {
            setForm({ ...form, color });
          }}
        />
      ))}
    </View>
  );
}

function TagForm({
  form,
  setForm,
  busy,
  save,
}: {
  readonly form: TagDraft;
  readonly setForm: SetTagDraft;
  readonly busy: boolean;
  readonly save: () => void;
}) {
  return (
    <View className="gap-3 px-4 py-3">
      <Input
        label={form.id === undefined ? "New tag name" : "Tag name"}
        autoFocus
        maxLength={32}
        returnKeyType="done"
        value={form.name}
        onChangeText={(name) => {
          setForm({ ...form, name });
        }}
        onSubmitEditing={save}
      />
      <TagColorPicker form={form} setForm={setForm} />
      <View className="flex-row gap-2">
        <Button loading={busy} disabled={!form.name.trim()} onPress={save}>
          {form.id === undefined ? "Create tag" : "Save tag"}
        </Button>
        <Button
          variant="ghost"
          onPress={() => {
            setForm(undefined);
          }}
        >
          Cancel
        </Button>
      </View>
    </View>
  );
}

function ColorSwatch({
  color,
  selected,
  onPick,
}: {
  readonly color: string;
  readonly selected: boolean;
  readonly onPick: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`Color ${color}`}
      accessibilityState={{ checked: selected }}
      className="h-10 w-10 items-center justify-center rounded-pill active:opacity-70"
      style={{ backgroundColor: color }}
      onPress={onPick}
    >
      {selected && <Icon name="check" size={20} color={palette["on-accent"]} />}
    </Pressable>
  );
}

export function TagManager({
  ctl,
  onClose,
}: {
  readonly ctl: NotesController;
  readonly onClose: () => void;
}) {
  const [form, setForm] = useState<TagDraft | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const save = useTagSave(ctl, form, setForm, busy, setBusy);
  return (
    <BottomSheet title="Tags" onClose={onClose}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 12 }}>
        {ctl.tags.length === 0 && form === undefined && (
          <Text size="sm" tone="muted" className="px-4 py-4">
            No tags yet.
          </Text>
        )}
        {ctl.tags.map((tag) => (
          <TagRow key={tag.id} ctl={ctl} tag={tag} setForm={setForm} />
        ))}
        {form !== undefined && <TagForm form={form} setForm={setForm} busy={busy} save={save} />}
        {form === undefined && ctl.permissions.edit && (
          <View className="px-4 py-3">
            <Button
              variant="secondary"
              className="self-start"
              onPress={() => {
                setForm({ id: undefined, name: "", color: TAG_COLORS[0] });
              }}
            >
              Add tag
            </Button>
          </View>
        )}
      </ScrollView>
    </BottomSheet>
  );
}
