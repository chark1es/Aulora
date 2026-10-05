import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";
import { cn } from "./cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows the particle spinner and blocks interaction. */
  loading?: boolean;
  /** Optional leading icon/element. */
  leading?: ReactNode;
}

const VARIANT_CLASSES = new Map<ButtonVariant, string>([
  [
    "primary",
    "bg-accent text-on-accent hover:brightness-110 active:brightness-95 disabled:bg-surface-3 disabled:text-text-muted disabled:opacity-100",
  ],
  [
    "secondary",
    "border border-border bg-surface-2 text-text hover:bg-surface-3 disabled:opacity-50",
  ],
  [
    "ghost",
    "bg-transparent text-text-muted hover:bg-surface-3 hover:text-text disabled:opacity-50",
  ],
  [
    "danger",
    "bg-danger text-on-accent hover:brightness-110 active:brightness-95 disabled:opacity-50",
  ],
  [
    "success",
    "bg-secondary text-on-accent hover:brightness-110 active:brightness-95 disabled:opacity-50",
  ],
]);

const SIZE_CLASSES = new Map<ButtonSize, string>([
  ["sm", "h-7 gap-1.5 rounded-[7px] px-2.5 text-[13px]"],
  ["md", "h-9 gap-2 rounded-input px-3.5 text-[13px]"],
  ["lg", "h-11 gap-2 rounded-input px-5 text-[14px]"],
]);

/** Soft-cornered action button. Focus rings use the Ember accent. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const {
    variant = "primary",
    size = "md",
    loading = false,
    leading,
    className,
    children,
    disabled,
    type = "button",
    ...rest
  } = props;
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
        "disabled:pointer-events-none",
        VARIANT_CLASSES.get(variant),
        SIZE_CLASSES.get(size),
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
