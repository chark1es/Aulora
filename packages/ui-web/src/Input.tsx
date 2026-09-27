import { forwardRef, type InputHTMLAttributes, useId } from "react";
import { cn } from "./cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Visible field label; wired to the input with `htmlFor`. */
  label: string;
  /** Optional helper text shown below the field. */
  hint?: string;
  /** Error message; switches the field to an error state. */
  error?: string;
}

/** Text input with a 10px radius, hairline border and accent focus ring. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, className, id, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint !== undefined ? `${inputId}-hint` : undefined;
  const errorId = error !== undefined ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter((value): value is string => value !== undefined);

  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={inputId} className="text-[13px] font-medium text-text-muted">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={describedBy.length > 0 ? describedBy.join(" ") : undefined}
        className={cn(
          "h-10 w-full rounded-input border bg-surface-3 px-3 text-[14px] text-text placeholder:text-text-muted",
          "transition focus-visible:border-accent focus-visible:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft",
          "disabled:pointer-events-none disabled:opacity-50",
          error !== undefined ? "border-danger" : "border-border",
          className,
        )}
        {...rest}
      />
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
