import type { ViewProps } from "react-native";
import { View } from "react-native";
import { cn } from "./cn";

export interface CardProps extends ViewProps {
  /** Slightly stronger surface for the focused/active state. */
  elevated?: boolean;
}

/** Soft 20px-radius surface with a hairline border, mirroring ui-web's Card. */
export function Card({ elevated = false, className, ...rest }: CardProps) {
  return (
    <View
      className={cn(
        "rounded-card border border-border bg-surface-2 p-5",
        elevated ? "bg-surface-3" : "",
        className ?? "",
      )}
      {...rest}
    />
  );
}
