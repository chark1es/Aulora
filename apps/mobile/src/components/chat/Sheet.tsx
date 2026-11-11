import { Button, Heading, usePalette } from "@aulora/ui-native";
import type { ReactNode } from "react";
import { Modal, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useThemeVars } from "../../lib/theme";
import { useReduceMotion } from "../../lib/use-entrance";
import { KeyboardAvoidingPane, useScreenInsets } from "../layout/ScreenContainer";

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
  const reducedMotion = useReduceMotion();
  return (
    <Modal
      visible={visible}
      presentationStyle="pageSheet"
      animationType={reducedMotion === false ? "slide" : "none"}
      allowSwipeDismissal={swipeToClose}
      onRequestClose={onClose}
    >
      <SafeAreaProvider>
        <SheetContent title={title} dismiss={dismiss} onClose={onClose} footer={footer}>
          {children}
        </SheetContent>
      </SafeAreaProvider>
    </Modal>
  );
}

function SheetContent({
  title,
  dismiss,
  onClose,
  children,
  footer,
}: {
  readonly title: string;
  readonly dismiss: "cancel" | "done";
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly footer: ReactNode;
}) {
  const palette = usePalette();
  const theme = useThemeVars();
  const insets = useScreenInsets();
  return (
    <KeyboardAvoidingPane style={{ flex: 1, backgroundColor: palette["surface-1"] }}>
      <View
        accessibilityViewIsModal
        className="flex-1 bg-surface-1 min-w-0"
        style={[
          theme,
          {
            paddingTop: Math.max(insets.top, 12),
            paddingBottom: insets.keyboardBottom,
            paddingLeft: insets.left,
            paddingRight: insets.right,
          },
        ]}
      >
        <View className="flex-row items-center border-b border-border px-2 py-1">
          {/* Action slots keep their label whole at large text; the title gives way. */}
          <View className="max-w-[45%] shrink-0 items-start">
            {dismiss === "cancel" && (
              <Button variant="ghost" onPress={onClose}>
                Cancel
              </Button>
            )}
          </View>
          {/* Centred by its slot, not text-align: Android clipped the first
              glyph of a centred title that also ellipsized ("Vote · Jordan E…"). */}
          <View className="min-w-0 flex-1 items-center">
            <Heading level={3} numberOfLines={1} maxFontSizeMultiplier={1.6}>
              {title}
            </Heading>
          </View>
          <View className="max-w-[45%] shrink-0 items-end">
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
    </KeyboardAvoidingPane>
  );
}
