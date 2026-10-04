import { Button, Heading, usePalette } from "@aulora/ui-native";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeVars } from "../../lib/theme";
import { useReduceMotion } from "../../lib/use-entrance";

/** A single task with native iOS swipe dismissal and an explicit way out. */
export function Sheet({
  visible,
  title,
  onClose,
  children,
  footer,
  swipeToClose = true,
  closeLabel = "Done",
}: {
  readonly visible: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Pinned under the content, above the keyboard. */
  readonly footer?: ReactNode;
  /** Turn off while there is unsaved work, so a stray swipe cannot drop it. */
  readonly swipeToClose?: boolean;
  readonly closeLabel?: string;
}) {
  const palette = usePalette();
  const theme = useThemeVars();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReduceMotion();
  return (
    <Modal
      visible={visible}
      presentationStyle="pageSheet"
      animationType={reducedMotion === false ? "slide" : "none"}
      allowSwipeDismissal={swipeToClose}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: palette["surface-1"] }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View
          accessibilityViewIsModal
          className="flex-1 bg-surface-1"
          style={[
            theme,
            {
              paddingTop: Platform.OS === "ios" ? 12 : insets.top,
              paddingBottom: insets.bottom,
            },
          ]}
        >
          <View className="flex-row items-center justify-between gap-3 border-b border-border px-4 py-2">
            <Heading
              level={3}
              className="min-w-0 flex-1"
              numberOfLines={2}
              maxFontSizeMultiplier={2}
            >
              {title}
            </Heading>
            <Button variant="ghost" onPress={onClose}>
              {closeLabel}
            </Button>
          </View>
          {children}
          {footer}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
