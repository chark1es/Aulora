/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { type KeyboardEvent, type ReactNode, useId, useRef } from "react";
import { cn } from "./cn";

export interface ChoiceOption<T extends string> {
  readonly value: T;
  readonly title: string;
  readonly description?: string;
  /** The glyph inside the 32px tile: an Icon, or a short text mark. */
  readonly leading: ReactNode;
}

export interface ChoiceListProps<T extends string> {
  /** Accessible name of the radio group. */
  readonly label: string;
  readonly value: T;
  readonly options: readonly ChoiceOption<T>[];
  readonly onChange: (value: T) => void;
  /** `grid` puts two choices side by side, for short pairs such as languages. */
  readonly layout?: "stack" | "grid";
}

/** The one thing the list does with a row's radio: focus it. */
interface Focusable {
  focus(): void;
}

const STEP = new Map([
  ["ArrowDown", 1],
  ["ArrowRight", 1],
  ["ArrowUp", -1],
  ["ArrowLeft", -1],
]);

/**
 * A single choice drawn as rows: a glyph tile, a title, one line of description
 * and a radio dot. Real radio inputs underneath, so arrow keys move the
 * selection and Tab stops only on the chosen row, as in a native radio group.
 */
export function ChoiceList<T extends string>(props: ChoiceListProps<T>) {
  const { label, value, options, onChange, layout = "stack" } = props;
  const name = useId();
  const refs = useRef(new Map<string, Focusable>());

  const move = (event: KeyboardEvent<HTMLInputElement>) => {
    const step = STEP.get(event.key);
    if (step === undefined) {
      return;
    }
    event.preventDefault();
    const index = options.findIndex((option) => option.value === value);
    const next = options.at((index + step + options.length) % options.length);
    if (next !== undefined) {
      onChange(next.value);
      refs.current.get(next.value)?.focus();
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(layout === "grid" ? "grid grid-cols-2 gap-1.5" : "flex flex-col gap-1")}
    >
      {options.map((option) => (
        <ChoiceRow
          key={option.value}
          option={option}
          name={name}
          active={option.value === value}
          onSelect={() => {
            onChange(option.value);
          }}
          onKeyDown={move}
          register={(node) => {
            if (node === null) {
              refs.current.delete(option.value);
            } else {
              refs.current.set(option.value, node);
            }
          }}
        />
      ))}
    </div>
  );
}

interface ChoiceRowProps {
  readonly option: ChoiceOption<string>;
  readonly name: string;
  readonly active: boolean;
  readonly onSelect: () => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  readonly register: (node: Focusable | null) => void;
}

function ChoiceRow(props: ChoiceRowProps) {
  const { option, name, active, onSelect, onKeyDown, register } = props;
  return (
    <label
      className={cn(
        "group flex w-full cursor-pointer select-none items-center gap-3 rounded-[10px] px-2.5 py-2 text-left transition focus-within:ring-2 focus-within:ring-accent",
        active ? "bg-accent/10 ring-1 ring-inset ring-accent/40" : "hover:bg-surface-3",
      )}
    >
      <input
        ref={register}
        type="radio"
        name={name}
        checked={active}
        tabIndex={active ? 0 : -1}
        onChange={onSelect}
        onKeyDown={onKeyDown}
        className="sr-only"
      />
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] transition-colors",
          active
            ? "bg-accent/15 text-accent"
            : "bg-surface-3 text-text-muted group-hover:text-text",
        )}
      >
        {option.leading}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium text-text">{option.title}</span>
        {option.description !== undefined && (
          <span className="mt-0.5 block truncate text-[12px] text-text-muted">
            {option.description}
          </span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition",
          active ? "border-accent bg-accent" : "border-border",
        )}
      >
        {active && <span className="h-1.5 w-1.5 rounded-full bg-on-accent" />}
      </span>
    </label>
  );
}
