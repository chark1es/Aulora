import { Icon, TextField, usePalette } from "@aulora/ui-native";
import type { RefObject } from "react";
import { Pressable, type TextInputInstance, View } from "react-native";
import type { Fn } from "../../lib/function-type";

export interface ComposerInputRowProps {
  readonly inputRef: RefObject<TextInputInstance | null>;
  readonly placeholder: string;
  readonly disabled: boolean;
  readonly attachBusy: boolean;
  readonly value: string;
  readonly canSend: boolean;
  readonly limitError: string | null;
  readonly onChangeText: Fn<[next: string], void>;
  readonly onBlur: Fn<[], void>;
  readonly onAttach: Fn<[], void>;
  readonly onSend: Fn<[], void>;
}

function AttachButton({
  disabled,
  dimmed,
  onPress,
}: {
  readonly disabled: boolean;
  readonly dimmed: boolean;
  readonly onPress: Fn<[], void>;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Attach"
      disabled={disabled}
      hitSlop={4}
      className={`h-11 w-11 items-center justify-center rounded-pill bg-surface-2 active:opacity-70 ${dimmed ? "opacity-50" : ""}`}
      onPress={onPress}
    >
      <Icon name="plus" size={22} color={palette.text} />
    </Pressable>
  );
}

function SendButton({
  canSend,
  limitError,
  onPress,
}: {
  readonly canSend: boolean;
  readonly limitError: string | null;
  readonly onPress: Fn<[], void>;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Send"
      accessibilityHint={limitError ?? undefined}
      accessibilityState={{ disabled: !canSend }}
      disabled={!canSend}
      hitSlop={4}
      onPress={onPress}
      className={`h-11 w-11 items-center justify-center rounded-pill active:opacity-80 ${canSend ? "bg-accent" : "bg-surface-2"}`}
    >
      <Icon name="send" size={20} color={canSend ? palette["on-accent"] : palette["text-muted"]} />
    </Pressable>
  );
}

/** Attach button, message field and send button. */
export function ComposerInputRow(props: ComposerInputRowProps) {
  const palette = usePalette();
  const { disabled, placeholder } = props;
  return (
    <View className="flex-row items-end gap-2">
      <AttachButton
        disabled={disabled || props.attachBusy}
        dimmed={disabled}
        onPress={props.onAttach}
      />
      <View className="min-h-11 flex-1 justify-center rounded-[22px] border border-border bg-surface-2 px-4 min-w-0">
        <TextField
          maxFontSizeMultiplier={2}
          ref={props.inputRef}
          accessibilityLabel={placeholder}
          placeholder={disabled ? "You can’t send messages here" : placeholder}
          placeholderTextColor={palette["text-muted"]}
          value={props.value}
          multiline
          editable={!disabled}
          onChangeText={props.onChangeText}
          onBlur={props.onBlur}
          className="max-h-32 py-2.5 text-[17px] leading-[22px] text-text"
        />
      </View>
      <SendButton canSend={props.canSend} limitError={props.limitError} onPress={props.onSend} />
    </View>
  );
}
