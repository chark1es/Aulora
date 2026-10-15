import { forwardRef, type TextareaHTMLAttributes, useId } from "react";
import { cn } from "./cn";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Visible field label; wired to the control with `htmlFor`. */
  label: string;
  /** Optional helper text shown below the field. */
  hint?: string;
  /** Error message; switches the field to an error state. */
  error?: string;
  /** Hides the visible label when a surrounding section already labels the field. */
  hideLabel?: boolean;
}

/**
 * Multi-line text field with the same label/helper/error anatomy as
 * {@link Input}, a hairline border and the accent focus ring.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, hideLabel = false, className, id, ...rest },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = hint !== undefined ? `${fieldId}-hint` : undefined;
  const errorId = error !== undefined ? `${fieldId}-error` : undefined;
  const describedBy = [hintId, errorId].filter((value): value is string => value !== undefined);

  return (
    <div className="flex w-full flex-col gap-1.5">
      {hideLabel ? null : (
        <label htmlFor={fieldId} className="text-[13px] font-medium text-text-muted">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={fieldId}
        aria-label={hideLabel ? label : undefined}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={describedBy.length > 0 ? describedBy.join(" ") : undefined}
        className={cn(
          "w-full resize-y rounded-input border bg-surface-3 px-3 py-2 text-[14px] leading-snug text-text placeholder:text-text-muted",
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
