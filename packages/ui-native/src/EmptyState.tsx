import type { IconName } from "@aulora/tokens";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Heading } from "./Heading";
import { Icon } from "./Icon";
import { Text } from "./Text";
import { usePalette } from "./theme";

export interface EmptyStateProps {
  readonly icon: IconName;
  readonly title: string;
  readonly message?: string | undefined;
  /** A primary action, or any content under the message. */
  readonly children?: ReactNode;
}

/**
 * The shared "nothing here yet" panel: a tinted glyph, a heading, one sentence
 * and an optional action. Centred inside whatever space it is given.
 */
export function EmptyState({ icon, title, message, children }: EmptyStateProps) {
  const palette = usePalette();
  return (
    <View className="flex-1 items-center justify-center gap-3 px-8">
      <View className="h-16 w-16 items-center justify-center rounded-card bg-accent-soft">
        <Icon name={icon} size={32} color={palette.accent} />
      </View>
      <Heading level={3} className="text-center">
        {title}
      </Heading>
      {message !== undefined && message.length > 0 && (
        <Text size="sm" tone="muted" className="text-center">
          {message}
        </Text>
      )}
      {children}
    </View>
  );
}
