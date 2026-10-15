import { forwardRef } from "react";
import { cn } from "./cn";
import { Icon } from "./Icon";

export type SearchInputSize = "sm" | "md";

export interface SearchInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Accessible name (and the visible placeholder when one is not given). */
  readonly label: string;
  readonly placeholder?: string;
  readonly size?: SearchInputSize;
  readonly disabled?: boolean;
  readonly autoFocus?: boolean;
  readonly className?: string;
  readonly inputClassName?: string;
  readonly onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

const SIZE_CLASSES = new Map<SearchInputSize, string>([
  ["sm", "h-8 pl-8 pr-2.5 text-[13px]"],
  ["md", "h-10 pl-9 pr-3 text-[14px]"],
]);

/**
 * The shared toolbar search field: a magnifier, a quiet placeholder and a
 * clear button once there is a value. Always labelled for assistive tech even
 * though the label is not drawn.
 */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(props, ref) {
    const {
      value,
      onChange,
      label,
      placeholder,
      size = "sm",
      disabled = false,
      autoFocus = false,
      className,
      inputClassName,
      onKeyDown,
    } = props;
    return (
      <div className={cn("relative w-full", className)}>
        <Icon
          name="search"
          size={size === "sm" ? 14 : 15}
          className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2 text-text-muted",
            size === "sm" ? "left-2.5" : "left-3",
          )}
        />
        <input
          ref={ref}
          type="text"
          aria-label={label}
          placeholder={placeholder ?? label}
          value={value}
          disabled={disabled}
          // biome-ignore lint/a11y/noAutofocus: the field opens on request and is ready to type in
          autoFocus={autoFocus}
          onChange={(event) => {
            onChange(event.currentTarget.value);
          }}
          onKeyDown={onKeyDown}
          className={cn(
            "w-full rounded-input border border-border bg-surface-2 text-text placeholder:text-text-muted",
            "transition focus-visible:border-accent focus-visible:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft",
            "disabled:pointer-events-none disabled:opacity-50",
            SIZE_CLASSES.get(size),
            value.length > 0 && "pr-8",
            inputClassName,
          )}
        />
        {value.length > 0 && !disabled && (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            onClick={() => {
              onChange("");
            }}
            className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-[6px] text-text-muted transition hover:bg-surface-3 hover:text-text"
          >
            <Icon name="x" size={13} />
          </button>
        )}
      </div>
    );
  },
);
