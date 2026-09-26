import { type ReactNode, useCallback } from "react";
import { ActivityIndicator, Pressable, type PressableProps } from "react-native";
import { cn } from "./cn";
import { Text } from "./Text";
import { usePalette } from "./theme";
import { type ButtonSize, type ButtonVariant, buttonClass, buttonLabelClass } from "./variants";

export interface ButtonProps extends Omit<PressableProps, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows the spinner and blocks interaction. */
  loading?: boolean;
  /** Optional leading icon/element. */
  leading?: ReactNode;
  children?: ReactNode;
}

/** Pill-shaped action button. Mirrors the ui-web Button visuals. */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  leading,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled === true || loading;
  const palette = usePalette();
  const spinnerColor = variant === "primary" || variant === "danger" ? palette.bg : palette.accent;
  const render = useCallback(
    () => (
      <>
        {loading ? <ActivityIndicator size="small" color={spinnerColor} /> : leading}
        {typeof children === "string" ? (
          <Text size="sm" className={cn(buttonLabelClass(variant), "font-medium")}>
            {children}
          </Text>
        ) : (
          children
        )}
      </>
    ),
    [loading, leading, children, variant, spinnerColor],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      className={cn(
        buttonClass({ variant, size, disabled: isDisabled, className: className ?? "" }),
      )}
      {...rest}
    >
      {render()}
    </Pressable>
  );
}
