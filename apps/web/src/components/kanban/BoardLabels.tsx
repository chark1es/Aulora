/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { KanbanBoardContent } from "@aulora/core";
import { Button, Icon, IconButton } from "@aulora/ui-web";
import { newItemId } from "./types";

type Label = KanbanBoardContent["labels"][number];

const MAX_LABELS = 50;

/** One label: a round colour swatch that opens the picker, its name, and remove. */
function LabelRow(props: {
  readonly label: Label;
  readonly onChange: (next: Label) => void;
  readonly onRemove: () => void;
}) {
  const { label, onChange, onRemove } = props;
  return (
    <li className="group flex items-center gap-2 rounded-[9px] py-1 pl-2 pr-1 transition hover:bg-surface-3/60">
      <label
        className="relative flex h-6 w-6 shrink-0 cursor-pointer rounded-full ring-1 ring-inset ring-black/10 focus-within:ring-2 focus-within:ring-accent"
        style={{ backgroundColor: label.color }}
      >
        <input
          type="color"
          aria-label={`Color for ${label.name}`}
          value={label.color}
          onChange={(event) => {
            onChange({ ...label, color: event.target.value });
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
      <input
        aria-label="Label name"
        maxLength={50}
        placeholder="Label name"
        value={label.name}
        onChange={(event) => {
          onChange({ ...label, name: event.target.value });
        }}
        className="h-9 min-w-0 flex-1 rounded-[7px] bg-transparent px-2 text-[13px] font-medium text-text placeholder:font-normal placeholder:text-text-muted focus:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      <IconButton
        size="sm"
        variant="danger"
        label={`Remove ${label.name} label`}
        onClick={onRemove}
      >
        <Icon name="trash" size={15} />
      </IconButton>
    </li>
  );
}

/**
 * The board's labels, edited in place: the same inset list as the columns
 * above it, with a swatch per label instead of a separate colour field.
 */
export function BoardLabels(props: {
  readonly labels: readonly Label[];
  readonly onChange: (labels: Label[]) => void;
}) {
  const { labels, onChange } = props;
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1.5 flex w-full items-baseline justify-between gap-3 text-[13.5px] font-semibold text-text">
        <span>Labels</span>
        <span className="text-[12px] font-normal tabular-nums text-text-muted">
          {labels.length} / {MAX_LABELS}
        </span>
      </legend>
      {labels.length > 0 && (
        <ul className="flex flex-col gap-0.5 rounded-[12px] bg-surface-1/70 p-1">
          {labels.map((label) => (
            <LabelRow
              key={label.id}
              label={label}
              onChange={(next) => {
                onChange(labels.map((entry) => (entry.id === label.id ? next : entry)));
              }}
              onRemove={() => {
                onChange(labels.filter((entry) => entry.id !== label.id));
              }}
            />
          ))}
        </ul>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        leading={<Icon name="plus" size={14} />}
        disabled={labels.length >= MAX_LABELS}
        onClick={() => {
          onChange([...labels, { id: newItemId(), name: "New label", color: "#d47838" }]);
        }}
      >
        Add label
      </Button>
    </fieldset>
  );
}
