import { messageSendError, resolveMentions } from "@aulora/core";
import { type Dispatch, type SetStateAction, useState } from "react";
import { Alert } from "react-native";
import { attachmentUploadErrorMessage } from "../../lib/attachment-errors";
import type { PickedFile } from "../../lib/attachments";
import { remainingComposerFiles } from "../../lib/composer-files";
import type { Fn } from "../../lib/function-type";
import { impactFeedback } from "../../lib/haptics";
import { messageLimitError } from "../../lib/message-limits";
import type { ComposerFile } from "./use-composer-attachments";

/** Audience size above which an @everyone/@here send asks first. */
const MASS_MENTION_CONFIRM_AUDIENCE = 100;

export type ComposerSendHandler = Fn<
  [input: { text: string; files: readonly PickedFile[] }],
  void | Promise<void>
>;

export interface ComposerSendInput {
  readonly channelId: string;
  readonly value: string;
  readonly setValue: Dispatch<SetStateAction<string>>;
  readonly files: readonly ComposerFile[];
  readonly setFiles: Dispatch<SetStateAction<readonly ComposerFile[]>>;
  readonly setError: Fn<[message: string | null], void>;
  readonly canMentionEveryone: boolean;
  readonly audienceSize: number;
  readonly onSend: ComposerSendHandler;
  readonly stopTyping: Fn<[channelId: string], void>;
}

function sendFailure(cause: unknown, hasFiles: boolean) {
  return hasFiles
    ? attachmentUploadErrorMessage(cause, messageSendError(cause))
    : messageSendError(cause);
}

function confirmMassSend(audienceSize: number, onConfirm: Fn<[], void>) {
  Alert.alert(`This will notify about ${audienceSize} people. Send?`, undefined, [
    { text: "Cancel", style: "cancel" },
    { text: "Send", onPress: onConfirm },
  ]);
}

/** Sends the draft; the draft stays visible until the send succeeds. */
export function useComposerSend(input: ComposerSendInput) {
  const { channelId, value, setValue, files, setFiles, setError, onSend, stopTyping } = input;
  const [sending, setSending] = useState(false);

  const dispatch = (text: string) => {
    const snapshot = value;
    const pickedFiles = files;
    setSending(true);
    setError(null);
    impactFeedback();
    stopTyping(channelId);
    // Keep the draft visible until the send succeeds; a rejected send leaves it
    // in place (and shows why) instead of silently discarding the message.
    void Promise.resolve()
      .then(() => onSend({ text, files: pickedFiles.map((entry) => entry.file) }))
      .then(() => {
        setValue((current) => (current === snapshot ? "" : current));
        setFiles((current) => remainingComposerFiles(current, pickedFiles));
      })
      .catch((cause: unknown) => {
        setError(sendFailure(cause, pickedFiles.length > 0));
      })
      .finally(() => {
        setSending(false);
      });
  };

  const send = (confirmed = false) => {
    if (sending) return;
    const text = value.trim();
    if (text.length === 0 && files.length === 0) return;
    const limit = messageLimitError(text, files.length);
    if (limit !== null) {
      setError(limit);
      return;
    }
    const massSend =
      input.canMentionEveryone &&
      input.audienceSize > MASS_MENTION_CONFIRM_AUDIENCE &&
      resolveMentions(text, []).everyone;
    if (!confirmed && massSend) {
      confirmMassSend(input.audienceSize, () => {
        send(true);
      });
      return;
    }
    dispatch(text);
  };
  return { sending, send };
}
