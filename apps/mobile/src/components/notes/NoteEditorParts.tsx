import { Icon, Text, TextField, usePalette } from "@aulora/ui-native";
import { Pressable, View } from "react-native";
import { tagsForIds } from "../../lib/notes";
import { PickerSheet } from "../kanban/PickerSheet";
import { PropertyRow } from "../kanban/parts";
import { NOTE_FORMATS } from "./editor-toolbar";
import { NoteTagChip } from "./NoteParts";
import { NotePreview } from "./NotePreview";
import type { NoteEditorController } from "./use-note-editor";
import type { NotesController } from "./use-notes";

const NO_FOLDER = "__unfiled__";
type EditorProps = {
  readonly ctl: NotesController;
  readonly editor: NoteEditorController;
  /** Reading an existing note hides the property pickers until Edit is pressed. */
  readonly editable?: boolean;
};

function Segment({
  label,
  active,
  onPress,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      hitSlop={{ top: 4, bottom: 4 }}
      onPress={onPress}
      className={`min-h-9 flex-1 items-center justify-center rounded-[7px] ${
        active ? "bg-surface-3" : ""
      }`}
    >
      <Text
        size="sm"
        className="font-medium"
        style={{ color: active ? palette.text : palette["text-muted"] }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function NoteTitleInput({ editor }: { readonly editor: NoteEditorController }) {
  const palette = usePalette();
  const { title, setTitle } = editor;
  return (
    <TextField
      accessibilityLabel="Note title"
      placeholder="Title"
      placeholderTextColor={palette["text-muted"]}
      value={title}
      onChangeText={setTitle}
      maxLength={200}
      className="mx-4 mb-2 min-h-12 rounded-input border border-border bg-surface-1 px-3 text-[20px] font-semibold text-text"
    />
  );
}

function NoteEditorMode({ editor }: { readonly editor: NoteEditorController }) {
  const { preview, setPreview } = editor;
  return (
    <View className="mx-4 mb-2 flex-row rounded-input border border-border bg-surface-2 p-0.5">
      <Segment
        label="Write"
        active={!preview}
        onPress={() => {
          setPreview(false);
        }}
      />
      <Segment
        label="Preview"
        active={preview}
        onPress={() => {
          setPreview(true);
        }}
      />
    </View>
  );
}

/** One round icon button in the formatting toolbar. */
function ToolButton({
  label,
  icon,
  disabled,
  onPress,
}: {
  readonly label: string;
  readonly icon: Parameters<typeof Icon>[0]["name"];
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-11 min-w-11 items-center justify-center rounded-[9px] ${
        disabled ? "opacity-40" : "active:bg-surface-3"
      }`}
    >
      <Icon name={icon} size={20} color={disabled ? palette["text-muted"] : palette.text} />
    </Pressable>
  );
}

/** The Markdown formatting bar, shown above the body field while writing. */
function NoteFormatBar({ editor }: { readonly editor: NoteEditorController }) {
  const { canUndo, canRedo, format, undo, redo } = editor;
  return (
    <View className="mx-4 mb-2 flex-row flex-wrap items-center rounded-input border border-border bg-surface-2 p-0.5">
      <ToolButton label="Undo" icon="undo" disabled={!canUndo} onPress={undo} />
      <ToolButton label="Redo" icon="redo" disabled={!canRedo} onPress={redo} />
      <View className="mx-0.5 h-5 w-px bg-border" />
      {NOTE_FORMATS.map((spec) => (
        <ToolButton
          key={spec.id}
          label={spec.label}
          icon={spec.icon}
          disabled={false}
          onPress={() => {
            format(spec.id);
          }}
        />
      ))}
    </View>
  );
}

export function NoteBodyInput({ editor }: { readonly editor: NoteEditorController }) {
  const palette = usePalette();
  const { body, setBody, preview, selection, setSelection } = editor;
  return (
    <>
      <NoteEditorMode editor={editor} />
      {preview ? (
        <View className="mx-4 rounded-input border border-border bg-surface-1 p-3">
          <NotePreview body={body} />
        </View>
      ) : (
        <>
          <NoteFormatBar editor={editor} />
          <TextField
            accessibilityLabel="Note body"
            placeholder="Write in Markdown…"
            placeholderTextColor={palette["text-muted"]}
            value={body}
            onChangeText={setBody}
            onSelectionChange={(event) => {
              setSelection(event.nativeEvent.selection);
            }}
            selection={selection}
            multiline
            textAlignVertical="top"
            className="mx-4 min-h-[220px] rounded-input border border-border bg-surface-1 p-3 text-[16px] text-text"
            style={{ lineHeight: 22 }}
          />
        </>
      )}
    </>
  );
}

function NoteTagProperty({ ctl, editor, editable = true }: EditorProps) {
  const { tagIds, setSheet } = editor;
  const canEdit = ctl.permissions.edit && editable;
  const selectedTags = tagsForIds(ctl.tags, tagIds);
  return (
    <PropertyRow
      icon="label"
      label="Tags"
      last
      {...(canEdit
        ? {
            onPress: () => {
              setSheet("tags");
            },
          }
        : {})}
    >
      {selectedTags.length === 0 ? (
        <Text size="sm" tone="muted">
          None
        </Text>
      ) : (
        selectedTags.slice(0, 2).map((tag) => <NoteTagChip key={tag.id} tag={tag} />)
      )}
    </PropertyRow>
  );
}

export function NoteProperties({ ctl, editor, editable = true }: EditorProps) {
  const { folderId, setSheet } = editor;
  const canEdit = ctl.permissions.edit && editable;
  return (
    <View className="mx-4 mt-3 overflow-hidden rounded-input border border-border">
      <PropertyRow
        icon="grid"
        label="Folder"
        {...(canEdit
          ? {
              onPress: () => {
                setSheet("folder");
              },
            }
          : {})}
      >
        <Text size="sm" numberOfLines={1}>
          {folderId === null
            ? "Unfiled"
            : (ctl.folders.find((f) => f.id === folderId)?.name ?? "Folder")}
        </Text>
      </PropertyRow>
      <NoteTagProperty ctl={ctl} editor={editor} editable={editable} />
    </View>
  );
}

/** The read-only note: its title, properties and rendered Markdown. */
export function NoteReader({ ctl, editor }: EditorProps) {
  const title = editor.title.trim();
  return (
    <>
      <View className="mx-4 mb-2">
        <Text size="lg" className="font-semibold">
          {title.length === 0 ? "Untitled note" : title}
        </Text>
      </View>
      <NoteProperties ctl={ctl} editor={editor} editable={false} />
      <View className="mx-4 mt-3 rounded-input border border-border bg-surface-1 p-3">
        <NotePreview body={editor.body} />
      </View>
    </>
  );
}

function EditorFolderPicker({ ctl, editor }: EditorProps) {
  const { folderId, setFolderId, setSheet } = editor;
  return (
    <PickerSheet
      title="Move to folder"
      options={[
        { id: NO_FOLDER, label: "Unfiled" },
        ...ctl.flatFolders.map((entry) => ({
          id: entry.folder.id,
          label: `${"  ".repeat(entry.depth)}${entry.folder.name}`,
        })),
      ]}
      selected={[folderId ?? NO_FOLDER]}
      onChange={(next) => {
        const id = next.at(0);
        setFolderId(id === NO_FOLDER ? null : (id ?? null));
        setSheet(undefined);
      }}
      onClose={() => {
        setSheet(undefined);
      }}
    />
  );
}

function EditorTagPicker({ ctl, editor }: EditorProps) {
  const { tagIds, setTagIds, setSheet } = editor;
  return (
    <PickerSheet
      multiple
      title="Tags"
      emptyText="No tags yet. Create one from the list’s More menu."
      options={ctl.tags.map((tag) => ({
        id: tag.id,
        label: tag.name,
        leading: <View className="h-3 w-3 rounded-pill" style={{ backgroundColor: tag.color }} />,
      }))}
      selected={tagIds}
      onChange={setTagIds}
      onClose={() => {
        setSheet(undefined);
      }}
    />
  );
}

export function NoteEditorPickers(props: EditorProps) {
  if (props.editor.sheet === "folder") return <EditorFolderPicker {...props} />;
  if (props.editor.sheet === "tags") return <EditorTagPicker {...props} />;
  return null;
}
