import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";
import { Icon } from "./Icon";
import { swallowOutsideClick, useSelectPopup } from "./useSelectPopup";

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
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const popupStyle = useSelectPopup(open, triggerRef, listRef);
  // The listbox takes focus while open, so closing it (Enter, Escape or a
  // selection) must hand focus back to the trigger rather than let it fall to
  // <body>. A pointer click outside leaves focus where the person put it.
  const restoreFocusRef = useRef(false);
  const selectionRef = useRef({ options, value });
  selectionRef.current = { options, value };
  const swallowCleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => swallowCleanup.current?.(), []);
  const selected = options.find((option) => option.value === value);
  const rows = options.length + (action === undefined ? 0 : 1);

  const closeListbox = (restoreFocus: boolean): void => {
    restoreFocusRef.current = restoreFocus;
    setOpen(false);
  };

  useEffect(() => {
    if (open || !restoreFocusRef.current) {
      return;
    }
    restoreFocusRef.current = false;
    triggerRef.current?.focus();
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    swallowCleanup.current?.();
    const { options, value } = selectionRef.current;
    const index = options.findIndex((option) => option.value === value);
    setActive(index >= 0 ? index : 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        rootRef.current?.contains(target) === true ||
        listRef.current?.contains(target) === true
      ) {
        return;
      }
      swallowCleanup.current = swallowOutsideClick(event.target);
      restoreFocusRef.current = false;
      setOpen(false);
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
    closeListbox(true);
  };
  const commitActive = (): void => {
    if (active >= options.length) {
      action?.onSelect();
      closeListbox(true);
      return;
    }
    commitOption(active);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: observes focus leaving the composite control
    <div
      ref={rootRef}
      className={cn("flex flex-col gap-1.5", className)}
      onBlur={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget) &&
          !listRef.current?.contains(event.relatedTarget)
        )
          closeListbox(false);
      }}
    >
      {label !== undefined && (
        <label
          htmlFor={buttonId}
          id={`${buttonId}-label`}
          className="text-[12px] font-medium text-text-muted"
        >
          {label}
        </label>
      )}
      <div className="relative">
        <button
          id={buttonId}
          ref={triggerRef}
          type="button"
          aria-labelledby={label === undefined ? undefined : `${buttonId}-label ${buttonId}-value`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => {
            if (open) {
              closeListbox(true);
            } else {
              setOpen(true);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
            }
          }}
          className={cn(
            "flex items-center gap-2 rounded-[8px] text-left text-[13px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            variant === "bare"
              ? "h-7 border border-transparent px-1.5 text-text-muted hover:bg-surface-3 hover:text-text"
              : cn(
                  // text-centering-ok: truncate keeps a 16px leading-4 line box,
                  // which is Inter's centred cap band for 13px text (measured 0.25).
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
            id={`${buttonId}-value`}
            title={selected?.title ?? selected?.label}
            // 16px is Inter's 13px line box: the label stays clip-safe for
            // `truncate` and its baseline lands on a whole pixel, centred.
            className={cn(
              "min-w-0 flex-1 truncate leading-4",
              selected === undefined && "text-text-muted",
            )}
          >
            {selected?.label ?? placeholder ?? "Select"}
          </span>
          <Icon
            name="chevron-down"
            size={14}
            className={cn("shrink-0 text-text-muted transition-transform", open && "-rotate-180")}
          />
        </button>

        {open &&
          createPortal(
            <div
              ref={listRef}
              style={popupStyle}
              id={listId}
              role="listbox"
              aria-labelledby={buttonId}
              aria-activedescendant={rows > 0 ? `${listId}-option-${active}` : undefined}
              tabIndex={-1}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  commitActive();
                  return;
                }
                if (event.key === "Escape" || event.key === "Tab") {
                  event.preventDefault();
                  event.stopPropagation();
                  closeListbox(true);
                  return;
                }
                const next = arrowStep(event.key, active, rows);
                if (next !== undefined) {
                  event.preventDefault();
                  setActive(next);
                }
              }}
              className={cn(
                "fixed z-[100] focus:outline-none overflow-y-auto overscroll-contain rounded-[10px] border border-border bg-surface-2 p-1 text-left shadow-2xl shadow-black/25",
                popupClassName,
              )}
            >
              {options.map((option, index) => (
                <OptionRow
                  key={option.value}
                  id={`${listId}-option-${index}`}
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
                  id={`${listId}-option-${options.length}`}
                  action={action}
                  active={active === options.length}
                  onHover={() => {
                    setActive(options.length);
                  }}
                  onChoose={() => {
                    action.onSelect();
                    closeListbox(true);
                  }}
                />
              )}
            </div>,
            document.body,
          )}
      </div>
    </div>
  );
}

interface OptionRowProps<T extends string> {
  readonly id: string;
  readonly option: SelectOption<T>;
  readonly selected: boolean;
  readonly active: boolean;
  readonly onHover: () => void;
  readonly onChoose: () => void;
}

function OptionRow<T extends string>({
  id,
  option,
  selected,
  active,
  onHover,
  onChoose,
}: OptionRowProps<T>) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox handles keys
    <div
      id={id}
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
  id,
  action,
  active,
  onHover,
  onChoose,
}: {
  readonly id: string;
  readonly action: SelectAction;
  readonly active: boolean;
  readonly onHover: () => void;
  readonly onChoose: () => void;
}) {
  return (
    <>
      <span aria-hidden="true" className="my-1 block h-px bg-border" />
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the listbox handles keys */}
      <div
        id={id}
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
