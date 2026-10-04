import type { IconName } from "@aulora/tokens";
import { Button, Heading, Icon, Text, usePalette } from "@aulora/ui-native";
import {
  createContext,
  memo,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
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
import { formatDay, localDay, monthGrid, monthName } from "../../lib/kanban";
import { useThemeVars } from "../../lib/theme";
import { useReduceMotion } from "../../lib/use-entrance";
import { CheckBox } from "./parts";

/** Closes the sheet with its exit animation, then runs the follow-up. */
type Close = (then?: () => void) => void;
const CloseContext = createContext<Close>(() => {});
export const useSheetClose = () => useContext(CloseContext);

/**
 * A panel that slides up from the bottom edge over a dimmed screen. It closes
 * on a backdrop tap or the Android back button.
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
        duration: reduced ? 0 : 160,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        latest.current();
        then?.();
      });
    },
    [progress, reduced],
  );
  return (
    <Modal visible transparent animationType="none" onRequestClose={() => close()}>
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
            onPress={() => close()}
          />
        </Animated.View>
        <View className="flex-1 justify-end" pointerEvents="box-none">
          <Animated.View
            accessibilityViewIsModal
            className="max-h-[85%] rounded-t-card bg-surface-2"
            style={{
              paddingBottom: Math.max(insets.bottom, 12),
              transform: [
                {
                  translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }),
                },
              ],
            }}
          >
            <View className="items-center pt-2">
              <View className="h-1 w-9 rounded-pill bg-surface-3" />
            </View>
            <Heading level={3} className="px-5 pb-2 pt-3" numberOfLines={1}>
              {title}
            </Heading>
            <CloseContext.Provider value={close}>{children}</CloseContext.Provider>
            {footer !== undefined && (
              <CloseContext.Provider value={close}>
                <View className="flex-row gap-2 border-t border-border px-4 pt-3">{footer}</View>
              </CloseContext.Provider>
            )}
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

function ActionRow({ action }: { readonly action: SheetAction }) {
  const palette = usePalette();
  const close = useSheetClose();
  const color = action.danger ? palette.danger : palette.text;
  return (
    <>
      {action.section !== undefined && (
        <View className="mx-3 mt-1 border-t border-border pt-1">
          {typeof action.section === "string" && (
            <Text size="xs" tone="muted" className="pb-1 pt-2 font-semibold uppercase">
              {action.section}
            </Text>
          )}
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: action.disabled === true }}
        disabled={action.disabled}
        className={`min-h-12 flex-row items-center gap-3 rounded-input px-3 py-2 active:bg-surface-3 ${
          action.disabled ? "opacity-40" : ""
        }`}
        onPress={() => close(action.onPress)}
      >
        {action.icon !== undefined && (
          <Icon
            name={action.icon}
            size={20}
            color={action.danger ? color : palette["text-muted"]}
          />
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

export interface PickerOption {
  readonly id: string;
  readonly label: string;
  readonly leading?: ReactNode;
  readonly hint?: string;
  readonly disabled?: boolean;
}

/**
 * A checklist of options. With `multiple` every row is a checkbox and the
 * sheet stays open; otherwise choosing a row closes it.
 */
export function PickerSheet({
  title,
  options,
  selected,
  onChange,
  onClose,
  multiple = false,
  searchPlaceholder,
  emptyText = "Nothing to choose from",
}: {
  readonly title: string;
  readonly options: readonly PickerOption[];
  readonly selected: readonly string[];
  readonly onChange: (selected: string[]) => void;
  readonly onClose: () => void;
  readonly multiple?: boolean;
  /** Shows a filter field once the list is long; meant for people. */
  readonly searchPlaceholder?: string;
  readonly emptyText?: string;
}) {
  const [query, setQuery] = useState("");
  const searchable = searchPlaceholder !== undefined && options.length > 6;
  const visible = options.filter((option) =>
    option.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <BottomSheet
      title={title}
      onClose={onClose}
      {...(multiple
        ? {
            footer: (
              <PickerFooter
                count={selected.length}
                onClear={selected.length ? () => onChange([]) : undefined}
              />
            ),
          }
        : {})}
    >
      {searchable && <SearchField value={query} onChange={setQuery} label={searchPlaceholder} />}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 8 }}
      >
        {visible.map((option) => (
          <PickerRow
            key={option.id}
            option={option}
            checked={selected.includes(option.id)}
            multiple={multiple}
            onPress={() =>
              onChange(
                multiple
                  ? selected.includes(option.id)
                    ? selected.filter((id) => id !== option.id)
                    : [...selected, option.id]
                  : [option.id],
              )
            }
          />
        ))}
        {visible.length === 0 && (
          <Text size="sm" tone="muted" className="px-3 py-6 text-center">
            {options.length ? "No matches" : emptyText}
          </Text>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

function PickerRow({
  option,
  checked,
  multiple,
  onPress,
}: {
  readonly option: PickerOption;
  readonly checked: boolean;
  readonly multiple: boolean;
  readonly onPress: () => void;
}) {
  const palette = usePalette();
  const close = useSheetClose();
  return (
    <Pressable
      accessibilityRole={multiple ? "checkbox" : "radio"}
      accessibilityLabel={option.label}
      accessibilityState={{ checked, disabled: option.disabled === true }}
      disabled={option.disabled}
      className={`min-h-12 flex-row items-center gap-3 rounded-input px-3 py-2 active:bg-surface-3 ${
        option.disabled ? "opacity-40" : ""
      }`}
      onPress={() => (multiple ? onPress() : close(onPress))}
    >
      {multiple && <CheckBox checked={checked} />}
      {option.leading}
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1}>{option.label}</Text>
        {option.hint !== undefined && (
          <Text size="xs" tone="muted">
            {option.hint}
          </Text>
        )}
      </View>
      {!multiple && checked && <Icon name="check" size={20} color={palette.accent} />}
    </Pressable>
  );
}

function PickerFooter({
  count,
  onClear,
}: {
  readonly count: number;
  readonly onClear: (() => void) | undefined;
}) {
  const close = useSheetClose();
  return (
    <>
      <Button variant="ghost" disabled={onClear === undefined} onPress={() => onClear?.()}>
        Clear
      </Button>
      <Button className="flex-1" onPress={() => close()}>
        {count ? `Done (${count})` : "Done"}
      </Button>
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

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/** Picks a calendar day: shortcuts for the common answers, a month for the rest. */
export function DateSheet({
  title,
  value,
  now,
  onChange,
  onClose,
}: {
  readonly title: string;
  /** `YYYY-MM-DD`, or empty when no day is set. */
  readonly value: string;
  readonly now: number;
  readonly onChange: (day: string) => void;
  readonly onClose: () => void;
}) {
  const palette = usePalette();
  const today = localDay(now);
  const [shown, setShown] = useState(() => (value || today).slice(0, 7));
  const year = Number(shown.slice(0, 4));
  const month = Number(shown.slice(5, 7)) - 1;
  const step = (by: number) =>
    setShown(new Date(Date.UTC(year, month + by, 1)).toISOString().slice(0, 7));
  const latest = useRef(onChange);
  latest.current = onChange;
  const pick = useCallback((day: string) => latest.current(day), []);
  return (
    <BottomSheet title={title} onClose={onClose}>
      <View className="gap-3 px-4 pb-2">
        <View className="flex-row flex-wrap gap-2">
          {(
            [
              ["Today", 0],
              ["Tomorrow", 1],
              ["In a week", 7],
            ] as const
          ).map(([label, offset]) => (
            <DayShortcut
              key={label}
              label={label}
              onPress={() => onChange(localDay(now, offset))}
            />
          ))}
          {value !== "" && <DayShortcut label="No date" onPress={() => onChange("")} />}
        </View>
        <View className="flex-row items-center">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            className="h-11 w-11 items-center justify-center rounded-input active:bg-surface-3"
            onPress={() => step(-1)}
          >
            <Icon name="chevron-left" size={20} color={palette.text} />
          </Pressable>
          <Text className="flex-1 text-center font-semibold">
            {monthName(month)} {year}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next month"
            className="h-11 w-11 items-center justify-center rounded-input active:bg-surface-3"
            onPress={() => step(1)}
          >
            <Icon name="chevron-right" size={20} color={palette.text} />
          </Pressable>
        </View>
        <View className="flex-row">
          {WEEKDAYS.map((day, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: weekday letters repeat and never reorder
            <Text key={index} size="xs" tone="muted" className="flex-1 text-center">
              {day}
            </Text>
          ))}
        </View>
        <View className="flex-row flex-wrap">
          {monthGrid(year, month).map((day) => (
            <DayCell
              key={day}
              day={day}
              outside={day.slice(0, 7) !== shown}
              today={day === today}
              selected={day === value}
              onPick={pick}
            />
          ))}
        </View>
      </View>
    </BottomSheet>
  );
}

function DayShortcut({ label, onPress }: { readonly label: string; readonly onPress: () => void }) {
  const close = useSheetClose();
  return (
    <Pressable
      accessibilityRole="button"
      className="min-h-10 justify-center rounded-pill border border-border bg-surface-3 px-4 active:opacity-70"
      onPress={() => close(onPress)}
    >
      <Text size="sm">{label}</Text>
    </Pressable>
  );
}

const DayCell = memo(function DayCell({
  day,
  outside,
  today,
  selected,
  onPick,
}: {
  readonly day: string;
  readonly outside: boolean;
  readonly today: boolean;
  readonly selected: boolean;
  readonly onPick: (day: string) => void;
}) {
  const palette = usePalette();
  const close = useSheetClose();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={formatDay(day)}
      accessibilityState={{ selected }}
      className="h-11 w-[14.28%] items-center justify-center"
      onPress={() => close(() => onPick(day))}
    >
      <View
        className={`h-9 w-9 items-center justify-center rounded-pill ${
          selected ? "bg-accent" : today ? "border border-accent" : ""
        }`}
      >
        <Text
          size="sm"
          style={{
            color: selected ? palette["on-accent"] : outside ? palette["text-muted"] : palette.text,
            opacity: outside && !selected ? 0.5 : 1,
          }}
        >
          {Number(day.slice(8))}
        </Text>
      </View>
    </Pressable>
  );
});
