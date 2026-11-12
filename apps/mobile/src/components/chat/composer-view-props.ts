import type { Fn } from "../../lib/function-type";
import { dismissKeyboard } from "../../lib/keyboard";
import { messageLimitError } from "../../lib/message-limits";
import type { ComposerAttachMenuProps } from "./ComposerAttachMenu";
import type { ComposerInputRowProps } from "./ComposerInputRow";
import type { ComposerNoticesProps } from "./ComposerNotices";
import type { useSuggestionLayout } from "./ComposerSuggestions";
import type { ComposerInputRef } from "./composer-input-ref";
import type { ComposerProps } from "./composer-props";
import type { useComposerAttachments } from "./use-composer-attachments";
import type { useComposerTyping } from "./use-composer-typing";
import type { useMentionHint } from "./use-mention-hint";
import { insertMention, type MentionCandidate } from "./use-mention-suggestions";

/** What the composer's hooks produced for one render, before it is split by view part. */
export interface ComposerContext {
  readonly props: ComposerProps;
  readonly value: string;
  readonly error: string | null;
  readonly menuOpen: boolean;
  readonly limitError: string | null;
  readonly canSend: boolean;
  readonly suggestions: readonly MentionCandidate[];
  readonly inputRef: ComposerInputRef;
  /** Whether the input had focus when the attach menu opened. */
  readonly menuFocus: { current: boolean };
  readonly hint: ReturnType<typeof useMentionHint>;
  readonly typing: ReturnType<typeof useComposerTyping>;
  readonly attach: ReturnType<typeof useComposerAttachments>;
  readonly layout: ReturnType<typeof useSuggestionLayout>;
  readonly setError: Fn<[message: string | null], void>;
  readonly setMenuOpen: Fn<[open: boolean], void>;
  readonly send: Fn<[], void>;
  /** Replaces the draft, easing the mention hint row in or out. */
  readonly edit: Fn<[next: string], void>;
}

const hasPreviewSyntax = (value: string) =>
  value.includes("**") ||
  value.includes("\x60") ||
  /(^|\s)[*_]/.test(value) ||
  /https?:\/\//.test(value) ||
  value.includes("#");

export const buildNotices = (ctx: ComposerContext): ComposerNoticesProps => {
  const { props, value, attach, layout } = ctx;
  const draft = value.trim();
  return {
    error: ctx.error,
    onDismissError: () => {
      ctx.setError(null);
    },
    files: attach.files,
    onRemoveFile: (key) => {
      attach.setFiles((current) => current.filter((entry) => entry.key !== key));
    },
    mentionHint: ctx.hint.mentionHint,
    suggestions: {
      suggestions: ctx.suggestions,
      rowHeights: layout.rowHeights,
      stackDetail: layout.stackDetail,
      onMeasure: layout.measure,
      onSelect: (candidate) => {
        ctx.edit(insertMention(value, candidate));
      },
    },
    preview:
      hasPreviewSyntax(value) && draft.length > 0
        ? {
            text: value,
            mentionNames: (props.members ?? []).map((member) => member.displayName),
            channelNames: (props.channels ?? []).map((channel) => channel.name),
            viewerName: props.viewerName ?? "You",
          }
        : null,
    limitError: ctx.limitError,
    textLength: draft.length,
  };
};

export const buildInputRow = (ctx: ComposerContext): ComposerInputRowProps => {
  const { props, attach, typing } = ctx;
  return {
    inputRef: ctx.inputRef,
    placeholder: props.placeholder ?? "Message",
    disabled: props.disabled ?? false,
    attachBusy: attach.busy,
    value: ctx.value,
    canSend: ctx.canSend,
    limitError: ctx.limitError,
    onChangeText: (next) => {
      ctx.edit(next);
      if (next.length > 0) typing.ping(props.channelId);
    },
    onBlur: () => {
      typing.stop(props.channelId);
    },
    onAttach: () => {
      // Drop the keyboard before the sheet opens; otherwise the sheet's
      // "restore" blur behavior brings it back after an attachment is picked
      // and it covers the composer. Remember whether the person was typing so
      // cancelling the sheet can put the caret back.
      ctx.menuFocus.current = ctx.inputRef.current?.isFocused() === true;
      dismissKeyboard();
      ctx.setMenuOpen(true);
    },
    onSend: ctx.send,
  };
};

export const buildAttachMenu = (ctx: ComposerContext): ComposerAttachMenuProps => {
  return {
    visible: ctx.menuOpen,
    onClose: () => {
      const restoreFocus = ctx.menuFocus.current;
      ctx.menuFocus.current = false;
      ctx.setMenuOpen(false);
      // Cancelling the sheet returns the person to the message they were
      // typing. A picked file deliberately leaves the keyboard down for the
      // picker, so only a cancel restores it.
      if (restoreFocus) ctx.inputRef.current?.focus();
    },
    onPick: (option) => {
      // The picker takes over the screen; reopening the keyboard after it
      // closes would cover the composer while the file uploads.
      ctx.menuFocus.current = false;
      dismissKeyboard();
      ctx.setMenuOpen(false);
      void ctx.attach.pick(option);
    },
  };
};

/** The composer's hook results for one render. */
export interface ComposerParts {
  readonly props: ComposerProps;
  readonly value: string;
  readonly setValue: Fn<[next: string], void>;
  readonly error: string | null;
  readonly setError: Fn<[message: string | null], void>;
  readonly menuOpen: boolean;
  readonly setMenuOpen: Fn<[open: boolean], void>;
  readonly inputRef: ComposerInputRef;
  /** Whether the input had focus when the attach menu opened. */
  readonly menuFocus: { current: boolean };
  readonly hint: ReturnType<typeof useMentionHint>;
  readonly typing: ReturnType<typeof useComposerTyping>;
  readonly attach: ReturnType<typeof useComposerAttachments>;
  readonly suggestions: readonly MentionCandidate[];
  readonly layout: ReturnType<typeof useSuggestionLayout>;
  readonly sending: boolean;
  readonly send: Fn<[confirmed?: boolean], void>;
}

/** Derives what the view needs from the hook results and splits it by view part. */
export function composeViews(parts: ComposerParts) {
  const { value, attach, sending, hint } = parts;
  const limitError = messageLimitError(value.trim(), attach.files.length);
  const hasContent = value.trim().length > 0 || attach.files.length > 0;
  const context: ComposerContext = {
    ...parts,
    limitError,
    canSend: limitError === null && parts.props.disabled !== true && !sending && hasContent,
    send: () => {
      parts.send();
    },
    edit: (next) => {
      hint.easeHintFor(next);
      parts.setValue(next);
    },
  };
  return {
    notices: buildNotices(context),
    inputRow: buildInputRow(context),
    attachMenu: buildAttachMenu(context),
  };
}
