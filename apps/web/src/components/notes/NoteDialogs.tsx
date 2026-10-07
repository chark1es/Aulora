import { Button, ConfirmDialog, Input, Modal, Select, type SelectOption } from "@aulora/ui-web";
import { useState } from "react";
import { flattenFolders, type NoteFolder } from "./types";
import type { FolderDialog, NotesController, TagDialog } from "./use-notes";

/** The folder plus everything nested inside it, which cannot become its parent. */
function descendantsOf(folders: readonly NoteFolder[], rootId: string): Set<string> {
  const children = new Map<string, NoteFolder[]>();
  for (const folder of folders) {
    const key = folder.parentId ?? "";
    const list = children.get(key) ?? [];
    list.push(folder);
    children.set(key, list);
  }
  const found = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined) continue;
    for (const child of children.get(id) ?? []) {
      if (!found.has(child.id)) {
        found.add(child.id);
        queue.push(child.id);
      }
    }
  }
  return found;
}

/** Asks before deleting a note, folder or tag. */
function Confirmations({ ctl }: { ctl: NotesController }) {
  const { confirm } = ctl;
  const close = () => {
    ctl.setConfirm(undefined);
  };
  const note = confirm?.kind === "deleteNote" ? confirm.note : undefined;
  const folder = confirm?.kind === "deleteFolder" ? confirm.folder : undefined;
  const tag = confirm?.kind === "deleteTag" ? confirm.tag : undefined;
  return (
    <>
      <ConfirmDialog
        open={note !== undefined}
        onClose={close}
        title="Permanently delete note?"
        description="The note and its revision history will be deleted. This cannot be undone."
        confirmLabel="Delete note"
        variant="danger"
        onConfirm={() => void ctl.confirmDelete()}
      />
      <ConfirmDialog
        open={folder !== undefined}
        onClose={close}
        title="Delete folder?"
        description="The folder must be empty first. Its notes and child folders are not deleted."
        confirmLabel="Delete folder"
        variant="danger"
        onConfirm={() => void ctl.confirmDelete()}
      />
      <ConfirmDialog
        open={tag !== undefined}
        onClose={close}
        title="Delete tag?"
        description="The tag is removed from every note. The notes themselves are kept."
        confirmLabel="Delete tag"
        variant="danger"
        onConfirm={() => void ctl.confirmDelete()}
      />
    </>
  );
}

function FolderDialogForm({ ctl, dialog }: { ctl: NotesController; dialog: FolderDialog }) {
  const folder = dialog.mode === "new" ? undefined : dialog.folder;
  const initialParent = dialog.mode === "new" ? dialog.parentId : (dialog.folder.parentId ?? null);
  const [name, setName] = useState(folder?.name ?? "");
  const [parentId, setParentId] = useState(initialParent ?? "");
  const excluded = folder === undefined ? new Set<string>() : descendantsOf(ctl.folders, folder.id);
  const options: readonly SelectOption<string>[] = [
    { value: "", label: "No folder (root)" },
    ...flattenFolders(ctl.folders)
      .filter((entry) => !excluded.has(entry.folder.id))
      .map(({ folder: entry, depth }) => ({
        value: entry.id,
        label: `${"— ".repeat(depth)}${entry.name}`,
      })),
  ];
  const title =
    dialog.mode === "new"
      ? "New folder"
      : dialog.mode === "rename"
        ? "Rename folder"
        : "Move folder";
  const close = () => {
    ctl.setFolderDialog(undefined);
  };
  const submit = async () => {
    const trimmed = name.trim();
    if (dialog.mode === "new") {
      if (trimmed.length === 0) return;
      await ctl.createFolder(trimmed, parentId === "" ? null : (parentId as NoteFolder["id"]));
    } else if (dialog.mode === "rename") {
      if (trimmed.length === 0) return;
      await ctl.renameFolder(dialog.folder, trimmed);
    } else {
      await ctl.moveFolder(dialog.folder, parentId === "" ? null : (parentId as NoteFolder["id"]));
    }
  };
  return (
    <Modal
      open
      onClose={close}
      label={title}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="notes-folder-form"
            disabled={dialog.mode !== "move" && name.trim().length === 0}
            loading={ctl.busy}
          >
            {dialog.mode === "move"
              ? "Move folder"
              : dialog.mode === "rename"
                ? "Rename folder"
                : "Create folder"}
          </Button>
        </>
      }
    >
      <form
        id="notes-folder-form"
        className="flex flex-col gap-4 pb-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {dialog.mode !== "move" && (
          <Input
            label="Folder name"
            placeholder="e.g. Meeting notes"
            maxLength={80}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        )}
        {dialog.mode !== "rename" && (
          <Select label="Parent folder" value={parentId} options={options} onChange={setParentId} />
        )}
        {ctl.error !== undefined && (
          <p role="alert" className="text-sm text-danger">
            {ctl.error}
          </p>
        )}
      </form>
    </Modal>
  );
}

function TagDialogForm({ ctl, dialog }: { ctl: NotesController; dialog: TagDialog }) {
  const tag = dialog.mode === "edit" ? dialog.tag : undefined;
  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState(tag?.color ?? "#F5A45B");
  const title = dialog.mode === "new" ? "New tag" : "Edit tag";
  const close = () => {
    ctl.setTagDialog(undefined);
  };
  const submit = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    if (dialog.mode === "new") {
      await ctl.createTag(trimmed, color);
    } else {
      await ctl.updateTag(dialog.tag, trimmed, color);
    }
  };
  return (
    <Modal
      open
      onClose={close}
      label={title}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="notes-tag-form"
            disabled={name.trim().length === 0}
            loading={ctl.busy}
          >
            {dialog.mode === "new" ? "Create tag" : "Save tag"}
          </Button>
        </>
      }
    >
      <form
        id="notes-tag-form"
        className="flex flex-col gap-4 pb-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Input
          label="Tag name"
          placeholder="e.g. Ideas"
          maxLength={32}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-text-muted">Color</span>
          <div className="flex items-center gap-3">
            <input
              type="color"
              aria-label="Tag color"
              value={color}
              onChange={(event) => {
                setColor(event.target.value);
              }}
              className="h-9 w-14 cursor-pointer rounded-[8px] border border-border bg-surface-3"
            />
            <span className="font-mono text-[13px] text-text-muted">{color}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-3 px-2.5 py-1 text-[12px] text-text">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
              {name.trim().length > 0 ? name : "Tag"}
            </span>
          </div>
        </div>
        {ctl.error !== undefined && (
          <p role="alert" className="text-sm text-danger">
            {ctl.error}
          </p>
        )}
      </form>
    </Modal>
  );
}

/** Every dialog the Notes view can open: confirmations and the folder/tag forms. */
export function NoteDialogs({ ctl }: { ctl: NotesController }) {
  const folderKey =
    ctl.folderDialog === undefined
      ? ""
      : `${ctl.folderDialog.mode}:${
          ctl.folderDialog.mode === "new"
            ? (ctl.folderDialog.parentId ?? "")
            : ctl.folderDialog.folder.id
        }`;
  const tagKey =
    ctl.tagDialog === undefined
      ? ""
      : `${ctl.tagDialog.mode}:${ctl.tagDialog.mode === "edit" ? ctl.tagDialog.tag.id : ""}`;
  return (
    <>
      <Confirmations ctl={ctl} />
      {ctl.folderDialog !== undefined && (
        <FolderDialogForm key={folderKey} ctl={ctl} dialog={ctl.folderDialog} />
      )}
      {ctl.tagDialog !== undefined && (
        <TagDialogForm key={tagKey} ctl={ctl} dialog={ctl.tagDialog} />
      )}
    </>
  );
}
