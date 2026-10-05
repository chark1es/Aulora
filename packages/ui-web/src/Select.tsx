import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "./cn";
import { Icon } from "./Icon";

export interface SelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly description?: string;
  readonly leading?: React.ReactNode;
}

export interface SelectProps<T extends string> {
  readonly label?: string;
  readonly value: T;
  readonly options: readonly SelectOption<T>[];
  readonly onChange: (value: T) => void;
  readonly placeholder?: string;
  readonly className?: string;
  readonly id?: string;
}

/**
 * A listbox-styled select built from a button and a popover, so the closed
 * control matches the rest of the app's chrome instead of the OS menu. Fully
 * keyboard driven: Up/Down/Home/End move, Enter selects, Escape closes.
 */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder,
  className,
  id,
}: SelectProps<T>) {
  const generatedId = useId();
  const buttonId = id ?? generatedId;
  const listId = `${buttonId}-listbox`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);

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
            "flex h-9 w-full items-center gap-2 rounded-[8px] border bg-surface-3 px-2.5 text-left text-[13px] text-text transition",
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
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, options.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              } else if (event.key === "Home") {
                event.preventDefault();
                setActive(0);
              } else if (event.key === "End") {
                event.preventDefault();
                setActive(options.length - 1);
              } else if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                const option = options.at(active);
                if (option !== undefined) {
                  onChange(option.value);
                  setOpen(false);
                }
              } else if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
              }
            }}
            className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 animate-pop-in overflow-hidden rounded-[10px] border border-border bg-surface-2 p-1 shadow-2xl shadow-black/25"
          >
            {options.map((option, index) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox handles keys
              <div
                key={option.value}
                role="option"
                tabIndex={-1}
                aria-selected={option.value === value}
                onMouseEnter={() => {
                  setActive(index);
                }}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-left text-[13px]",
                  index === active ? "bg-surface-3" : "",
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
                {option.value === value && <Icon name="check" size={14} className="text-accent" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
