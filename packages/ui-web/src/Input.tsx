import { forwardRef, type InputHTMLAttributes, type ReactNode, useId } from "react";
import { cn } from "./cn";

export type InputSize = "md" | "lg";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Visible field label; wired to the input with `htmlFor`. */
  label: string;
  /** Optional helper text shown below the field. */
  hint?: string;
  /** Error message; switches the field to an error state. */
  error?: string;
  /** Control height and text size. `md` (default) is unchanged; `lg` is taller. */
  size?: InputSize;
  /** Decorative element rendered inside the field, at the start. */
  leading?: ReactNode;
  /** Element rendered inside the field, at the end (for example a paste button). */
  trailing?: ReactNode;
}

const SIZE_CLASSES = new Map<InputSize, string>([
  ["md", "h-10 px-3 text-[14px]"],
  ["lg", "h-12 px-3.5 text-[17px]"],
]);

const LEADING_PADDING = "2.5rem";
const TRAILING_PADDING = "5rem";

/** Text input with a 10px radius, hairline border and accent focus ring. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, size = "md", leading, trailing, className, id, style, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint !== undefined ? `${inputId}-hint` : undefined;
  const errorId = error !== undefined ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter((value): value is string => value !== undefined);
  const inset =
    leading !== undefined || trailing !== undefined
      ? {
          ...(leading !== undefined ? { paddingLeft: LEADING_PADDING } : {}),
          ...(trailing !== undefined ? { paddingRight: TRAILING_PADDING } : {}),
        }
      : undefined;

  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={inputId} className="text-[13px] font-medium text-text-muted">
        {label}
      </label>
      <div className="relative w-full">
        {leading !== undefined && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-text-muted"
          >
            {leading}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error !== undefined || undefined}
          aria-describedby={describedBy.length > 0 ? describedBy.join(" ") : undefined}
          style={{ ...style, ...inset }}
          className={cn(
            "w-full rounded-input border bg-surface-3 text-text placeholder:text-text-muted",
            SIZE_CLASSES.get(size),
            "transition focus-visible:border-accent focus-visible:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft",
            "disabled:pointer-events-none disabled:opacity-50",
            error !== undefined ? "border-danger" : "border-border",
            className,
          )}
          {...rest}
        />
        {trailing !== undefined && (
          <span className="absolute inset-y-0 right-1.5 flex items-center">{trailing}</span>
        )}
      </div>
      {hint !== undefined && (
        <p id={hintId} className="text-xs text-text-muted">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
});
