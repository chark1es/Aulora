import type { IconName } from "@aulora/tokens";
import type { ReactNode } from "react";
import { View } from "react-native";
import { cn } from "./cn";
import { Heading } from "./Heading";
import { Icon } from "./Icon";
import { Text } from "./Text";
import { usePalette } from "./theme";

export interface EmptyStateProps {
  /**
   * Optional glyph that names the subject. Rendered small and monochrome;
   * leave it out when it only decorates the copy.
   */
  readonly icon?: IconName;
  readonly title: string;
  readonly message?: string | undefined;
  /** Compact supporting content: two or three facts, steps or an example. */
  readonly details?: ReactNode;
  /**
   * Follow the screen's reading edge (default) or centre inside a centred
   * canvas.
   */
  readonly align?: "start" | "center";
  /** A primary action, or any content under the message. */
  readonly children?: ReactNode;
}

/**
 * The shared "nothing here yet" panel: a title, one concrete sentence, an
 * optional compact explanation and the way forward. No decorative glyph tile.
 */
export function EmptyState({
  icon,
  title,
  message,
  details,
  align = "start",
  children,
}: EmptyStateProps) {
  const palette = usePalette();
  const centered = align === "center";
  return (
    <View
      className={cn(
        "flex-1 justify-center gap-1.5 px-8 py-8",
        centered ? "items-center" : "items-start",
      )}
    >
      {icon !== undefined && <Icon name={icon} size={20} color={palette["text-muted"]} />}
      <Heading
        level={3}
        accessibilityRole="header"
        {...(centered ? { className: "text-center" } : {})}
      >
        {title}
      </Heading>
      {message !== undefined && message.length > 0 && (
        <Text size="sm" tone="muted" {...(centered ? { className: "text-center" } : {})}>
          {message}
        </Text>
      )}
      {details !== undefined && <View className="mt-3 w-full">{details}</View>}
      {children !== undefined && (
        <View className={cn("mt-3 gap-2", centered ? "items-center" : "items-start")}>
          {children}
        </View>
      )}
    </View>
  );
}
