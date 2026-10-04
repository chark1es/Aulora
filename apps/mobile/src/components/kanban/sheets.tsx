/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { IconName } from "@aulora/tokens";
import { Heading, Icon, Text, usePalette } from "@aulora/ui-native";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
} from "react";
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeVars } from "../../lib/theme";
import { useReduceMotion } from "../../lib/use-entrance";

/** Closes the sheet with its exit animation, then runs the follow-up. */
type Close = (then?: () => void) => void;
function closeNothing(): void {
  // Outside a sheet there is nothing to close.
}
const CloseContext = createContext<Close>(closeNothing);
export const useSheetClose = () => useContext(CloseContext);

/** Drives the slide: 0 is off screen, 1 is open. */
function useSheetMotion(onClose: () => void) {
  const reduced = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  // Read through a ref so `close` keeps one identity and rows can stay memoised.
  const latest = useRef(onClose);
  latest.current = onClose;
  // Starts before the first paint so the sheet never sits still on screen.
  useLayoutEffect(() => {
    if (reduced === null) return;
    Animated.timing(progress, {
      toValue: 1,
      duration: reduced ? 0 : 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, reduced]);
  const close = useCallback<Close>(
    (then) => {
      if (closing.current) return;
      closing.current = true;
      Animated.timing(progress, {
        toValue: 0,
        duration: reduced === true ? 0 : 160,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        latest.current();
        then?.();
      });
    },
    [progress, reduced],
  );
  return { progress, close };
}

/**
 * A panel that slides up from the bottom edge over a dimmed screen. It is a
 * plain modal, so unlike the chat's bottom sheet it can open above a page
 * sheet. It closes on a backdrop tap or the Android back button.
 */
export function BottomSheet({
  title,
  onClose,
  children,
  footer,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  const theme = useThemeVars();
  const insets = useSafeAreaInsets();
  const { progress, close } = useSheetMotion(onClose);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [420, 0] });
  const dismiss = () => {
    close();
  };
  return (
    <Modal visible transparent animationType="none" onRequestClose={dismiss}>
      <KeyboardAvoidingView
        style={[{ flex: 1 }, theme]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Animated.View
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, opacity: progress }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Close ${title}`}
            className="flex-1 bg-black/50"
            onPress={dismiss}
          />
        </Animated.View>
        <View className="flex-1 justify-end" pointerEvents="box-none">
          <Animated.View
            accessibilityViewIsModal
            className="max-h-[85%] rounded-t-card bg-surface-2"
            style={{ paddingBottom: Math.max(insets.bottom, 12), transform: [{ translateY }] }}
          >
            <View className="items-center pt-2">
              <View className="h-1 w-9 rounded-pill bg-surface-3" />
            </View>
            <Heading level={3} className="px-5 pb-2 pt-3" numberOfLines={1}>
              {title}
            </Heading>
            <CloseContext.Provider value={close}>
              {children}
              {footer !== undefined && (
                <View className="flex-row gap-2 border-t border-border px-4 pt-3">{footer}</View>
              )}
            </CloseContext.Provider>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export interface SheetAction {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  /** Small text under the label, e.g. why the action is unavailable. */
  readonly hint?: string;
  /** Starts a new group with a hairline and optional caption. */
  readonly section?: string | true;
  readonly onPress: () => void;
}

/** The touch counterpart of a right-click menu: a list of things to do. */
export function ActionSheet({
  title,
  actions,
  onClose,
}: {
  readonly title: string;
  readonly actions: readonly SheetAction[];
  readonly onClose: () => void;
}) {
  return (
    <BottomSheet title={title} onClose={onClose}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 4 }}>
        {actions.map((action) => (
          <ActionRow key={action.id} action={action} />
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

function ActionSection({ caption }: { readonly caption: string | true }) {
  return (
    <View className="mx-3 mt-1 border-t border-border pt-1">
      {caption !== true && (
        <Text size="xs" tone="muted" className="pb-1 pt-2 font-semibold uppercase">
          {caption}
        </Text>
      )}
    </View>
  );
}

function ActionRow({ action }: { readonly action: SheetAction }) {
  const palette = usePalette();
  const close = useSheetClose();
  const danger = action.danger === true;
  const color = danger ? palette.danger : palette.text;
  return (
    <>
      {action.section !== undefined && <ActionSection caption={action.section} />}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: action.disabled === true }}
        disabled={action.disabled}
        className={`min-h-12 flex-row items-center gap-3 rounded-input px-3 py-2 active:bg-surface-3 ${
          action.disabled === true ? "opacity-40" : ""
        }`}
        onPress={() => {
          close(action.onPress);
        }}
      >
        {action.icon !== undefined && (
          <Icon name={action.icon} size={20} color={danger ? color : palette["text-muted"]} />
        )}
        <View className="min-w-0 flex-1">
          <Text style={{ color }} numberOfLines={1}>
            {action.label}
          </Text>
          {action.hint !== undefined && (
            <Text size="xs" tone="muted">
              {action.hint}
            </Text>
          )}
        </View>
      </Pressable>
    </>
  );
}

export function SearchField({
  value,
  onChange,
  label,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly label: string;
}) {
  const palette = usePalette();
  return (
    <View className="mx-4 mb-2 min-h-11 flex-row items-center gap-2 rounded-input border border-border bg-surface-3 px-3">
      <Icon name="search" size={18} color={palette["text-muted"]} />
      <TextInput
        accessibilityLabel={label}
        placeholder={label}
        placeholderTextColor={palette["text-muted"]}
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
        className="min-h-11 flex-1 text-[17px] text-text"
      />
    </View>
  );
}
