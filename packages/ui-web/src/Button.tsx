import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";
import { cn } from "./cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows the particle spinner and blocks interaction. */
  loading?: boolean;
  /** Optional leading icon/element. */
  leading?: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:brightness-110 active:brightness-95",
  secondary: "border border-border bg-surface-2 text-text hover:bg-surface-3",
  ghost: "bg-transparent text-text-muted hover:bg-surface-3 hover:text-text",
  danger: "bg-danger text-on-accent hover:brightness-110 active:brightness-95",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-7 gap-1.5 rounded-[7px] px-2.5 text-[13px]",
  md: "h-9 gap-2 rounded-input px-3.5 text-[13px]",
  lg: "h-11 gap-2 rounded-input px-5 text-[14px]",
};

/** Soft-cornered action button. Focus rings use the Ember accent. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    leading,
    className,
    children,
    disabled,
    type = "button",
    ...rest
  },
  ref,
) {
  const isDisabled = disabled === true || loading;
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex select-none items-center justify-center font-medium transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span aria-hidden="true">
          <Spinner size={size === "lg" ? 18 : 14} label="Loading" />
        </span>
      ) : (
        leading
      )}
      {children}
    </button>
  );
});
