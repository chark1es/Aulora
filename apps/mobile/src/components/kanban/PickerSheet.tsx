/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, Icon, Text, usePalette } from "@aulora/ui-native";
import { type ReactNode, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { CheckBox } from "./parts";
import { BottomSheet, SearchField, useSheetClose } from "./sheets";

export interface PickerOption {
  readonly id: string;
  readonly label: string;
  readonly leading?: ReactNode;
  readonly hint?: string;
  readonly disabled?: boolean;
}

export interface PickerSheetProps {
  readonly title: string;
  readonly options: readonly PickerOption[];
  readonly selected: readonly string[];
  readonly onChange: (selected: string[]) => void;
  readonly onClose: () => void;
  /** Every row is a checkbox and the sheet stays open until Done. */
  readonly multiple?: boolean;
  /** Shows a filter field once the list is long; meant for people. */
  readonly searchPlaceholder?: string;
  readonly emptyText?: string;
}

/** The selection after a row is pressed. */
function nextSelection(selected: readonly string[], id: string, multiple: boolean): string[] {
  if (!multiple) return [id];
  return selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id];
}

/**
 * A checklist of options. With `multiple` every row is a checkbox and the
 * sheet stays open; otherwise choosing a row closes it.
 */
export function PickerSheet(props: PickerSheetProps) {
  const { title, options, selected, onChange, onClose, searchPlaceholder } = props;
  const multiple = props.multiple === true;
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = options.filter((option) => option.label.toLowerCase().includes(needle));
  const footer = multiple ? <PickerFooter selected={selected} onChange={onChange} /> : undefined;
  return (
    <BottomSheet title={title} onClose={onClose} footer={footer}>
      {searchPlaceholder !== undefined && options.length > 6 && (
        <SearchField value={query} onChange={setQuery} label={searchPlaceholder} />
      )}
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
            onPress={() => {
              onChange(nextSelection(selected, option.id, multiple));
            }}
          />
        ))}
        {visible.length === 0 && (
          <Text size="sm" tone="muted" className="px-3 py-6 text-center">
            {options.length > 0 ? "No matches" : (props.emptyText ?? "Nothing to choose from")}
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
  const disabled = option.disabled === true;
  return (
    <Pressable
      accessibilityRole={multiple ? "checkbox" : "radio"}
      accessibilityLabel={option.label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      className={`min-h-12 flex-row items-center gap-3 rounded-input px-3 py-2 active:bg-surface-3 ${
        disabled ? "opacity-40" : ""
      }`}
      onPress={() => {
        if (multiple) onPress();
        else close(onPress);
      }}
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
  selected,
  onChange,
}: {
  readonly selected: readonly string[];
  readonly onChange: (selected: string[]) => void;
}) {
  const close = useSheetClose();
  return (
    <>
      <Button
        variant="ghost"
        disabled={selected.length === 0}
        onPress={() => {
          onChange([]);
        }}
      >
        Clear
      </Button>
      <Button
        className="flex-1"
        onPress={() => {
          close();
        }}
      >
        {selected.length > 0 ? `Done (${selected.length})` : "Done"}
      </Button>
    </>
  );
}
