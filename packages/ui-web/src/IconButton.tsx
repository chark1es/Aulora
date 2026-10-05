import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";
import type { ButtonSize, ButtonVariant } from "./Button";
import { cn } from "./cn";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required accessible name; rendered as `aria-label`. */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

const VARIANT_CLASSES = new Map<ButtonVariant, string>([
  ["primary", "bg-accent text-on-accent hover:brightness-110"],
  ["secondary", "border border-border bg-surface-2 text-text hover:bg-surface-3"],
  ["ghost", "bg-transparent text-text-muted hover:bg-surface-3 hover:text-text"],
  ["danger", "bg-transparent text-text-muted hover:bg-danger/10 hover:text-danger"],
  ["success", "bg-secondary text-on-accent hover:brightness-110"],
]);

const SIZE_CLASSES = new Map<ButtonSize, string>([
  ["sm", "h-7 w-7 rounded-[7px] text-[13px]"],
  ["md", "h-9 w-9 rounded-input text-[14px]"],
  ["lg", "h-11 w-11 rounded-input text-[15px]"],
]);

/** Square soft-cornered button for a single icon. Always labeled for a11y. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = "ghost", size = "md", className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANT_CLASSES.get(variant),
        SIZE_CLASSES.get(size),
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
