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

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-bg hover:brightness-105",
  secondary: "border border-border bg-surface-3 text-text hover:bg-surface-2",
  ghost: "bg-transparent text-text-muted hover:bg-surface-3 hover:text-text",
  danger: "bg-danger text-bg hover:brightness-105",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-8 w-8 text-sm",
  md: "h-10 w-10 text-base",
  lg: "h-12 w-12 text-md",
};

/** Square pill-shaped button for a single icon. Always labeled for a11y. */
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
        "inline-flex items-center justify-center rounded-pill transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
