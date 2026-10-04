import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import type { CardEditor } from "./use-card-editor";

interface StoredFile {
  id: string;
  url: string;
  name?: string | null;
}

/** Hands the browser a file to save under the given name. */
function saveAs(bytes: ArrayBuffer, name: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

/** The card's attachments: listing, adding, removing and downloading. */
export function useCardFiles(editor: CardEditor) {
  const { card, board } = editor;
  const client = useConvex();
  const attach = useMutation(api.kanban.attachFile);
  const uploadUrl = useMutation(api.files.generateUploadUrl);
  const finalize = useAction(api.files.finalize);
  const downloadFile = useAction(api.files.download);
  const files = useQuery(api.files.getMany, { fileIds: card.fileIds });

  const download = (file: StoredFile) => {
    void editor.run(async () => {
      const grant = new URL(file.url, window.location.origin).searchParams.get("token") ?? "";
      if (grant.length === 0)
        throw new Error("Download link expired. Reopen the card to refresh it.");
      const { bytes } = await downloadFile({ token: grant });
      saveAs(bytes, file.name ?? "attachment");
    });
  };

  const upload = (file: File) => {
    void editor.run(async () => {
      const url = new URL(await uploadUrl({}));
      // Self-hosted storage may advertise its internal origin. Use the
      // same public backend origin as queries, including the Docker proxy.
      const target = /^\/api\/storage\/upload(?:\/|$)/.test(url.pathname)
        ? new URL(`${url.pathname}${url.search}`, client.url).href
        : url.href;
      const mime = file.type || "application/octet-stream";
      const response = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": mime },
        body: file,
      });
      if (!response.ok) throw new Error("Upload failed. Try again.");
      const { storageId } = (await response.json()) as { storageId: string };
      const fileId = await finalize({
        storageId: storageId as never,
        name: file.name,
        mime,
        kanbanBoardId: board.id,
      });
      await attach({ cardId: card._id, fileId });
    }, "Attachment added");
  };

  const remove = (fileId: string) => {
    void editor.run(() => attach({ cardId: card._id, fileId: fileId as never, remove: true }));
  };

  return { files, download, upload, remove };
}

export type CardFiles = ReturnType<typeof useCardFiles>;
