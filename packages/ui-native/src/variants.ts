/**
 * Pure NativeWind class composers. Kept as plain functions (not inline in the
 * components) so the styling rules are unit-testable on any host without a
 * React Native renderer.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";
export type TextTone = "default" | "muted" | "accent" | "secondary" | "danger";
export type TextSize = "xs" | "sm" | "base" | "md" | "lg";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent",
  secondary: "border border-border bg-surface-3",
  ghost: "bg-transparent",
  danger: "bg-danger",
};

const BUTTON_LABEL_CLASSES: Record<ButtonVariant, string> = {
  primary: "text-bg",
  secondary: "text-text",
  ghost: "text-text-muted",
  danger: "text-bg",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3",
  md: "h-10 px-4",
  lg: "h-12 px-6",
};

const ICON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-12 w-12",
};

export function buttonClass(options: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  className?: string;
}): string {
  const variant = options.variant ?? "primary";
  const size = options.size ?? "md";
  return [
    "flex-row items-center justify-center gap-2 rounded-pill",
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
    options.disabled ? "opacity-50" : "",
    options.className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The label color class that keeps text legible on each button variant. */
export function buttonLabelClass(variant: ButtonVariant = "primary"): string {
  return BUTTON_LABEL_CLASSES[variant];
}

export function iconButtonClass(options: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  className?: string;
}): string {
  const variant = options.variant ?? "ghost";
  const size = options.size ?? "md";
  return [
    "items-center justify-center rounded-pill",
    BUTTON_VARIANTS[variant],
    ICON_SIZES[size],
    options.disabled ? "opacity-50" : "",
    options.className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

const TONE_CLASSES: Record<TextTone, string> = {
  default: "text-text",
  muted: "text-text-muted",
  accent: "text-accent",
  secondary: "text-secondary",
  danger: "text-danger",
};

const SIZE_CLASSES: Record<TextSize, string> = {
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
  md: "text-md",
  lg: "text-lg",
};

export function textClass(options: {
  tone?: TextTone;
  size?: TextSize;
  mono?: boolean;
  className?: string;
}): string {
  const tone = options.tone ?? "default";
  const size = options.size ?? "base";
  return [
    TONE_CLASSES[tone],
    SIZE_CLASSES[size],
    options.mono ? "font-mono" : "",
    options.className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function inputClass(options: { error?: boolean; className?: string } = {}): string {
  return [
    "h-10 w-full rounded-input border bg-surface-3 px-3 text-base text-text",
    options.error === true ? "border-danger" : "border-border",
    options.className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}
