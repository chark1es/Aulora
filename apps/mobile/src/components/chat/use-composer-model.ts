import { useEffect, useRef, useState } from "react";
import type { TextInputInstance } from "react-native";
import type { Fn } from "../../lib/function-type";
import { messageLimitError } from "../../lib/message-limits";
import { useSuggestionLayout } from "./ComposerSuggestions";
import type { ComposerProps } from "./composer-props";
import {
  buildAttachMenu,
  buildInputRow,
  buildNotices,
  type ComposerContext,
} from "./composer-view-props";
import { useComposerAttachments } from "./use-composer-attachments";
import { useComposerSend } from "./use-composer-send";
import { useComposerTyping } from "./use-composer-typing";
import { DEFAULT_MASS_MENTION_HINT, useMentionHint } from "./use-mention-hint";
import { useMentionSuggestions } from "./use-mention-suggestions";

interface DraftLifecycle {
  readonly channelId: string;
  readonly seed: ComposerProps["seed"];
  readonly setValue: Fn<[next: string], void>;
  readonly resetFiles: Fn<[], void>;
  readonly stopTyping: Fn<[channelId: string], void>;
  readonly inputRef: { readonly current: TextInputInstance | null };
}

/** A new channel starts an empty draft; a suggested first message lands in it and takes focus. */
function useDraftLifecycle(input: DraftLifecycle) {
  const { channelId, seed, setValue, resetFiles, stopTyping, inputRef } = input;
  useEffect(() => {
    setValue("");
    resetFiles();
    return () => {
      // Leaving the channel (or unmounting) drops its typing indicator.
      stopTyping(channelId);
    };
  }, [channelId, setValue, resetFiles, stopTyping]);
  const seedToken = seed?.token;
  const seedText = seed?.text;
  useEffect(() => {
    if (seedToken === undefined) return;
    setValue(seedText ?? "");
    inputRef.current?.focus();
  }, [seedToken, seedText, setValue, inputRef]);
}

/** All composer state and handlers, grouped by the part of the view that uses them. */
export function useComposerModel(props: ComposerProps) {
  const { channelId, disabled = false, members = [], channels = [], roles = [] } = props;
  const canMentionEveryone = props.canMentionEveryone ?? false;
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<TextInputInstance>(null);
  const hint = useMentionHint({
    value,
    channelId,
    canMentionEveryone,
    mentionMarkers: props.mentionMarkers ?? false,
    massMentionHint: props.massMentionHint ?? DEFAULT_MASS_MENTION_HINT,
  });
  const typing = useComposerTyping(props.onTyping, props.onClearTyping);
  const attach = useComposerAttachments(setError);
  const sources = { canMentionEveryone, members, roles, channels };
  const suggestions = useMentionSuggestions(value, sources);
  const layout = useSuggestionLayout();
  const { sending, send } = useComposerSend({
    channelId,
    value,
    setValue,
    files: attach.files,
    setFiles: attach.setFiles,
    setError,
    canMentionEveryone,
    audienceSize: props.audienceSize ?? 0,
    onSend: props.onSend,
    stopTyping: typing.stop,
  });
  const stopTyping = typing.stop;
  const resetFiles = attach.resetFiles;
  useDraftLifecycle({ channelId, seed: props.seed, setValue, resetFiles, stopTyping, inputRef });

  const limitError = messageLimitError(value.trim(), attach.files.length);
  const hasContent = value.trim().length > 0 || attach.files.length > 0;
  const context: ComposerContext = {
    props,
    value,
    error,
    menuOpen,
    limitError,
    canSend: limitError === null && !disabled && !sending && hasContent,
    suggestions,
    inputRef,
    hint,
    typing,
    attach,
    layout,
    setError,
    setMenuOpen,
    send: () => {
      send();
    },
    edit: (next) => {
      hint.easeHintFor(next);
      setValue(next);
    },
  };
  return {
    notices: buildNotices(context),
    inputRow: buildInputRow(context),
    attachMenu: buildAttachMenu(context),
  };
}
