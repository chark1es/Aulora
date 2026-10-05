import { useAction, useMutation, useQuery } from "convex/react";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import type { PickedFile } from "../../lib/attachments";
import type { CardEditor } from "./use-card-editor";

interface StoredFile {
  readonly id: string;
  readonly url: string | null;
  readonly name: string | null;
}

/** A name that is safe to write into the cache directory. */
function safeName(name: string | null): string {
  const cleaned = (name ?? "attachment")
    .replace(/[^\p{L}\p{N} ._-]/gu, "_")
    .replace(/^\.+/, "")
    .slice(0, 160);
  return cleaned === "" ? "attachment" : cleaned;
}

/** Writes the downloaded bytes to the cache and returns where they are. */
function cacheFile(file: StoredFile, bytes: ArrayBuffer): string {
  const directory = new Directory(
    Paths.cache,
    "shared-attachments",
    file.id.replace(/[^a-zA-Z0-9_-]/g, "_"),
  );
  directory.create({ idempotent: true, intermediates: true });
  const target = new File(directory, safeName(file.name));
  target.write(new Uint8Array(bytes));
  return target.uri;
}

/** The card's attachments: listing, adding, removing and handing to the share sheet. */
export function useCardFiles(editor: CardEditor) {
  const { card, board } = editor;
  const attach = useMutation(api.kanban.attachFile);
  const uploadUrl = useMutation(api.files.generateUploadUrl);
  const finalize = useAction(api.files.finalize);
  const downloadFile = useAction(api.files.download);
  const files = useQuery(api.files.getMany, { fileIds: card.fileIds });

  const upload = (picked: readonly PickedFile[]) => {
    const file = picked.at(0);
    if (file === undefined) return;
    void editor.run(async () => {
      const bytes = await (await fetch(file.uri)).arrayBuffer();
      const response = await fetch(await uploadUrl({}), {
        method: "POST",
        headers: { "Content-Type": file.mime },
        body: bytes,
      });
      if (!response.ok) throw new Error("Upload failed. Try again.");
      const { storageId } = (await response.json()) as { storageId: string };
      const fileId = await finalize({
        storageId: storageId as never,
        name: file.name,
        mime: file.mime,
        kanbanBoardId: board.id,
      });
      await attach({ cardId: card._id, fileId });
    });
  };

  const share = (file: StoredFile) => {
    void editor.run(async () => {
      const grant = /[?&]token=([^&]+)/.exec(file.url ?? "")?.at(1) ?? "";
      if (grant.length === 0)
        throw new Error("Download link expired. Reopen the card to refresh it.");
      if (!(await Sharing.isAvailableAsync()))
        throw new Error("File sharing is unavailable on this device.");
      const { bytes } = await downloadFile({ token: decodeURIComponent(grant) });
      await Sharing.shareAsync(cacheFile(file, bytes), {
        dialogTitle: file.name ?? "Attachment",
      });
    });
  };

  const remove = (fileId: string) => {
    void editor.run(() => attach({ cardId: card._id, fileId: fileId as never, remove: true }));
  };

  return { files, upload, share, remove };
}

export type CardFiles = ReturnType<typeof useCardFiles>;
