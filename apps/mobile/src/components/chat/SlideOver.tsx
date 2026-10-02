import { Text, usePalette } from "@aulora/ui-native";
import { type ReactNode, useCallback, useEffect } from "react";
import { BackHandler, Keyboard, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { dismissKeyboard } from "../../lib/keyboard";
import { RoundButton } from "./HubPane";

const TIMING = { duration: 260, easing: Easing.out(Easing.cubic) } as const;

/**
 * A full-screen page that slides in from the right over the chat, for a task
 * that needs the keyboard and the whole height (a thread). Swipe right or use
 * the back button to return.
 */
export function SlideOver({
  title,
  subtitle,
  onClose,
  children,
}: {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const offset = useSharedValue(width);
  const origin = useSharedValue(0);

  useEffect(() => {
    offset.value = withTiming(0, TIMING);
  }, [offset]);

  const close = useCallback(() => {
    Keyboard.dismiss();
    offset.value = withTiming(width, TIMING, (finished) => {
      if (finished === true) scheduleOnRN(onClose);
    });
  }, [offset, width, onClose]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => {
      subscription.remove();
    };
  }, [close]);

  const pan = Gesture.Pan()
    .activeOffsetX(14)
    .failOffsetY([-12, 12])
    .onStart(() => {
      // Anchor to where the page is, so a drag begun mid-animation does not jump.
      origin.value = offset.value;
      scheduleOnRN(dismissKeyboard);
    })
    .onUpdate((event) => {
      offset.value = Math.max(0, origin.value + event.translationX);
    })
    .onEnd((event) => {
      if (event.velocityX > 520 || origin.value + event.translationX > width * 0.35) {
        offset.value = withTiming(width, TIMING, (finished) => {
          if (finished === true) scheduleOnRN(onClose);
        });
      } else {
        offset.value = withTiming(0, TIMING);
      }
    });

  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View accessibilityViewIsModal style={[StyleSheet.absoluteFill, slide]}>
        <KeyboardAvoidingView
          behavior="padding"
          keyboardVerticalOffset={-insets.bottom}
          style={{ flex: 1, backgroundColor: palette.bg, paddingTop: insets.top }}
        >
          <View className="flex-row items-center gap-3 border-b border-border px-3 pb-2 pt-1">
            <RoundButton icon="chevron-left" label="Back" onPress={close} />
            <View className="min-w-0 flex-1">
              <Text
                className="font-semibold"
                numberOfLines={1}
                accessibilityRole="header"
                maxFontSizeMultiplier={1.5}
              >
                {title}
              </Text>
              {subtitle !== undefined && subtitle.length > 0 && (
                <Text size="xs" tone="muted" numberOfLines={1}>
                  {subtitle}
                </Text>
              )}
            </View>
          </View>
          {children}
        </KeyboardAvoidingView>
      </Animated.View>
    </GestureDetector>
  );
}
