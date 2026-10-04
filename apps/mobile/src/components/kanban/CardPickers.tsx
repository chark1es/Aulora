import { View } from "react-native";
import { pickDocuments, pickFromLibrary } from "../../lib/attachments";
import { type Card, isColumnFull, PRIORITIES, priorityInfo } from "../../lib/kanban";
import { MemberAvatar } from "../chat/MemberAvatar";
import { DateSheet } from "./DateSheet";
import { PickerSheet } from "./PickerSheet";
import { PriorityFlag } from "./parts";
import { ActionSheet } from "./sheets";
import type { CardEditor } from "./use-card-editor";
import type { CardFiles } from "./use-card-files";

interface PickerProps {
  readonly editor: CardEditor;
  readonly onClose: () => void;
}

function ColumnPicker({
  editor,
  onClose,
  cards,
}: PickerProps & { readonly cards: readonly Card[] }) {
  const { board, card } = editor;
  return (
    <PickerSheet
      title="Move to column"
      options={board.columns.map((column) => {
        const full = column.id !== card.columnId && isColumnFull(column, cards);
        return {
          id: column.id,
          label: column.name,
          disabled: full,
          ...(full ? { hint: "Column limit reached" } : {}),
        };
      })}
      selected={[card.columnId]}
      onChange={(selected) => {
        const columnId = selected.at(0);
        if (columnId !== undefined) editor.moveTo(columnId);
      }}
      onClose={onClose}
    />
  );
}

function PriorityPicker({ editor, onClose }: PickerProps) {
  return (
    <PickerSheet
      title="Priority"
      options={PRIORITIES.map((priority) => ({
        id: priority,
        label: priorityInfo(priority).label,
        leading: <PriorityFlag priority={priority} />,
      }))}
      selected={[editor.draft.priority]}
      onChange={(selected) => {
        const priority = PRIORITIES.find((entry) => entry === selected.at(0));
        if (priority !== undefined) editor.setDraft({ ...editor.draft, priority });
      }}
      onClose={onClose}
    />
  );
}

function AssigneePicker({ editor, onClose }: PickerProps) {
  const { board, draft } = editor;
  const people = editor.members.filter(
    (member) => !board.private || board.memberIds.includes(member.userId),
  );
  // Someone who left stays listed so they can still be unassigned.
  const former = draft.assigneeIds
    .filter((id) => !people.some((member) => member.userId === id))
    .map((id) => ({ userId: id, displayName: "Former member" }));
  return (
    <PickerSheet
      multiple
      title="Assignees"
      searchPlaceholder="Find a person"
      emptyText="Nobody can be assigned on this board"
      options={[...former, ...people].map((member) => ({
        id: member.userId,
        label: member.displayName,
        leading: <MemberAvatar userId={member.userId} size={28} />,
      }))}
      selected={draft.assigneeIds}
      onChange={(assigneeIds) => {
        editor.setDraft({ ...draft, assigneeIds });
      }}
      onClose={onClose}
    />
  );
}

function LabelPicker({ editor, onClose }: PickerProps) {
  return (
    <PickerSheet
      multiple
      title="Labels"
      options={editor.board.labels.map((label) => ({
        id: label.id,
        label: label.name,
        leading: <View className="h-3 w-3 rounded-pill" style={{ backgroundColor: label.color }} />,
      }))}
      selected={editor.draft.labelIds}
      onChange={(labelIds) => {
        editor.setDraft({ ...editor.draft, labelIds });
      }}
      onClose={onClose}
    />
  );
}

function DatePicker({ editor, onClose, which }: PickerProps & { readonly which: "start" | "due" }) {
  const { draft } = editor;
  const start = which === "start";
  return (
    <DateSheet
      title={start ? "Start date" : "Due date"}
      value={start ? draft.startAt : draft.dueAt}
      now={editor.now}
      onChange={(day) => {
        editor.setDraft(start ? { ...draft, startAt: day } : { ...draft, dueAt: day });
      }}
      onClose={onClose}
    />
  );
}

function AttachPicker({ onClose, files }: PickerProps & { readonly files: CardFiles }) {
  const ignore = () => undefined;
  return (
    <ActionSheet
      title="Add an attachment"
      actions={[
        {
          id: "photo",
          label: "Photo library",
          icon: "image",
          onPress: () => {
            void pickFromLibrary().then(files.upload, ignore);
          },
        },
        {
          id: "file",
          label: "Choose a file",
          icon: "file",
          onPress: () => {
            void pickDocuments().then(files.upload, ignore);
          },
        },
      ]}
      onClose={onClose}
    />
  );
}

export interface CardPickersProps {
  readonly editor: CardEditor;
  readonly files: CardFiles;
  /** Every card on the board, to tell which columns are full. */
  readonly cards: readonly Card[];
}

/** Whichever picker is open over the card sheet. */
export function CardPickers({ editor, files, cards }: CardPickersProps) {
  const { picker } = editor;
  const onClose = () => {
    editor.setPicker(undefined);
  };
  if (picker === undefined) return null;
  if (picker === "column") return <ColumnPicker editor={editor} cards={cards} onClose={onClose} />;
  if (picker === "priority") return <PriorityPicker editor={editor} onClose={onClose} />;
  if (picker === "assignees") return <AssigneePicker editor={editor} onClose={onClose} />;
  if (picker === "labels") return <LabelPicker editor={editor} onClose={onClose} />;
  if (picker === "attach") return <AttachPicker editor={editor} files={files} onClose={onClose} />;
  return <DatePicker editor={editor} which={picker} onClose={onClose} />;
}
