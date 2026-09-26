import type { ReactNode } from "react";
import { Pressable, type PressableProps } from "react-native";
import { cn } from "./cn";
import { type ButtonSize, type ButtonVariant, iconButtonClass } from "./variants";

export interface IconButtonProps extends Omit<PressableProps, "children"> {
  /** Required accessible name; rendered as `accessibilityLabel`. */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

/** Square pill-shaped button for a single icon. Always labeled for a11y. */
export function IconButton({
  label,
  variant = "ghost",
  size = "md",
  className,
  children,
  disabled,
  ...rest
}: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled === true }}
      disabled={disabled}
      className={cn(
        iconButtonClass({ variant, size, disabled: disabled === true, className: className ?? "" }),
      )}
      {...rest}
    >
      {children}
    </Pressable>
  );
}
