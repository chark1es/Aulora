import { kanbanDuration } from "@aulora/core";
import { Button, cn, Icon, Select } from "@aulora/ui-web";
import { trackedTime } from "./board-logic";
import { field, Property } from "./card-parts";
import {
  addButton,
  ChecklistMenu,
  dueLabel,
  LabelChip,
  PeoplePicker,
  PRIORITIES,
  PriorityFlag,
  priorityInfo,
} from "./controls";
import type { CardEditor } from "./use-card-editor";

interface Props {
  editor: CardEditor;
}

function ColumnField({ editor }: Props) {
  const { board, card } = editor;
  if (!editor.canEdit)
    return (
      <Property label="Column">
        <span className="text-[13px]">
          {board.columns.find((column) => column.id === card.columnId)?.name ?? "Unknown column"}
        </span>
      </Property>
    );
  return (
    <Select
      label="Column"
      value={card.columnId}
      options={board.columns.map((column) => ({ value: column.id, label: column.name }))}
      onChange={editor.moveTo}
    />
  );
}

function PriorityField({ editor }: Props) {
  const { draft } = editor;
  if (!editor.canEdit)
    return (
      <Property label="Priority">
        <span className="flex items-center gap-2 text-[13px]">
          <PriorityFlag priority={draft.priority} />
          {priorityInfo(draft.priority).label}
        </span>
      </Property>
    );
  return (
    <Select
      label="Priority"
      value={draft.priority}
      options={PRIORITIES.map((priority) => ({
        value: priority,
        label: priorityInfo(priority).label,
        leading: <PriorityFlag priority={priority} />,
      }))}
      onChange={(priority) => {
        editor.setDraft({ ...draft, priority });
      }}
    />
  );
}

function AssigneesField({ editor }: Props) {
  const { draft, board } = editor;
  const count = draft.assigneeIds.length;
  return (
    <Property label={count > 1 ? `Assignees · ${count}` : "Assignees"}>
      <PeoplePicker
        label="Assignees"
        addLabel="Assign someone"
        members={editor.members.filter(
          (member) => !board.private || board.memberIds.includes(member.userId),
        )}
        selected={draft.assigneeIds}
        onChange={(assigneeIds) => {
          editor.setDraft({ ...draft, assigneeIds });
        }}
        editable={editor.canEdit}
        emptyText="Unassigned"
      />
    </Property>
  );
}

function LabelsMenu({ editor }: Props) {
  const { draft, board } = editor;
  return (
    <ChecklistMenu
      label="Labels"
      options={board.labels.map((label) => ({
        id: label.id,
        label: label.name,
        leading: (
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: label.color }}
          />
        ),
      }))}
      selected={draft.labelIds}
      onChange={(labelIds) => {
        editor.setDraft({ ...draft, labelIds });
      }}
      triggerClassName={addButton}
      trigger={
        <>
          <Icon name="plus" size={14} />
          {draft.labelIds.length > 0 ? "Edit" : "Add label"}
        </>
      }
    />
  );
}

function LabelsField({ editor }: Props) {
  const { draft, board } = editor;
  const chosen = board.labels.filter((label) => draft.labelIds.includes(label.id));
  return (
    <Property label="Labels">
      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {chosen.map((label) => (
            <LabelChip key={label.id} name={label.name} color={label.color} />
          ))}
        </div>
      )}
      {board.labels.length === 0 && (
        <p className="text-xs text-text-muted">A board manager can add labels in Board settings.</p>
      )}
      {board.labels.length > 0 && editor.canEdit && <LabelsMenu editor={editor} />}
      {board.labels.length > 0 && !editor.canEdit && chosen.length === 0 && (
        <p className="text-[13px] text-text-muted">None</p>
      )}
    </Property>
  );
}

function ScheduleField({ editor }: Props) {
  const { draft } = editor;
  const due = draft.dueAt ? dueLabel(Date.parse(`${draft.dueAt}T23:59:59Z`), editor.now) : null;
  const overdue = due?.overdue === true;
  return (
    <Property label="Schedule">
      <div className="grid grid-cols-[60px_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 text-[13px]">
        <label htmlFor="kanban-card-start">Start</label>
        <input
          id="kanban-card-start"
          aria-label="Start date"
          type="date"
          className={field}
          value={draft.startAt}
          onChange={(event) => {
            editor.setDraft({ ...draft, startAt: event.target.value });
          }}
        />
        <label htmlFor="kanban-card-due">Due</label>
        <input
          id="kanban-card-due"
          aria-label="Due date"
          type="date"
          className={cn(field, overdue && "border-danger/60 text-danger")}
          value={draft.dueAt}
          onChange={(event) => {
            editor.setDraft({ ...draft, dueAt: event.target.value });
          }}
        />
        <label htmlFor="kanban-card-estimate">Estimate</label>
        <span className="flex items-center gap-2">
          <input
            id="kanban-card-estimate"
            aria-label="Estimate in minutes"
            type="number"
            min={0}
            max={525600}
            placeholder="0"
            className={field}
            value={draft.estimateMinutes}
            onChange={(event) => {
              editor.setDraft({ ...draft, estimateMinutes: event.target.value });
            }}
          />
          <span className="text-xs text-text-muted">min</span>
        </span>
      </div>
      {overdue && <p className="text-xs text-danger">Overdue</p>}
    </Property>
  );
}

function timerCaption(editor: CardEditor): string {
  const { card } = editor;
  if (card.timerUserId) return `Running · ${editor.memberName(card.timerUserId)}`;
  if (card.estimateMinutes !== undefined) return `of ${card.estimateMinutes} min estimated`;
  return "Not running";
}

/** Time tracked on the card, with the button that starts or stops the timer. */
function TimerField({ editor }: Props) {
  const { card } = editor;
  const running = card.timerStartedAt !== undefined;
  const othersTimer =
    !!card.timerUserId && card.timerUserId !== editor.ownUserId && !editor.canManage;
  return (
    <Property label="Time tracked">
      <div className="flex items-center gap-3 rounded-[10px] bg-surface-3 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className={cn("font-mono text-[15px] tabular-nums", running && "text-accent")}>
            {kanbanDuration(trackedTime(card, editor.now))}
          </p>
          <p className="truncate text-[11px] text-text-muted">{timerCaption(editor)}</p>
        </div>
        {editor.canTime && (
          <Button
            variant={running ? "primary" : "secondary"}
            size="sm"
            disabled={editor.busy || othersTimer}
            aria-label={running ? "Stop timer" : "Start timer"}
            leading={<Icon name={running ? "stop" : "play"} size={14} />}
            onClick={() => {
              void editor.toggleTimer();
            }}
          >
            {running ? "Stop" : "Start"}
          </Button>
        )}
      </div>
    </Property>
  );
}

/** The card's column, priority, people, labels, dates and timer. */
export function CardSidebar({ editor }: Props) {
  return (
    <aside className="flex shrink-0 flex-col gap-4 md:sticky md:top-0 md:w-[248px] md:border-l md:border-border md:pl-5">
      <fieldset disabled={!editor.canEdit || editor.busy} className="flex min-w-0 flex-col gap-4">
        <ColumnField editor={editor} />
        <PriorityField editor={editor} />
        <AssigneesField editor={editor} />
        <LabelsField editor={editor} />
        <ScheduleField editor={editor} />
      </fieldset>
      <TimerField editor={editor} />
    </aside>
  );
}
