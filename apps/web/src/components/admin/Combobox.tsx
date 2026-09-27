import { cn, Icon } from "@aulora/ui-web";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";

export interface ComboboxOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  /** Extra text that participates in filtering but is never shown. */
  readonly keywords?: string;
  readonly leading?: ReactNode;
  readonly disabled?: boolean;
}

export interface ComboboxProps {
  readonly value: string;
  readonly options: readonly ComboboxOption[];
  readonly onChange: (value: string) => void;
  readonly label?: string;
  readonly placeholder?: string;
  readonly searchPlaceholder?: string;
  readonly emptyMessage?: string;
  readonly className?: string;
  readonly id?: string;
  readonly disabled?: boolean;
  readonly "aria-label"?: string;
}

/**
 * A type-to-filter picker: a button that opens a popover with a search input
 * and a listbox. Typing filters options live; Up/Down/Home/End move the active
 * option, Enter selects it, Escape closes the popover and a pointer-down
 * outside dismisses it. It deliberately avoids the native `<select>` so roles
 * and members can be shown with color and context.
 */
export function Combobox({
  value,
  options,
  onChange,
  label,
  placeholder,
  searchPlaceholder = "Type to filter…",
  emptyMessage = "No matches.",
  className,
  id,
  disabled = false,
  "aria-label": ariaLabel,
}: ComboboxProps) {
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const listId = `${triggerId}-listbox`;
  const optionId = (index: number): string => `${listId}-opt-${index}`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const selected = options.find((option) => option.value === value);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) {
      return options;
    }
    return options.filter((option) =>
      [option.label, option.description, option.keywords, option.value]
        .filter((part): part is string => typeof part === "string")
        .some((part) => part.toLowerCase().includes(needle)),
    );
  }, [options, query]);

  // Reset the query on close; focus the search field and preselect the current
  // value when opening.
  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // Keep the active index inside the filtered range.
  useEffect(() => {
    setActive((index) => (filtered.length === 0 ? 0 : Math.min(index, filtered.length - 1)));
  }, [filtered.length]);

  // A pointer-down anywhere outside the picker dismisses the popover.
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
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  // Keep the highlighted option scrolled into view.
  useEffect(() => {
    if (!open) {
      return;
    }
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (node !== null && node !== undefined && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "nearest" });
    }
  }, [open, active]);

  function openPicker() {
    const index = options.findIndex((option) => option.value === value);
    setActive(index >= 0 ? index : 0);
    setOpen(true);
  }

  function choose(option: ComboboxOption | undefined) {
    if (option === undefined || option.disabled === true) {
      return;
    }
    onChange(option.value);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className={cn("relative flex flex-col gap-1.5", className)}>
      {label !== undefined && (
        <label htmlFor={triggerId} className="text-[12px] font-medium text-text-muted">
          {label}
        </label>
      )}
      <button
        id={triggerId}
        type="button"
        aria-label={label === undefined ? ariaLabel : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openPicker())}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            openPicker();
          }
        }}
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-[8px] border bg-surface-3 px-2.5 text-left text-[13px] text-text transition disabled:opacity-50",
          open ? "border-accent" : "border-border hover:border-text-muted/40",
        )}
      >
        {selected?.leading !== undefined && (
          <span className="flex h-4 w-4 items-center justify-center text-text-muted">
            {selected.leading}
          </span>
        )}
        <span
          className={cn("min-w-0 flex-1 truncate", selected === undefined && "text-text-muted")}
        >
          {selected?.label ?? placeholder ?? "Select…"}
        </span>
        <Icon
          name="chevron-down"
          size={14}
          className={cn("shrink-0 text-text-muted transition-transform", open && "-rotate-180")}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 animate-pop-in overflow-hidden rounded-[10px] border border-border bg-surface-2 shadow-2xl shadow-black/25">
          <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
            <Icon name="search" size={14} className="shrink-0 text-text-muted" />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-label={label !== undefined ? `${label} search` : (ariaLabel ?? "Search")}
              aria-activedescendant={
                filtered.length > 0 ? optionId(Math.min(active, filtered.length - 1)) : undefined
              }
              value={query}
              placeholder={searchPlaceholder}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActive((index) => Math.min(index + 1, filtered.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((index) => Math.max(index - 1, 0));
                } else if (event.key === "Home") {
                  event.preventDefault();
                  setActive(0);
                } else if (event.key === "End") {
                  event.preventDefault();
                  setActive(filtered.length - 1);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  choose(filtered[active]);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(false);
                } else if (event.key === "Tab") {
                  setOpen(false);
                }
              }}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-text placeholder:text-text-muted focus:outline-none"
            />
          </div>
          <div
            id={listId}
            ref={listRef}
            role="listbox"
            aria-label={label ?? ariaLabel ?? "Options"}
            className="max-h-[240px] overflow-y-auto p-1"
          >
            {filtered.length === 0 ? (
              <div className="px-2.5 py-2 text-[12px] text-text-muted">{emptyMessage}</div>
            ) : (
              filtered.map((option, index) => (
                // biome-ignore lint/a11y/useKeyWithClickEvents: the search input owns keyboard handling
                <div
                  key={option.value}
                  id={optionId(index)}
                  role="option"
                  tabIndex={-1}
                  data-index={index}
                  aria-selected={option.value === value}
                  aria-disabled={option.disabled === true}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(option)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-left text-[13px]",
                    index === active && "bg-surface-3",
                    option.disabled === true && "cursor-not-allowed opacity-50",
                  )}
                >
                  {option.leading !== undefined && (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-text-muted">
                      {option.leading}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-text">{option.label}</span>
                    {option.description !== undefined && (
                      <span className="block truncate text-[11px] text-text-muted">
                        {option.description}
                      </span>
                    )}
                  </span>
                  {option.value === value && (
                    <Icon name="check" size={14} className="shrink-0 text-accent" />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
