import { Button, Icon, IconButton, Input, Text, Textarea } from "@aulora/ui-web";
import { type Dispatch, type ReactNode, type SetStateAction, useRef, useState } from "react";
import {
  cleanSummaryEdit,
  SUMMARY_EDIT_MAX_ITEM_CHARS,
  SUMMARY_EDIT_MAX_NAME_CHARS,
  SUMMARY_EDIT_MAX_OVERVIEW_CHARS,
  type SummaryEdit,
  validateSummaryEdit,
} from "./summary-edit";

interface Row<T> {
  readonly id: number;
  readonly value: T;
}

/** One editable list: its rows and their setter, as `useState` returns them. */
type Rows<T> = readonly [Row<T>[], Dispatch<SetStateAction<Row<T>[]>>];
type ActionItem = SummaryEdit["actionItems"][number];
type Highlight = SummaryEdit["speakerHighlights"][number];

/**
 * The summary as a form. Every field is a controlled input, so text is only
 * ever a value, never markup. Blank rows are dropped on save.
 */
export function SummaryEditor({
  initial,
  saving,
  error,
  onSave,
  onCancel,
}: {
  readonly initial: SummaryEdit;
  readonly saving: boolean;
  readonly error: string | null;
  readonly onSave: Dispatch<SummaryEdit>;
  readonly onCancel: () => void;
}) {
  const draft = useSummaryDraft(initial);
  const problem = validateSummaryEdit(draft.value);
  return (
    <form
      className="flex max-w-[68ch] flex-col gap-5"
      aria-label="Edit summary"
      data-testid="summary-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (problem === null && !saving) {
          onSave(cleanSummaryEdit(draft.value));
        }
      }}
    >
      <SummaryFields draft={draft} />
      <EditorFooter
        message={problem ?? error}
        saving={saving}
        invalid={problem !== null}
        onCancel={onCancel}
      />
    </form>
  );
}

/** The overview and the four lists, bound to the draft. */
function SummaryFields({ draft }: { readonly draft: SummaryDraft }) {
  return (
    <>
      <Textarea
        label="Overview"
        rows={4}
        value={draft.overview[0]}
        maxLength={SUMMARY_EDIT_MAX_OVERVIEW_CHARS + 200}
        onChange={(event) => {
          draft.overview[1](event.target.value);
        }}
      />
      <StringList
        title="Key points"
        itemLabel="Key point"
        rows={draft.keyPoints}
        nextId={draft.nextId}
      />
      <StringList
        title="Decisions"
        itemLabel="Decision"
        rows={draft.decisions}
        nextId={draft.nextId}
      />
      <ActionItemList rows={draft.actions} nextId={draft.nextId} />
      <HighlightList rows={draft.highlights} nextId={draft.nextId} />
    </>
  );
}

function EditorFooter({
  message,
  saving,
  invalid,
  onCancel,
}: {
  readonly message: string | null;
  readonly saving: boolean;
  readonly invalid: boolean;
  readonly onCancel: () => void;
}) {
  return (
    <>
      <p className="text-[11.5px] text-text-muted">
        Items up to {SUMMARY_EDIT_MAX_ITEM_CHARS} characters, names up to{" "}
        {SUMMARY_EDIT_MAX_NAME_CHARS}. Regenerating the summary later replaces your edits.
      </p>
      {message !== null && (
        <Text tone="danger" size="sm" role="alert">
          {message}
        </Text>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" loading={saving} disabled={saving || invalid}>
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </>
  );
}

type SummaryDraft = ReturnType<typeof useSummaryDraft>;

/** The form's state: one list per section, each row with a stable key. */
function useSummaryDraft(initial: SummaryEdit) {
  const counter = useRef(0);
  const nextId = () => counter.current++;
  const rows = <T,>(values: readonly T[]): Row<T>[] =>
    values.map((value) => ({ id: nextId(), value }));
  const overview = useState(initial.overview);
  const keyPoints = useState(() => rows(initial.keyPoints));
  const decisions = useState(() => rows(initial.decisions));
  const actions = useState(() => rows(initial.actionItems));
  const highlights = useState(() => rows(initial.speakerHighlights));
  const value: SummaryEdit = {
    overview: overview[0],
    keyPoints: keyPoints[0].map((row) => row.value),
    decisions: decisions[0].map((row) => row.value),
    actionItems: actions[0].map((row) => row.value),
    speakerHighlights: highlights[0].map((row) => row.value),
  };
  return { value, nextId, overview, keyPoints, decisions, actions, highlights };
}

/** Replaces one row's value, leaving the others (and every key) as they were. */
function patchRow<T>(rows: readonly Row<T>[], id: number, patch: Partial<T>): Row<T>[] {
  return rows.map((row) => (row.id === id ? { ...row, value: { ...row.value, ...patch } } : row));
}

function withoutRow<T>(rows: readonly Row<T>[], id: number): Row<T>[] {
  return rows.filter((row) => row.id !== id);
}

function StringList({
  title,
  itemLabel,
  rows: [items, setItems],
  nextId,
}: {
  readonly title: string;
  readonly itemLabel: string;
  readonly rows: Rows<string>;
  readonly nextId: () => number;
}) {
  const noun = itemLabel.toLowerCase();
  return (
    <ListFieldset
      title={title}
      addLabel={`Add ${noun}`}
      onAdd={() => {
        setItems((current) => [...current, { id: nextId(), value: "" }]);
      }}
    >
      {items.map((row, index) => (
        <RowShell
          key={row.id}
          removeLabel={`Remove ${noun} ${index + 1}`}
          onRemove={() => {
            setItems((current) => withoutRow(current, row.id));
          }}
        >
          <div className="min-w-0 flex-1">
            <Input
              label={`${itemLabel} ${index + 1}`}
              value={row.value}
              onChange={(event) => {
                const text = event.target.value;
                setItems((current) =>
                  current.map((entry) => (entry.id === row.id ? { ...entry, value: text } : entry)),
                );
              }}
            />
          </div>
        </RowShell>
      ))}
    </ListFieldset>
  );
}

function ActionItemList({
  rows: [items, setItems],
  nextId,
}: {
  readonly rows: Rows<ActionItem>;
  readonly nextId: () => number;
}) {
  return (
    <ListFieldset
      title="Action items"
      addLabel="Add action item"
      onAdd={() => {
        setItems((current) => [...current, { id: nextId(), value: { text: "", owner: null } }]);
      }}
    >
      {items.map((row, index) => (
        <RowShell
          key={row.id}
          removeLabel={`Remove action item ${index + 1}`}
          onRemove={() => {
            setItems((current) => withoutRow(current, row.id));
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
            <div className="min-w-0 flex-1">
              <Input
                label={`Action item ${index + 1}`}
                value={row.value.text}
                onChange={(event) => {
                  const text = event.target.value;
                  setItems((current) => patchRow(current, row.id, { text }));
                }}
              />
            </div>
            <div className="sm:w-[160px]">
              <Input
                label={`Owner of action item ${index + 1} (optional)`}
                placeholder="Owner"
                value={row.value.owner ?? ""}
                onChange={(event) => {
                  const owner = event.target.value;
                  setItems((current) => patchRow(current, row.id, { owner }));
                }}
              />
            </div>
          </div>
        </RowShell>
      ))}
    </ListFieldset>
  );
}

function HighlightList({
  rows: [items, setItems],
  nextId,
}: {
  readonly rows: Rows<Highlight>;
  readonly nextId: () => number;
}) {
  return (
    <ListFieldset
      title="Speaker highlights"
      addLabel="Add highlight"
      onAdd={() => {
        setItems((current) => [...current, { id: nextId(), value: { speaker: "", text: "" } }]);
      }}
    >
      {items.map((row, index) => (
        <RowShell
          key={row.id}
          removeLabel={`Remove highlight ${index + 1}`}
          onRemove={() => {
            setItems((current) => withoutRow(current, row.id));
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
            <div className="sm:w-[160px]">
              <Input
                label={`Speaker of highlight ${index + 1}`}
                placeholder="Speaker"
                value={row.value.speaker}
                onChange={(event) => {
                  const speaker = event.target.value;
                  setItems((current) => patchRow(current, row.id, { speaker }));
                }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <Input
                label={`Highlight ${index + 1}`}
                value={row.value.text}
                onChange={(event) => {
                  const text = event.target.value;
                  setItems((current) => patchRow(current, row.id, { text }));
                }}
              />
            </div>
          </div>
        </RowShell>
      ))}
    </ListFieldset>
  );
}

function ListFieldset({
  title,
  addLabel,
  onAdd,
  children,
}: {
  readonly title: string;
  readonly addLabel: string;
  readonly onAdd: () => void;
  readonly children: ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-[13px] font-semibold text-text">{title}</legend>
      {children}
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          leading={<Icon name="plus" size={14} />}
          onClick={onAdd}
        >
          {addLabel}
        </Button>
      </div>
    </fieldset>
  );
}

function RowShell({
  removeLabel,
  onRemove,
  children,
}: {
  readonly removeLabel: string;
  readonly onRemove: () => void;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      {children}
      {/* The inputs carry a visible label above them; this lines the button up with the field. */}
      <IconButton label={removeLabel} size="sm" className="mt-[26px]" onClick={onRemove}>
        <Icon name="trash" size={14} />
      </IconButton>
    </div>
  );
}
