import { Pressable, View } from "react-native";
import { Icon } from "./Icon";
import { Text } from "./Text";
import { usePalette } from "./theme";

export interface ErrorBannerProps {
  readonly message: string;
  /** Shows the dismiss affordance when given. */
  readonly onDismiss?: (() => void) | undefined;
}

/** A one-line failure strip in the danger tone, dismissable when asked. */
export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  const palette = usePalette();
  return (
    <View
      accessibilityRole="alert"
      className="flex-row items-center gap-2 border-b border-border px-4 py-2"
      style={{ backgroundColor: `${palette.danger}1F` }}
    >
      <Text size="sm" tone="danger" className="flex-1">
        {message}
      </Text>
      {onDismiss !== undefined && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss error"
          hitSlop={10}
          onPress={onDismiss}
        >
          <Icon name="x" size={18} color={palette.danger} />
        </Pressable>
      )}
    </View>
  );
}
