import { cn, Icon } from "@aulora/ui-web";
import {
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Callback } from "./callbacks";

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
  readonly onChange: Callback<[value: string]>;
  readonly label?: string;
  readonly placeholder?: string;
  readonly searchPlaceholder?: string;
  readonly emptyMessage?: string;
  readonly className?: string;
  readonly id?: string;
  readonly disabled?: boolean;
  readonly "aria-label"?: string;
}

function useFilteredOptions(
  options: readonly ComboboxOption[],
  query: string,
): readonly ComboboxOption[] {
  return useMemo(() => {
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
}

/** Reset the query on close; focus the search field when opening. */
function useOpenEffects(
  open: boolean,
  inputRef: RefObject<HTMLInputElement | null>,
  setQuery: Callback<[query: string]>,
): void {
  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [open, inputRef, setQuery]);
}

/** Keep the active index inside the filtered range. */
function useActiveInRange(length: number, setActive: Dispatch<SetStateAction<number>>): void {
  useEffect(() => {
    setActive((index) => (length === 0 ? 0 : Math.min(index, length - 1)));
  }, [length, setActive]);
}

/** A pointer-down anywhere outside the picker dismisses the popover. */
function useDismissOnOutside(
  open: boolean,
  rootRef: RefObject<HTMLDivElement | null>,
  setOpen: Dispatch<SetStateAction<boolean>>,
): void {
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
  }, [open, rootRef, setOpen]);
}

/** Keep the highlighted option scrolled into view. */
function useScrollActiveIntoView(
  open: boolean,
  active: number,
  listRef: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    if (!open) {
      return;
    }
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (node !== null && node !== undefined && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "nearest" });
    }
  }, [open, active, listRef]);
}

/**
 * A type-to-filter picker: a button that opens a popover with a search input
 * and a listbox. Typing filters options live; Up/Down/Home/End move the active
 * option, Enter selects it, Escape closes the popover and a pointer-down
 * outside dismisses it. It deliberately avoids the native `<select>` so roles
 * and members can be shown with color and context.
 */
export function Combobox(props: ComboboxProps) {
  const {
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
  } = props;
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
  const filtered = useFilteredOptions(options, query);

  useOpenEffects(open, inputRef, setQuery);
  useActiveInRange(filtered.length, setActive);
  useDismissOnOutside(open, rootRef, setOpen);
  useScrollActiveIntoView(open, active, listRef);

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
      <ComboboxTrigger
        triggerId={triggerId}
        label={label}
        ariaLabel={ariaLabel}
        open={open}
        disabled={disabled}
        selected={selected}
        placeholder={placeholder}
        listId={listId}
        onToggle={() => {
          setOpen(false);
        }}
        onOpenPicker={openPicker}
      />

      {open && (
        <ComboboxPopover
          listId={listId}
          label={label}
          ariaLabel={ariaLabel}
          emptyMessage={emptyMessage}
          searchPlaceholder={searchPlaceholder}
          query={query}
          onQueryChange={setQuery}
          filtered={filtered}
          active={active}
          setActive={setActive}
          value={value}
          optionId={optionId}
          onChoose={choose}
          onClose={() => {
            setOpen(false);
          }}
          inputRef={inputRef}
          listRef={listRef}
        />
      )}
    </div>
  );
}

interface ComboboxTriggerProps {
  readonly triggerId: string;
  readonly label?: string | undefined;
  readonly ariaLabel?: string | undefined;
  readonly open: boolean;
  readonly disabled: boolean;
  readonly selected: ComboboxOption | undefined;
  readonly placeholder?: string | undefined;
  readonly listId: string;
  readonly onToggle: () => void;
  readonly onOpenPicker: () => void;
}

function ComboboxTrigger(props: ComboboxTriggerProps) {
  const {
    triggerId,
    label,
    ariaLabel,
    open,
    disabled,
    selected,
    placeholder,
    listId,
    onToggle,
    onOpenPicker,
  } = props;
  return (
    <button
      id={triggerId}
      type="button"
      aria-label={label === undefined ? ariaLabel : undefined}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      disabled={disabled}
      onClick={() => {
        if (open) {
          onToggle();
        } else {
          onOpenPicker();
        }
      }}
      onKeyDown={(event) => {
        if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault();
          onOpenPicker();
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
      <span className={cn("min-w-0 flex-1 truncate", selected === undefined && "text-text-muted")}>
        {selected?.label ?? placeholder ?? "Select…"}
      </span>
      <Icon
        name="chevron-down"
        size={14}
        className={cn("shrink-0 text-text-muted transition-transform", open && "-rotate-180")}
      />
    </button>
  );
}

interface ComboboxPopoverProps {
  readonly listId: string;
  readonly label?: string | undefined;
  readonly ariaLabel?: string | undefined;
  readonly emptyMessage: string;
  readonly searchPlaceholder: string;
  readonly query: string;
  readonly onQueryChange: Callback<[value: string]>;
  readonly filtered: readonly ComboboxOption[];
  readonly active: number;
  readonly setActive: Dispatch<SetStateAction<number>>;
  readonly value: string;
  readonly optionId: Callback<[index: number], string>;
  readonly onChoose: Callback<[option: ComboboxOption | undefined]>;
  readonly onClose: () => void;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly listRef: RefObject<HTMLDivElement | null>;
}

function ComboboxPopover(props: ComboboxPopoverProps) {
  const {
    listId,
    label,
    ariaLabel,
    emptyMessage,
    filtered,
    active,
    value,
    optionId,
    setActive,
    onChoose,
    listRef,
  } = props;
  return (
    <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 animate-pop-in overflow-hidden rounded-[10px] border border-border bg-surface-2 shadow-2xl shadow-black/25">
      <ComboboxSearch {...props} />
      <ComboboxListbox
        listId={listId}
        label={label}
        ariaLabel={ariaLabel}
        emptyMessage={emptyMessage}
        filtered={filtered}
        active={active}
        value={value}
        optionId={optionId}
        setActive={setActive}
        onChoose={onChoose}
        listRef={listRef}
      />
    </div>
  );
}

interface ComboboxSearchProps {
  readonly listId: string;
  readonly label?: string | undefined;
  readonly ariaLabel?: string | undefined;
  readonly searchPlaceholder: string;
  readonly query: string;
  readonly onQueryChange: Callback<[value: string]>;
  readonly filtered: readonly ComboboxOption[];
  readonly active: number;
  readonly setActive: Dispatch<SetStateAction<number>>;
  readonly optionId: Callback<[index: number], string>;
  readonly onChoose: Callback<[option: ComboboxOption | undefined]>;
  readonly onClose: () => void;
  readonly inputRef: RefObject<HTMLInputElement | null>;
}

function ComboboxSearch(props: ComboboxSearchProps) {
  const {
    listId,
    label,
    ariaLabel,
    searchPlaceholder,
    query,
    onQueryChange,
    filtered,
    active,
    setActive,
    optionId,
    onChoose,
    onClose,
    inputRef,
  } = props;
  return (
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
          onQueryChange(event.currentTarget.value);
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
            onChoose(filtered.at(active));
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          } else if (event.key === "Tab") {
            onClose();
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-text placeholder:text-text-muted focus:outline-none"
      />
    </div>
  );
}

interface ComboboxListboxProps {
  readonly listId: string;
  readonly label?: string | undefined;
  readonly ariaLabel?: string | undefined;
  readonly emptyMessage: string;
  readonly filtered: readonly ComboboxOption[];
  readonly active: number;
  readonly value: string;
  readonly optionId: Callback<[index: number], string>;
  readonly setActive: Dispatch<SetStateAction<number>>;
  readonly onChoose: Callback<[option: ComboboxOption | undefined]>;
  readonly listRef: RefObject<HTMLDivElement | null>;
}

function ComboboxListbox(props: ComboboxListboxProps) {
  const {
    listId,
    label,
    ariaLabel,
    emptyMessage,
    filtered,
    active,
    value,
    optionId,
    setActive,
    onChoose,
    listRef,
  } = props;
  return (
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
          <ComboboxOptionRow
            key={option.value}
            option={option}
            index={index}
            id={optionId(index)}
            active={index === active}
            selected={option.value === value}
            onActivate={() => {
              setActive(index);
            }}
            onChoose={() => {
              onChoose(option);
            }}
          />
        ))
      )}
    </div>
  );
}

function ComboboxOptionRow({
  option,
  index,
  id,
  active,
  selected,
  onActivate,
  onChoose,
}: {
  readonly option: ComboboxOption;
  readonly index: number;
  readonly id: string;
  readonly active: boolean;
  readonly selected: boolean;
  readonly onActivate: () => void;
  readonly onChoose: () => void;
}) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the search input owns keyboard handling
    <div
      id={id}
      role="option"
      tabIndex={-1}
      data-index={index}
      aria-selected={selected}
      aria-disabled={option.disabled === true}
      onMouseEnter={onActivate}
      onClick={onChoose}
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-left text-[13px]",
        active && "bg-surface-3",
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
          <span className="block truncate text-[11px] text-text-muted">{option.description}</span>
        )}
      </span>
      {selected && <Icon name="check" size={14} className="shrink-0 text-accent" />}
    </div>
  );
}
