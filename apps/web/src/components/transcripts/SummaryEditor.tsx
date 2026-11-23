import { Button, Icon, IconButton, Input, Text, Textarea } from "@aulora/ui-web";
import { useRef, useState } from "react";
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
  readonly onSave: (summary: SummaryEdit) => void;
  readonly onCancel: () => void;
}) {
  const nextId = useRef(0);
  const rows = <T,>(values: readonly T[]): Row<T>[] =>
    values.map((value) => ({ id: nextId.current++, value }));
  const [overview, setOverview] = useState(initial.overview);
  const [keyPoints, setKeyPoints] = useState(() => rows(initial.keyPoints));
  const [decisions, setDecisions] = useState(() => rows(initial.decisions));
  const [actions, setActions] = useState(() => rows(initial.actionItems));
  const [highlights, setHighlights] = useState(() => rows(initial.speakerHighlights));

  const draft: SummaryEdit = {
    overview,
    keyPoints: keyPoints.map((row) => row.value),
    decisions: decisions.map((row) => row.value),
    actionItems: actions.map((row) => row.value),
    speakerHighlights: highlights.map((row) => row.value),
  };
  const problem = validateSummaryEdit(draft);

  return (
    <form
      className="flex max-w-[68ch] flex-col gap-5"
      aria-label="Edit summary"
      data-testid="summary-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (problem === null && !saving) {
          onSave(cleanSummaryEdit(draft));
        }
      }}
    >
      <Textarea
        label="Overview"
        rows={4}
        value={overview}
        maxLength={SUMMARY_EDIT_MAX_OVERVIEW_CHARS + 200}
        onChange={(event) => {
          setOverview(event.target.value);
        }}
      />
      <StringList
        title="Key points"
        itemLabel="Key point"
        items={keyPoints}
        setItems={setKeyPoints}
        newRow={() => ({ id: nextId.current++, value: "" })}
      />
      <StringList
        title="Decisions"
        itemLabel="Decision"
        items={decisions}
        setItems={setDecisions}
        newRow={() => ({ id: nextId.current++, value: "" })}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[13px] font-semibold text-text">Action items</legend>
        {actions.map((row, index) => (
          <div key={row.id} className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
              <div className="min-w-0 flex-1">
                <Input
                  label={`Action item ${index + 1}`}
                  value={row.value.text}
                  onChange={(event) => {
                    setActions((current) =>
                      current.map((entry) =>
                        entry.id === row.id
                          ? { ...entry, value: { ...entry.value, text: event.target.value } }
                          : entry,
                      ),
                    );
                  }}
                />
              </div>
              <div className="sm:w-[160px]">
                <Input
                  label={`Owner of action item ${index + 1} (optional)`}
                  placeholder="Owner"
                  value={row.value.owner ?? ""}
                  onChange={(event) => {
                    setActions((current) =>
                      current.map((entry) =>
                        entry.id === row.id
                          ? { ...entry, value: { ...entry.value, owner: event.target.value } }
                          : entry,
                      ),
                    );
                  }}
                />
              </div>
            </div>
            <RemoveButton
              label={`Remove action item ${index + 1}`}
              onClick={() => {
                setActions((current) => current.filter((entry) => entry.id !== row.id));
              }}
            />
          </div>
        ))}
        <AddButton
          label="Add action item"
          onClick={() => {
            setActions((current) => [
              ...current,
              { id: nextId.current++, value: { text: "", owner: null } },
            ]);
          }}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[13px] font-semibold text-text">Speaker highlights</legend>
        {highlights.map((row, index) => (
          <div key={row.id} className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
              <div className="sm:w-[160px]">
                <Input
                  label={`Speaker of highlight ${index + 1}`}
                  placeholder="Speaker"
                  value={row.value.speaker}
                  onChange={(event) => {
                    setHighlights((current) =>
                      current.map((entry) =>
                        entry.id === row.id
                          ? { ...entry, value: { ...entry.value, speaker: event.target.value } }
                          : entry,
                      ),
                    );
                  }}
                />
              </div>
              <div className="min-w-0 flex-1">
                <Input
                  label={`Highlight ${index + 1}`}
                  value={row.value.text}
                  onChange={(event) => {
                    setHighlights((current) =>
                      current.map((entry) =>
                        entry.id === row.id
                          ? { ...entry, value: { ...entry.value, text: event.target.value } }
                          : entry,
                      ),
                    );
                  }}
                />
              </div>
            </div>
            <RemoveButton
              label={`Remove highlight ${index + 1}`}
              onClick={() => {
                setHighlights((current) => current.filter((entry) => entry.id !== row.id));
              }}
            />
          </div>
        ))}
        <AddButton
          label="Add highlight"
          onClick={() => {
            setHighlights((current) => [
              ...current,
              { id: nextId.current++, value: { speaker: "", text: "" } },
            ]);
          }}
        />
      </fieldset>

      <p className="text-[11.5px] text-text-muted">
        Items up to {SUMMARY_EDIT_MAX_ITEM_CHARS} characters, names up to{" "}
        {SUMMARY_EDIT_MAX_NAME_CHARS}. Regenerating the summary later replaces your edits.
      </p>
      {(problem ?? error) !== null && (
        <Text tone="danger" size="sm" role="alert">
          {problem ?? error}
        </Text>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" loading={saving} disabled={saving || problem !== null}>
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function StringList({
  title,
  itemLabel,
  items,
  setItems,
  newRow,
}: {
  readonly title: string;
  readonly itemLabel: string;
  readonly items: readonly Row<string>[];
  readonly setItems: (update: (current: readonly Row<string>[]) => Row<string>[]) => void;
  readonly newRow: () => Row<string>;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-[13px] font-semibold text-text">{title}</legend>
      {items.map((row, index) => (
        <div key={row.id} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Input
              label={`${itemLabel} ${index + 1}`}
              value={row.value}
              onChange={(event) => {
                setItems((current) =>
                  current.map((entry) =>
                    entry.id === row.id ? { ...entry, value: event.target.value } : entry,
                  ),
                );
              }}
            />
          </div>
          <RemoveButton
            label={`Remove ${itemLabel.toLowerCase()} ${index + 1}`}
            onClick={() => {
              setItems((current) => current.filter((entry) => entry.id !== row.id));
            }}
          />
        </div>
      ))}
      <AddButton
        label={`Add ${itemLabel.toLowerCase()}`}
        onClick={() => {
          setItems((current) => [...current, newRow()]);
        }}
      />
    </fieldset>
  );
}

function RemoveButton({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}) {
  // The inputs carry a visible label above them; this lines the button up with the field.
  return (
    <IconButton label={label} size="sm" className="mt-[26px]" onClick={onClick}>
      <Icon name="trash" size={14} />
    </IconButton>
  );
}

function AddButton({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        leading={<Icon name="plus" size={14} />}
        onClick={onClick}
      >
        {label}
      </Button>
    </div>
  );
}
