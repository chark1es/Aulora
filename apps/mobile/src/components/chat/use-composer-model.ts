import { useEffect, useRef, useState } from "react";
import type { Fn } from "../../lib/function-type";
import { useSuggestionLayout } from "./ComposerSuggestions";
import { type ComposerInputRef, useComposerInputRef } from "./composer-input-ref";
import type { ComposerProps } from "./composer-props";
import { composeViews } from "./composer-view-props";
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
  readonly inputRef: ComposerInputRef;
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

/** The composer's own state and the hooks that read it, before sending is wired. */
function useComposerParts(props: ComposerProps) {
  const { channelId, members = [], channels = [], roles = [] } = props;
  const canMentionEveryone = props.canMentionEveryone ?? false;
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useComposerInputRef();
  // Shared between opening and cancelling the attach sheet: the sheet unmounts
  // its handlers every render, so the intent has to live on a ref.
  const menuFocus = useRef(false);
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
  return {
    props,
    value,
    setValue,
    error,
    setError,
    menuOpen,
    setMenuOpen,
    inputRef,
    menuFocus,
    hint,
    typing,
    attach,
    suggestions,
    layout,
  };
}

/** All composer state and handlers, grouped by the part of the view that uses them. */
export function useComposerModel(props: ComposerProps) {
  const parts = useComposerParts(props);
  const { value, setValue, setError, attach, typing, inputRef } = parts;
  const { channelId } = props;
  const { sending, send } = useComposerSend({
    channelId,
    value,
    setValue,
    files: attach.files,
    setFiles: attach.setFiles,
    setError,
    canMentionEveryone: props.canMentionEveryone ?? false,
    audienceSize: props.audienceSize ?? 0,
    onSend: props.onSend,
    stopTyping: typing.stop,
  });
  const resetFiles = attach.resetFiles;
  const stopTyping = typing.stop;
  useDraftLifecycle({ channelId, seed: props.seed, setValue, resetFiles, stopTyping, inputRef });
  return composeViews({ ...parts, sending, send });
}
