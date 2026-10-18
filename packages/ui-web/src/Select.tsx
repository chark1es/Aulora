import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "./cn";
import { Icon } from "./Icon";

export interface SelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly description?: string;
  readonly leading?: React.ReactNode;
  /** Nesting depth in the popup, drawn as real left padding. */
  readonly indent?: number;
  /** Full text for the `title` attribute when the label may be truncated. */
  readonly title?: string;
}

/** A trailing action in the popup, e.g. "New folder…". */
export interface SelectAction {
  readonly label: string;
  readonly leading?: React.ReactNode;
  readonly onSelect: () => void;
}

export interface SelectProps<T extends string> {
  readonly label?: string;
  readonly value: T;
  readonly options: readonly SelectOption<T>[];
  readonly onChange: (value: T) => void;
  readonly placeholder?: string;
  readonly className?: string;
  readonly id?: string;
  /** `bare` renders a quiet inline trigger instead of a bordered form control. */
  readonly variant?: "default" | "bare";
  /** An extra item pinned under the options, separated by a divider. */
  readonly action?: SelectAction;
  /** Extra classes for the trigger, e.g. a wider max width. */
  readonly triggerClassName?: string;
  /** Extra classes for the popup, e.g. to widen it beyond the trigger. */
  readonly popupClassName?: string;
}

const INDENT_STEP = 12;

/** Left padding for a nested option row, `undefined` for a top-level one. */
export function optionIndent(indent: number | undefined): number | undefined {
  return indent === undefined || indent <= 0 ? undefined : 8 + indent * INDENT_STEP;
}

function arrowStep(key: string, index: number, rows: number): number | undefined {
  if (key === "ArrowDown") return Math.min(index + 1, rows - 1);
  if (key === "ArrowUp") return Math.max(index - 1, 0);
  if (key === "Home") return 0;
  if (key === "End") return rows - 1;
  return undefined;
}

/**
 * A listbox-styled select built from a button and a popover, so the closed
 * control matches the rest of the app's chrome instead of the OS menu. Fully
 * keyboard driven: Up/Down/Home/End move, Enter selects, Escape closes. An
 * optional `action` item is pinned under the options behind a divider.
 */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder,
  className,
  id,
  variant = "default",
  action,
  triggerClassName,
  popupClassName,
}: SelectProps<T>) {
  const generatedId = useId();
  const buttonId = id ?? generatedId;
  const listId = `${buttonId}-listbox`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);
  const rows = options.length + (action === undefined ? 0 : 1);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const index = options.findIndex((option) => option.value === value);
    setActive(index >= 0 ? index : 0);
  }, [open, options, value]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const commitOption = (index: number): void => {
    const option = options.at(index);
    if (option !== undefined) {
      onChange(option.value);
    }
    setOpen(false);
  };
  const commitActive = (): void => {
    if (active >= options.length) {
      action?.onSelect();
      setOpen(false);
      return;
    }
    commitOption(active);
  };

  return (
    <div ref={rootRef} className={cn("flex flex-col gap-1.5", className)}>
      {label !== undefined && (
        <label htmlFor={buttonId} className="text-[12px] font-medium text-text-muted">
          {label}
        </label>
      )}
      <div className="relative">
        <button
          id={buttonId}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => {
            setOpen((current) => !current);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
            }
          }}
          className={cn(
            "flex items-center gap-2 rounded-[8px] text-left text-[13px] transition",
            variant === "bare"
              ? "h-7 border border-transparent px-1.5 text-text-muted hover:bg-surface-3 hover:text-text"
              : cn(
                  "h-9 w-full border bg-surface-3 px-2.5 text-text",
                  open ? "border-accent" : "border-border hover:border-text-muted/40",
                ),
            triggerClassName,
          )}
        >
          {selected?.leading !== undefined && (
            <span className="flex h-4 w-4 items-center justify-center text-text-muted">
              {selected.leading}
            </span>
          )}
          <span
            title={selected?.title ?? selected?.label}
            className={cn("min-w-0 flex-1 truncate", selected === undefined && "text-text-muted")}
          >
            {selected?.label ?? placeholder ?? "Select"}
          </span>
          <Icon
            name="chevron-down"
            size={14}
            className={cn("shrink-0 text-text-muted transition-transform", open && "-rotate-180")}
          />
        </button>

        {open && (
          <div
            id={listId}
            role="listbox"
            aria-labelledby={buttonId}
            tabIndex={-1}
            // biome-ignore lint/a11y/noAutofocus: the listbox takes focus to capture keys
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                commitActive();
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
                return;
              }
              const next = arrowStep(event.key, active, rows);
              if (next !== undefined) {
                event.preventDefault();
                setActive(next);
              }
            }}
            className={cn(
              "absolute left-0 right-0 top-[calc(100%+4px)] z-40 animate-pop-in overflow-hidden rounded-[10px] border border-border bg-surface-2 p-1 text-left shadow-2xl shadow-black/25",
              popupClassName,
            )}
          >
            {options.map((option, index) => (
              <OptionRow
                key={option.value}
                option={option}
                selected={option.value === value}
                active={index === active}
                onHover={() => {
                  setActive(index);
                }}
                onChoose={() => {
                  commitOption(index);
                }}
              />
            ))}
            {action !== undefined && (
              <ActionRow
                action={action}
                active={active === options.length}
                onHover={() => {
                  setActive(options.length);
                }}
                onChoose={() => {
                  action.onSelect();
                  setOpen(false);
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface OptionRowProps<T extends string> {
  readonly option: SelectOption<T>;
  readonly selected: boolean;
  readonly active: boolean;
  readonly onHover: () => void;
  readonly onChoose: () => void;
}

function OptionRow<T extends string>({
  option,
  selected,
  active,
  onHover,
  onChoose,
}: OptionRowProps<T>) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox handles keys
    <div
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      title={option.title ?? option.label}
      onMouseEnter={onHover}
      onClick={onChoose}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 rounded-[7px] py-1.5 pr-2.5 text-left text-[13px]",
        active ? "bg-surface-3" : "",
      )}
      style={{ paddingLeft: optionIndent(option.indent) ?? 10 }}
    >
      {option.leading !== undefined && (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-text-muted">
          {option.leading}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-text">{option.label}</span>
        {option.description !== undefined && (
          <span className="block truncate text-[11px] text-text-muted">{option.description}</span>
        )}
      </span>
      {selected && <Icon name="check" size={14} className="text-accent" />}
    </div>
  );
}

function ActionRow({
  action,
  active,
  onHover,
  onChoose,
}: {
  readonly action: SelectAction;
  readonly active: boolean;
  readonly onHover: () => void;
  readonly onChoose: () => void;
}) {
  return (
    <>
      <span className="my-1 block h-px bg-border" />
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the listbox handles keys */}
      <div
        role="option"
        tabIndex={-1}
        aria-selected={false}
        onMouseEnter={onHover}
        onClick={onChoose}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-left text-[13px] text-text-muted",
          active ? "bg-surface-3 text-text" : "",
        )}
      >
        {action.leading !== undefined && (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
            {action.leading}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{action.label}</span>
      </div>
    </>
  );
}
