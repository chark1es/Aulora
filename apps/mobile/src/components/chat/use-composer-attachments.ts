import type { IconName } from "@aulora/tokens";
import { useCallback, useRef, useState } from "react";
import {
  type PickedFile,
  pickDocuments,
  pickFromCamera,
  pickFromClipboard,
  pickFromLibrary,
} from "../../lib/attachments";
import type { Fn } from "../../lib/function-type";
import { attachmentRoom, MESSAGE_MAX_ATTACHMENTS } from "../../lib/message-limits";

export interface ComposerFile {
  readonly key: string;
  readonly file: PickedFile;
}

export interface AttachOption {
  readonly key: string;
  readonly label: string;
  readonly icon: IconName;
  readonly pick: Fn<[], Promise<readonly PickedFile[]>>;
}

const pickOne = async (pick: Fn<[], Promise<PickedFile | null>>) => {
  const file = await pick();
  return file === null ? [] : [file];
};

export const ATTACH_OPTIONS: readonly AttachOption[] = [
  {
    key: "camera",
    label: "Take a photo",
    icon: "camera",
    pick: () => pickOne(pickFromCamera),
  },
  { key: "photos", label: "Photo library", icon: "image", pick: pickFromLibrary },
  {
    key: "clipboard",
    label: "Paste image from clipboard",
    icon: "image-plus",
    pick: () => pickOne(pickFromClipboard),
  },
  { key: "files", label: "Browse files", icon: "file", pick: pickDocuments },
];

const TOO_MANY = `You can attach at most ${MESSAGE_MAX_ATTACHMENTS} files.`;

/** The files attached to the draft, and picking more through an attach option. */
export function useComposerAttachments(setError: Fn<[message: string | null], void>) {
  const [files, setFiles] = useState<readonly ComposerFile[]>([]);
  const [busy, setBusy] = useState(false);
  const fileSeq = useRef(0);
  const resetFiles = useCallback(() => {
    setFiles([]);
  }, []);

  const add = (picked: readonly PickedFile[]) => {
    const room = attachmentRoom(files.length);
    if (room === 0) {
      setError(TOO_MANY);
      return;
    }
    const accepted = picked.slice(0, room);
    setError(accepted.length < picked.length ? TOO_MANY : null);
    setFiles((current) => [
      ...current,
      ...accepted.map((file) => {
        fileSeq.current += 1;
        return { key: `file-${fileSeq.current}`, file };
      }),
    ]);
  };

  const pick = async (option: AttachOption) => {
    setBusy(true);
    try {
      const picked = await option.pick();
      if (picked.length > 0) add(picked);
    } finally {
      setBusy(false);
    }
  };
  return { files, setFiles, busy, pick, resetFiles };
}
