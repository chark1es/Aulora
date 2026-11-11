import type { RefObject } from "react";
import type { TextInputInstance } from "react-native";
import type { Fn } from "../../lib/function-type";
import type { ComposerAttachMenuProps } from "./ComposerAttachMenu";
import type { ComposerInputRowProps } from "./ComposerInputRow";
import type { ComposerNoticesProps } from "./ComposerNotices";
import type { useSuggestionLayout } from "./ComposerSuggestions";
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
  readonly inputRef: RefObject<TextInputInstance | null>;
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

export function buildNotices(ctx: ComposerContext): ComposerNoticesProps {
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
}

export function buildInputRow(ctx: ComposerContext): ComposerInputRowProps {
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
      ctx.setMenuOpen(true);
    },
    onSend: ctx.send,
  };
}

export function buildAttachMenu(ctx: ComposerContext): ComposerAttachMenuProps {
  return {
    visible: ctx.menuOpen,
    onClose: () => {
      ctx.setMenuOpen(false);
    },
    onPick: (option) => {
      ctx.setMenuOpen(false);
      void ctx.attach.pick(option);
    },
  };
}
