import { Button, Heading, usePalette } from "@aulora/ui-native";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeVars } from "../../lib/theme";
import { useReduceMotion } from "../../lib/use-entrance";

/**
 * A single task with native iOS swipe dismissal and an explicit way out. A form
 * leaves without saving through Cancel on the leading edge; a sheet that only
 * shows something closes with Done on the trailing edge.
 */
export function Sheet({
  visible,
  title,
  dismiss = "cancel",
  onClose,
  children,
  footer,
  swipeToClose = true,
}: {
  readonly visible: boolean;
  readonly title: string;
  readonly dismiss?: "cancel" | "done";
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Pinned under the content, above the keyboard. */
  readonly footer?: ReactNode;
  /** Turn off while there is unsaved work, so a stray swipe cannot drop it. */
  readonly swipeToClose?: boolean;
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
          <View className="flex-row items-center border-b border-border px-2 py-1">
            <View className="w-24 items-start">
              {dismiss === "cancel" && (
                <Button variant="ghost" onPress={onClose}>
                  Cancel
                </Button>
              )}
            </View>
            <Heading
              level={3}
              className="min-w-0 flex-1 text-center"
              numberOfLines={1}
              maxFontSizeMultiplier={1.6}
            >
              {title}
            </Heading>
            <View className="w-24 items-end">
              {dismiss === "done" && (
                <Button variant="ghost" onPress={onClose}>
                  Done
                </Button>
              )}
            </View>
          </View>
          {children}
          {footer}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
