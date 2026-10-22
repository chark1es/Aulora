/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { cn, Icon } from "@aulora/ui-web";
import type { KeyboardEvent, ReactNode } from "react";

export interface PeopleOption {
  readonly id: string;
  readonly label: string;
  /** A second line, e.g. "You" or "Role". */
  readonly sublabel?: string;
  /** The leading picture at a given pixel size: an avatar, or a role swatch. */
  readonly leading: (size: number) => ReactNode;
  /** Shown but not selectable, e.g. the viewer in their own access list. */
  readonly locked?: boolean;
}

export interface PeoplePickerProps {
  readonly options: readonly PeopleOption[];
  readonly selected: readonly string[];
  readonly onToggle: (id: string) => void;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  /** Accessible name of the search field. */
  readonly searchLabel: string;
  readonly placeholder: string;
  /** `danger` is for exclusion lists such as blocked members. */
  readonly tone?: "accent" | "danger";
  /** Selection that cannot grow any further (a full group, for instance). */
  readonly full?: boolean;
  readonly emptyText: string;
  /** Test id for each row, e.g. `(id) => \`member-option-${id}\``. */
  readonly rowTestId?: (id: string) => string;
  /** Test id and accessible verb for each chip ("Remove" or "Unblock"). */
  readonly chipTestId?: (id: string) => string;
  readonly chipVerb?: string;
  readonly onSearchKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  readonly autoFocus?: boolean;
  /** Tailwind max-height class for the list. */
  readonly listClassName?: string;
}

const TONES = new Map([
  [
    "accent",
    { row: "bg-accent/[0.07]", check: "border-accent bg-accent", chip: "bg-accent/[0.12]" },
  ],
  [
    "danger",
    { row: "bg-danger/[0.07]", check: "border-danger bg-danger", chip: "bg-danger/[0.12]" },
  ],
]);

function toneOf(tone: "accent" | "danger") {
  return TONES.get(tone) ?? { row: "", check: "", chip: "" };
}

/** A chosen person inside the search field: their picture, name and a remove button. */
function PickedChip(props: {
  readonly option: PeopleOption;
  readonly tone: "accent" | "danger";
  readonly verb: string;
  readonly testId?: string | undefined;
  readonly onRemove: () => void;
}) {
  const { option, tone, verb, testId, onRemove } = props;
  return (
    <span
      data-testid={testId}
      className={cn(
        "flex h-7 max-w-[200px] items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-1 text-[12.5px] font-medium text-text",
        toneOf(tone).chip,
      )}
    >
      <span className="flex shrink-0">{option.leading(22)}</span>
      <span className="truncate">{option.label}</span>
      {option.locked !== true && (
        <button
          type="button"
          aria-label={`${verb} ${option.label}`}
          onClick={onRemove}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-text-muted transition hover:bg-text/10 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Icon name="x" size={11} />
        </button>
      )}
    </span>
  );
}

/** The search field, holding the current selection as chips (Backspace removes the last). */
function PickerField(props: PeoplePickerProps) {
  const { options, selected, onToggle, query, onQueryChange, tone = "accent" } = props;
  const byId = new Map(options.map((option) => [option.id, option]));
  const picked = selected.flatMap((id) => {
    const option = byId.get(id);
    return option === undefined ? [] : [option];
  });
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-[10px] bg-surface-3 px-2 py-1.5 transition focus-within:ring-2 focus-within:ring-accent/60">
      <Icon name="search" size={15} className="ml-1 shrink-0 text-text-muted" />
      {picked.map((option) => (
        <PickedChip
          key={option.id}
          option={option}
          tone={tone}
          verb={props.chipVerb ?? "Remove"}
          testId={props.chipTestId?.(option.id)}
          onRemove={() => {
            onToggle(option.id);
          }}
        />
      ))}
      <input
        aria-label={props.searchLabel}
        placeholder={picked.length === 0 ? props.placeholder : ""}
        value={query}
        // biome-ignore lint/a11y/noAutofocus: the picker is the dialog's only task when asked to
        autoFocus={props.autoFocus === true}
        onChange={(event) => {
          onQueryChange(event.target.value);
        }}
        onKeyDown={(event) => {
          const last = picked.at(-1);
          if (event.key === "Backspace" && query.length === 0 && last !== undefined) {
            if (last.locked !== true) {
              event.preventDefault();
              onToggle(last.id);
            }
          }
          props.onSearchKeyDown?.(event);
        }}
        className="h-7 min-w-[8rem] flex-1 bg-transparent px-1 text-[13.5px] text-text placeholder:text-text-muted focus-visible:outline-none"
      />
    </div>
  );
}

/** One selectable person: picture, name, optional second line, and a check. */
function PickerRow(props: {
  readonly option: PeopleOption;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly tone: "accent" | "danger";
  readonly testId?: string | undefined;
  readonly onToggle: () => void;
}) {
  const { option, checked, disabled, tone, testId, onToggle } = props;
  const colors = toneOf(tone);
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={checked}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-3 rounded-[9px] px-2 py-1.5 text-left transition",
        "hover:bg-surface-3/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
        "disabled:cursor-default disabled:hover:bg-transparent",
        checked && colors.row,
        disabled && !checked && "opacity-45",
      )}
    >
      <span className="flex shrink-0">{option.leading(30)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-text">{option.label}</span>
        {option.sublabel !== undefined && (
          <span className="block truncate text-[12px] text-text-muted">{option.sublabel}</span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] text-on-accent transition",
          checked ? colors.check : "border-text-muted/40",
        )}
      >
        {checked && <Icon name="check" size={12} />}
      </span>
    </button>
  );
}

/**
 * Searchable multi-select of people (and roles): a search field that holds the
 * selection as picture chips, over an inset list of rows with avatars and a
 * check. One component for every "choose people" task in a dialog, so access
 * lists, block lists and new conversations look and behave the same.
 */
export function PeoplePicker(props: PeoplePickerProps) {
  const { options, selected, onToggle, query, tone = "accent", full = false } = props;
  const needle = query.trim().toLowerCase();
  const visible = options.filter((option) => option.label.toLowerCase().includes(needle));
  return (
    <div className="flex flex-col gap-2">
      <PickerField {...props} />
      <ul
        className={cn(
          "flex flex-col gap-0.5 overflow-y-auto rounded-[12px] bg-surface-1/70 p-1",
          props.listClassName ?? "max-h-[232px]",
        )}
      >
        {visible.map((option) => {
          const checked = selected.includes(option.id);
          return (
            <li key={option.id}>
              <PickerRow
                option={option}
                checked={checked}
                disabled={option.locked === true || (!checked && full)}
                tone={tone}
                testId={props.rowTestId?.(option.id)}
                onToggle={() => {
                  onToggle(option.id);
                }}
              />
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="px-3 py-6 text-center text-[12.5px] text-text-muted">{props.emptyText}</li>
        )}
      </ul>
    </div>
  );
}
