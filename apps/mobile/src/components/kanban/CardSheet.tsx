import { Button, Icon, Text, usePalette } from "@aulora/ui-native";
import { useMutation, useQuery } from "convex/react";
import { ScrollView, TextInput, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { Sheet } from "../chat/Sheet";
import { confirm } from "./board-menus";
import { CardChecklist, CardNotes } from "./CardChecklist";
import { CardActivity, CardComments } from "./CardComments";
import { CardAttachments, CardLinks } from "./CardFiles";
import { CardPickers } from "./CardPickers";
import { CardProperties, CardTimer } from "./CardProperties";
import { type CardEditor, type CardSheetProps, useCardEditor } from "./use-card-editor";
import { useCardFiles } from "./use-card-files";

interface SectionProps {
  readonly editor: CardEditor;
}

/** Why the card cannot be edited as it stands, with the way out. */
function CardBanners({ editor }: SectionProps) {
  const palette = usePalette();
  const reload = () => {
    if (!editor.dirty) {
      editor.reload();
      return;
    }
    confirm(
      "Replace unsaved card changes?",
      "Reloading replaces your edits with the latest saved version.",
      "Reload card",
      editor.reload,
    );
  };
  return (
    <>
      {editor.card.archived && (
        <View className="flex-row items-center gap-2 rounded-input bg-surface-3 px-3 py-2.5">
          <Icon name="archive" size={16} color={palette["text-muted"]} />
          <Text size="sm" tone="muted" className="flex-1">
            This card is archived. Restore it to make changes.
          </Text>
        </View>
      )}
      {editor.stale && (
        <Animated.View
          entering={FadeInDown.duration(200)}
          className="flex-row items-center gap-3 rounded-input border border-border bg-surface-2 px-3 py-2"
        >
          <Text size="sm" className="flex-1">
            This card changed while you were editing.
          </Text>
          <Button size="sm" variant="secondary" onPress={reload}>
            Reload
          </Button>
        </Animated.View>
      )}
    </>
  );
}

function CardTitle({ editor }: SectionProps) {
  const palette = usePalette();
  return (
    <TextInput
      accessibilityLabel="Title"
      placeholder="Card title"
      placeholderTextColor={palette["text-muted"]}
      editable={editor.canEdit}
      multiline
      scrollEnabled={false}
      maxLength={200}
      submitBehavior="blurAndSubmit"
      value={editor.draft.title}
      onChangeText={(title) => {
        editor.setDraft({ ...editor.draft, title: title.replace(/\n/g, " ") });
      }}
      className="text-[22px] font-semibold leading-7 text-text"
    />
  );
}

/** Archive or restore, and delete for board managers. */
function CardDangerZone({ editor }: SectionProps) {
  const palette = usePalette();
  const archive = useMutation(api.kanban.archiveCard);
  const deleteCard = useMutation(api.kanban.deleteCard);
  const { card } = editor;
  if (!editor.canManage && !editor.canArchive) return null;
  const closeIfSaved = (saved: boolean) => {
    if (saved) editor.onClose();
  };
  const remove = () => {
    void editor.run(() => deleteCard({ cardId: card._id })).then(closeIfSaved);
  };
  return (
    <View className="flex-row flex-wrap gap-2 border-t border-border pt-4">
      {editor.canArchive && (
        <Button
          variant="secondary"
          disabled={editor.busy}
          accessibilityLabel={card.archived ? "Restore card" : "Archive card"}
          leading={
            <Icon name={card.archived ? "unarchive" : "archive"} size={18} color={palette.text} />
          }
          onPress={() => {
            void editor
              .run(() => archive({ cardId: card._id, archived: !card.archived }))
              .then(closeIfSaved);
          }}
        >
          {card.archived ? "Restore" : "Archive"}
        </Button>
      )}
      {editor.canManage && (
        <Button
          variant="ghost"
          disabled={editor.busy}
          accessibilityLabel="Delete card"
          leading={<Icon name="trash" size={18} color={palette.danger} />}
          onPress={() => {
            confirm(
              "Permanently delete card?",
              "This deletes the card with its comments, activity and attachments. It cannot be undone.",
              "Delete card",
              remove,
            );
          }}
        >
          <Text tone="danger" className="font-medium">
            Delete
          </Text>
        </Button>
      )}
    </View>
  );
}

/** The failure of the last write, and Save once something has changed. */
function CardFooter({ editor }: SectionProps) {
  const showSave = editor.dirty && editor.canEdit;
  if (!showSave && editor.error === undefined) return null;
  return (
    <Animated.View
      entering={FadeInDown.duration(200)}
      className="gap-2 border-t border-border bg-surface-1 px-4 py-3"
    >
      {editor.error !== undefined && (
        <Text size="sm" tone="danger" accessibilityRole="alert">
          {editor.error}
        </Text>
      )}
      {showSave && (
        <View className="flex-row items-center gap-3">
          <Text size="sm" tone="muted" className="flex-1">
            Unsaved changes
          </Text>
          <Button
            loading={editor.pending === "save"}
            disabled={editor.busy || editor.stale || !editor.draft.title.trim()}
            onPress={editor.save}
          >
            Save card
          </Button>
        </View>
      )}
    </Animated.View>
  );
}

/** Everything about one card. Edits are kept until **Save card** is pressed. */
export function CardSheet(props: CardSheetProps) {
  const editor = useCardEditor(props);
  const files = useCardFiles(editor);
  const cards = useQuery(api.kanban.listCards, { boardId: props.board.id });
  const column = props.board.columns.find((entry) => entry.id === props.card.columnId);
  return (
    <Sheet
      visible
      title={`${props.board.name} · ${column?.name ?? "Unknown column"}`}
      onClose={editor.close}
      swipeToClose={!editor.unsaved}
      dismiss={editor.dirty ? "cancel" : "done"}
      footer={<CardFooter editor={editor} />}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 22 }}
      >
        <CardBanners editor={editor} />
        <CardTitle editor={editor} />
        <CardProperties editor={editor} />
        <CardTimer editor={editor} />
        <CardNotes editor={editor} />
        <CardChecklist editor={editor} />
        <CardLinks editor={editor} />
        <CardAttachments editor={editor} files={files} />
        <CardComments editor={editor} />
        <CardActivity editor={editor} />
        <CardDangerZone editor={editor} />
      </ScrollView>
      <CardPickers editor={editor} files={files} cards={cards ?? []} />
    </Sheet>
  );
}
