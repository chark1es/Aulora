/**
 * Pure NativeWind class composers. Kept as plain functions (not inline in the
 * components) so the styling rules are unit-testable on any host without a
 * React Native renderer.
 */

import type { ColorToken, Palette } from "@aulora/tokens";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";
export type InputSize = "md" | "lg";
export type TextTone = "default" | "muted" | "accent" | "secondary" | "danger";
export type TextSize = "xs" | "sm" | "base" | "md" | "lg";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent",
  secondary: "border border-border bg-surface-3",
  ghost: "bg-transparent",
  danger: "bg-danger",
};

const BUTTON_LABEL_CLASSES: Record<ButtonVariant, string> = {
  primary: "text-on-accent",
  secondary: "text-text",
  ghost: "text-text-muted",
  danger: "text-on-accent",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "min-h-8 px-3",
  md: "min-h-10 px-4",
  lg: "min-h-12 px-6",
};

const ICON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-12 w-12",
};

function disabledClass(variant: ButtonVariant): string {
  return variant === "primary" ? "bg-surface-3" : "opacity-50";
}

export function buttonClass(options: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  className?: string;
}): string {
  const variant = options.variant ?? "primary";
  const size = options.size ?? "md";
  return [
    "flex-row items-center justify-center gap-2 rounded-input active:opacity-90",
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
    options.disabled === true ? disabledClass(variant) : "",
    options.className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The label color class that keeps text legible on each button variant. */
export function buttonLabelClass(variant: ButtonVariant = "primary", disabled = false): string {
  if (disabled && variant === "primary") {
    return "text-text-muted";
  }
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
    "items-center justify-center rounded-input active:opacity-90",
    BUTTON_VARIANTS[variant],
    ICON_SIZES[size],
    options.disabled === true ? disabledClass(variant) : "",
    options.className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

const RIPPLE_TOKENS: Record<ButtonVariant, ColorToken> = {
  primary: "on-accent",
  secondary: "text",
  ghost: "accent",
  danger: "on-accent",
};

function withAlpha(hex: string, alpha: number): string {
  const value = hex.startsWith("#") ? hex.slice(1) : hex;
  if (value.length !== 6) {
    return hex;
  }
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/** Translucent Android ripple tint for a button, derived from the palette. */
export function buttonRippleColor(palette: Palette, variant: ButtonVariant = "primary"): string {
  return withAlpha(palette[RIPPLE_TOKENS[variant]], 0.16);
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

/**
 * Field sizing. `md` renders exactly as before (40px box, 14px text). `lg` is
 * the Apple-appropriate 17px text on a >=44pt target, for entry screens where
 * the default body size reads too small. Uses `minHeight` (not a fixed `h-*`)
 * so text still fits at large Dynamic Type.
 */
const INPUT_SIZES: Record<InputSize, string> = {
  md: "h-10 px-3 text-base",
  lg: "min-h-[52px] px-4 py-2.5 text-[17px] leading-6",
};

export function inputClass(
  options: { error?: boolean; size?: InputSize; className?: string } = {},
): string {
  const size = options.size ?? "md";
  return [
    "w-full rounded-input border bg-surface-3 text-text",
    INPUT_SIZES[size],
    options.error === true ? "border-danger" : "border-border",
    options.className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}
