import { Button, cn, Icon } from "@aulora/ui-web";
import { rowAction, Section } from "./card-parts";
import { addButton } from "./controls";
import type { CardEditor } from "./use-card-editor";
import { type CardFiles, useCardFiles } from "./use-card-files";

interface Props {
  editor: CardEditor;
}

/** Repositories, issues and pull requests linked to the card. */
export function CardGithubLinks({ editor }: Props) {
  const { draft } = editor;
  return (
    <Section
      icon="link"
      title="GitHub links"
      aside={
        editor.canEdit && (
          <Button
            variant="ghost"
            size="sm"
            disabled={editor.busy}
            onClick={() => {
              editor.setGithub(true);
            }}
          >
            Link from GitHub
          </Button>
        )
      }
    >
      {draft.githubLinks.map((url) => (
        <div key={url} className="group flex min-h-7 animate-message-in items-center gap-2">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1 break-all text-[13px] text-accent underline-offset-2 hover:underline"
          >
            {url.replace("https://github.com/", "")}
          </a>
          {editor.canEdit && (
            <button
              type="button"
              disabled={editor.busy}
              aria-label={`Unlink ${url}`}
              className={rowAction}
              onClick={() => {
                editor.setDraft({
                  ...draft,
                  githubLinks: draft.githubLinks.filter((entry) => entry !== url),
                });
              }}
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
      ))}
      {draft.githubLinks.length === 0 && (
        <p className="text-xs text-text-muted">No linked repositories, issues or pull requests.</p>
      )}
    </Section>
  );
}

type StoredFile = NonNullable<CardFiles["files"]>[number];

function FileRow({ editor, files, file }: Props & { files: CardFiles; file: StoredFile }) {
  const download = () => {
    files.download(file);
  };
  const remove = () => {
    files.remove(file.id);
  };
  const removeItem = {
    id: "remove",
    label: "Remove attachment",
    icon: <Icon name="trash" size={14} />,
    danger: true,
    disabled: editor.busy,
    onSelect: remove,
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the right-click menu repeats the row's own controls
    <div
      className="group flex min-h-7 animate-message-in items-center gap-2"
      onContextMenu={(event) => {
        editor.menu(event, "Attachment actions", [
          {
            id: "download",
            label: "Download",
            icon: <Icon name="download" size={14} />,
            disabled: editor.busy,
            onSelect: download,
          },
          ...(editor.canAttach ? [removeItem] : []),
        ]);
      }}
    >
      <Icon name="file" size={15} className="text-text-muted" />
      <button
        type="button"
        disabled={editor.busy}
        aria-label={`Download ${file.name ?? "attachment"}`}
        className="min-w-0 flex-1 break-all text-left text-[13px] text-text hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        onClick={download}
      >
        {file.name ?? "Attachment"}
        <span className="ml-2 text-xs text-text-muted">{Math.ceil(file.sizeBytes / 1024)} KB</span>
      </button>
      {editor.canAttach && (
        <button
          type="button"
          disabled={editor.busy}
          aria-label={`Remove attachment ${file.name ?? ""}`}
          className={rowAction}
          onClick={remove}
        >
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

function AddAttachment({ editor, files }: Props & { files: CardFiles }) {
  const blocked = editor.busy || editor.card.fileIds.length >= 20;
  return (
    <label
      className={cn(
        addButton,
        "w-fit cursor-pointer focus-within:ring-2 focus-within:ring-accent",
        blocked && "pointer-events-none opacity-50",
      )}
    >
      <Icon name="plus" size={14} />
      Add an attachment
      <input
        type="file"
        className="sr-only"
        disabled={blocked}
        onChange={(event) => {
          const file = event.target.files?.item(0);
          event.target.value = "";
          if (file) files.upload(file);
        }}
      />
    </label>
  );
}

/** Files attached to the card. */
export function CardAttachments({ editor }: Props) {
  const files = useCardFiles(editor);
  return (
    <Section icon="paperclip" title="Attachments">
      {files.files?.map((file) => (
        <FileRow key={file.id} editor={editor} files={files} file={file} />
      ))}
      {editor.card.fileIds.length === 0 && !editor.canAttach && (
        <p className="text-xs text-text-muted">No attachments.</p>
      )}
      {editor.canAttach && <AddAttachment editor={editor} files={files} />}
    </Section>
  );
}
