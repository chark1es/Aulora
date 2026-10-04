import { kanbanDuration } from "@aulora/core";
import { Button, Icon, Text, usePalette } from "@aulora/ui-native";
import { TextInput, View } from "react-native";
import {
  type Card,
  dueLabel,
  endOfDay,
  formatDay,
  priorityInfo,
  trackedTime,
} from "../../lib/kanban";
import { AvatarStack, LabelChip, PriorityFlag, PropertyRow, useNow } from "./parts";
import type { CardEditor, CardPicker } from "./use-card-editor";

interface SectionProps {
  readonly editor: CardEditor;
}

function nameOf(editor: CardEditor, userId: string): string {
  return editor.members.find((member) => member.userId === userId)?.displayName ?? "Former member";
}

function AssigneesValue({ editor }: SectionProps) {
  const ids = editor.draft.assigneeIds;
  if (ids.length === 0)
    return (
      <Text size="sm" tone="muted">
        {editor.canEdit ? "Assign someone" : "Unassigned"}
      </Text>
    );
  return (
    <>
      <AvatarStack userIds={ids} members={editor.members} max={4} ring="surface-2" />
      <Text size="sm" className="shrink" numberOfLines={1}>
        {ids.length === 1 ? nameOf(editor, ids.at(0) ?? "") : `${ids.length} people`}
      </Text>
    </>
  );
}

function noLabelsText(editor: CardEditor): string {
  if (editor.board.labels.length === 0) return "No labels on this board";
  return editor.canEdit ? "Add label" : "None";
}

function LabelsValue({ editor }: SectionProps) {
  const labels = editor.board.labels.filter((label) => editor.draft.labelIds.includes(label.id));
  if (labels.length === 0)
    return (
      <Text size="sm" tone="muted">
        {noLabelsText(editor)}
      </Text>
    );
  return (
    <>
      {labels.slice(0, 2).map((label) => (
        <View key={label.id} className="shrink">
          <LabelChip name={label.name} color={label.color} />
        </View>
      ))}
      {labels.length > 2 && (
        <Text size="xs" tone="muted">
          +{labels.length - 2}
        </Text>
      )}
    </>
  );
}

function DateValue({ day, overdue }: { readonly day: string; readonly overdue: boolean }) {
  if (day === "")
    return (
      <Text size="sm" tone="muted">
        None
      </Text>
    );
  return (
    <Text size="sm" tone={overdue ? "danger" : "default"}>
      {formatDay(day)}
      {overdue ? " · Overdue" : ""}
    </Text>
  );
}

function EstimateRow({ editor }: SectionProps) {
  const palette = usePalette();
  const { draft } = editor;
  return (
    <PropertyRow icon="timer" label="Estimate" last>
      <TextInput
        accessibilityLabel="Estimate in minutes"
        editable={editor.canEdit}
        keyboardType="number-pad"
        placeholder="0"
        placeholderTextColor={palette["text-muted"]}
        maxLength={6}
        value={draft.estimateMinutes}
        onChangeText={(text) => {
          editor.setDraft({ ...draft, estimateMinutes: text.replace(/\D/g, "") });
        }}
        className="min-h-9 min-w-[64px] rounded-input bg-surface-3 px-3 text-right text-[15px] text-text"
      />
      <Text size="sm" tone="muted">
        min
      </Text>
    </PropertyRow>
  );
}

/** The card's column, priority, people, labels and dates as one grouped list. */
export function CardProperties({ editor }: SectionProps) {
  const { draft, board, card } = editor;
  const column = board.columns.find((entry) => entry.id === card.columnId);
  const overdue = draft.dueAt !== "" && dueLabel(endOfDay(draft.dueAt), editor.now).overdue;
  const opener = (picker: CardPicker, enabled = true) =>
    editor.canEdit && enabled
      ? () => {
          editor.setPicker(picker);
        }
      : undefined;
  return (
    <View className="overflow-hidden rounded-card bg-surface-2">
      <PropertyRow icon="kanban" label="Column" onPress={opener("column")}>
        <Text size="sm" numberOfLines={1}>
          {column?.name ?? "Unknown column"}
        </Text>
      </PropertyRow>
      <PropertyRow icon="flag" label="Priority" onPress={opener("priority")}>
        <PriorityFlag priority={draft.priority} />
        <Text size="sm">{priorityInfo(draft.priority).label}</Text>
      </PropertyRow>
      <PropertyRow icon="users" label="Assignees" onPress={opener("assignees")}>
        <AssigneesValue editor={editor} />
      </PropertyRow>
      <PropertyRow icon="label" label="Labels" onPress={opener("labels", board.labels.length > 0)}>
        <LabelsValue editor={editor} />
      </PropertyRow>
      <PropertyRow icon="calendar" label="Start" onPress={opener("start")}>
        <DateValue day={draft.startAt} overdue={false} />
      </PropertyRow>
      <PropertyRow icon="calendar" label="Due" onPress={opener("due")}>
        <DateValue day={draft.dueAt} overdue={overdue} />
      </PropertyRow>
      <EstimateRow editor={editor} />
    </View>
  );
}

/** The tracked time, re-rendering by itself each second while the timer runs. */
function TimerClock({ card }: { readonly card: Card }) {
  const palette = usePalette();
  const running = card.timerStartedAt !== undefined;
  const tracked = trackedTime(card, useNow(running));
  return (
    <Text
      mono
      className="text-[20px]"
      style={{ color: running ? palette.accent : palette.text, fontVariant: ["tabular-nums"] }}
    >
      {kanbanDuration(tracked)}
    </Text>
  );
}

function timerCaption(editor: CardEditor): string {
  const { card } = editor;
  if (card.timerUserId !== undefined) return `Running · ${nameOf(editor, card.timerUserId)}`;
  if (card.estimateMinutes !== undefined) return `Tracked of ${card.estimateMinutes} min estimated`;
  return "Time tracked";
}

/** Time tracked on the card, with the button that starts or stops the timer. */
export function CardTimer({ editor }: SectionProps) {
  const palette = usePalette();
  const { card } = editor;
  const running = card.timerStartedAt !== undefined;
  const othersTimer =
    card.timerUserId !== undefined && card.timerUserId !== editor.ownUserId && !editor.canManage;
  return (
    <View className="flex-row items-center gap-3 rounded-card bg-surface-2 px-4 py-3">
      <View className="min-w-0 flex-1">
        <TimerClock card={card} />
        <Text size="xs" tone="muted" numberOfLines={1}>
          {timerCaption(editor)}
        </Text>
      </View>
      {editor.canTime && (
        <Button
          variant={running ? "primary" : "secondary"}
          disabled={othersTimer}
          accessibilityLabel={running ? "Stop timer" : "Start timer"}
          leading={
            <Icon
              name={running ? "stop" : "play"}
              size={18}
              color={running ? palette["on-accent"] : palette.text}
            />
          }
          onPress={() => {
            void editor.toggleTimer();
          }}
        >
          {running ? "Stop" : "Start"}
        </Button>
      )}
    </View>
  );
}
