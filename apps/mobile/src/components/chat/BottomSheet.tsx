import { Icon, Text, usePalette } from "@aulora/ui-native";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeVars } from "../../lib/theme";
import { useReduceMotion } from "../../lib/use-entrance";

/**
 * A menu or picker that rises from the bottom edge and sizes itself to its
 * content. The chat behind it dims but stays put; drag down, tap outside or use
 * the close button to dismiss. Forms with text fields use {@link Sheet} instead.
 */
export function BottomSheet({
  visible,
  title,
  subtitle,
  header,
  onClose,
  children,
}: {
  readonly visible: boolean;
  readonly title: string;
  readonly subtitle?: string | undefined;
  /** Replaces the plain title row, e.g. with an avatar and name. */
  readonly header?: ReactNode;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const palette = usePalette();
  const theme = useThemeVars();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reducedMotion = useReduceMotion();
  const ref = useRef<BottomSheetModal>(null);
  const open = useRef(false);

  useEffect(() => {
    if (visible === open.current) return;
    open.current = visible;
    if (visible) ref.current?.present();
    else ref.current?.dismiss();
  }, [visible]);

  // Android back closes the sheet rather than whatever is behind it.
  useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      ref.current?.dismiss();
      return true;
    });
    return () => {
      subscription.remove();
    };
  }, [visible]);

  const backdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.5}
        pressBehavior="close"
      />
    ),
    [],
  );

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      maxDynamicContentSize={height - insets.top - 24}
      enablePanDownToClose
      animateOnMount={reducedMotion !== true}
      backdropComponent={backdrop}
      backgroundStyle={{ backgroundColor: palette["surface-1"], borderRadius: 24 }}
      handleIndicatorStyle={{ backgroundColor: palette["surface-3"], width: 40, height: 5 }}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      // The sheet is a container, not one element: expose its rows individually.
      accessible={false}
      onDismiss={() => {
        if (open.current) {
          open.current = false;
          onClose();
        }
      }}
    >
      <BottomSheetScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
      >
        <View style={theme} className="gap-3 px-4">
          <View className="flex-row items-center gap-3 pb-1 pl-1">
            <View className="min-w-0 flex-1">
              {header ?? (
                <>
                  <Text
                    size="lg"
                    className="font-semibold"
                    numberOfLines={1}
                    accessibilityRole="header"
                    maxFontSizeMultiplier={1.6}
                  >
                    {title}
                  </Text>
                  {subtitle !== undefined && subtitle.length > 0 && (
                    <Text size="xs" tone="muted" numberOfLines={1}>
                      {subtitle}
                    </Text>
                  )}
                </>
              )}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Close ${title}`}
              hitSlop={10}
              onPress={() => ref.current?.dismiss()}
              className="h-8 w-8 items-center justify-center rounded-pill bg-surface-3 active:opacity-70"
            >
              <Icon name="x" size={16} color={palette["text-muted"]} />
            </Pressable>
          </View>
          {children}
        </View>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

/**
 * Keeps the last non-null value so a sheet can finish its closing animation
 * with its content still on screen after the caller clears the selection.
 */
export function useLingering<T>(value: T | null): T | null {
  const [last, setLast] = useState(value);
  useEffect(() => {
    if (value !== null) setLast(value);
  }, [value]);
  return value ?? last;
}
