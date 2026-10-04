import { Button, ConfirmDialog, Icon, Modal } from "@aulora/ui-web";
import { useMutation } from "convex/react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { CardActivity, CardComments } from "./CardComments";
import { CardAttachments, CardGithubLinks } from "./CardLinks";
import { CardBanners, CardChecklist, CardNotes, CardTitle } from "./CardMain";
import { CardSidebar } from "./CardSidebar";
import { GithubBrowser } from "./GithubBrowser";
import { type CardDetailProps, type CardEditor, useCardEditor } from "./use-card-editor";

interface Props {
  editor: CardEditor;
}

/** What the last write did: a confirmation, or why it failed. */
function FooterStatus({ editor }: Props) {
  if (editor.notice === undefined && editor.error === undefined) return null;
  return (
    <div className="w-full text-[13px]">
      {editor.notice !== undefined && (
        <p role="status" className="animate-fade-in text-secondary">
          {editor.notice}
        </p>
      )}
      {editor.error !== undefined && (
        <p role="alert" className="text-danger">
          {editor.error}
        </p>
      )}
    </div>
  );
}

/** Archive or restore, and delete for board managers. */
function LifecycleButtons({ editor }: Props) {
  const { card } = editor;
  return (
    <div className="mr-auto flex items-center gap-1">
      {editor.canArchive && (
        <Button
          variant="ghost"
          disabled={editor.busy}
          aria-label={card.archived ? "Restore card" : "Archive card"}
          leading={<Icon name={card.archived ? "unarchive" : "archive"} size={15} />}
          onClick={() => {
            editor.setConfirm("archive");
          }}
        >
          {card.archived ? "Restore" : "Archive"}
        </Button>
      )}
      {editor.canManage && (
        <Button
          variant="ghost"
          className="hover:bg-danger/10 hover:text-danger"
          disabled={editor.busy}
          aria-label="Delete card"
          leading={<Icon name="trash" size={15} />}
          onClick={() => {
            editor.setConfirm("delete");
          }}
        >
          Delete
        </Button>
      )}
    </div>
  );
}

function CardFooter({ editor }: Props) {
  return (
    <>
      <FooterStatus editor={editor} />
      <LifecycleButtons editor={editor} />
      {editor.dirty && (
        <span className="animate-fade-in text-xs text-text-muted">Unsaved changes</span>
      )}
      <Button variant="secondary" onClick={editor.close}>
        Close
      </Button>
      {editor.canEdit && (
        <Button
          loading={editor.pending === "save"}
          disabled={editor.busy || !editor.dirty || editor.stale}
          onClick={editor.save}
        >
          Save card
        </Button>
      )}
    </>
  );
}

/** Asks before discarding edits, reloading, archiving or deleting the card. */
function CardConfirmations({ editor }: Props) {
  const archive = useMutation(api.kanban.archiveCard);
  const deleteCard = useMutation(api.kanban.deleteCard);
  const { card, confirm } = editor;
  const close = () => {
    editor.setConfirm(undefined);
  };
  return (
    <>
      <ConfirmDialog
        open={confirm === "delete"}
        onClose={close}
        title="Permanently delete card?"
        description="This deletes the card, comments, activity and attachments that are not used on other cards. It cannot be undone."
        confirmLabel="Delete card"
        variant="danger"
        onConfirm={() => {
          close();
          void editor.run(async () => {
            await deleteCard({ cardId: card._id });
            editor.onClose();
          });
        }}
      />
      <ConfirmDialog
        open={confirm === "reload"}
        onClose={close}
        title="Replace unsaved card changes?"
        description="Reloading replaces your card edits with the latest saved version. Your comment draft is kept."
        confirmLabel="Reload card"
        onConfirm={() => {
          editor.reload();
          close();
        }}
      />
      <ConfirmDialog
        open={confirm === "discard"}
        onClose={close}
        title="Discard unsaved changes?"
        confirmLabel="Discard changes"
        onConfirm={editor.onClose}
      />
      <ConfirmDialog
        open={confirm === "archive"}
        onClose={close}
        title={card.archived ? "Restore card?" : "Archive card?"}
        description="Archived cards keep their notes, comments and attachments. Running timers stop."
        confirmLabel={card.archived ? "Restore" : "Archive"}
        onConfirm={() => {
          close();
          void editor.run(async () => {
            await archive({ cardId: card._id, archived: !card.archived });
            editor.onClose();
          });
        }}
      />
    </>
  );
}

/** Asks before deleting a comment. */
function RemoveCommentDialog({ editor }: Props) {
  const comment = useMutation(api.kanbanComments.comment);
  const target = editor.removingComment;
  return (
    <ConfirmDialog
      open={target !== undefined}
      onClose={() => {
        editor.setRemovingComment(undefined);
      }}
      title="Delete comment?"
      confirmLabel="Delete"
      variant="danger"
      onConfirm={() => {
        editor.setRemovingComment(undefined);
        if (target === undefined) return;
        void editor.run(() =>
          comment({ cardId: editor.card._id, body: "", commentId: target.id, remove: true }),
        );
      }}
    />
  );
}

/** Picks a repository, issue or pull request to link to the card. */
function LinkFromGithub({ editor }: Props) {
  const { draft } = editor;
  if (!editor.github) return null;
  return (
    <GithubBrowser
      onClose={() => {
        editor.setGithub(false);
      }}
      onPick={(item) => {
        editor.setDraft({
          ...draft,
          githubLinks: [...new Set([...draft.githubLinks, item.url])],
        });
        editor.setGithub(false);
      }}
    />
  );
}

/** Everything about one card. Edits are kept until **Save card** is pressed. */
export function CardDetail(props: CardDetailProps) {
  const editor = useCardEditor(props);
  const { board, card } = props;
  const column = board.columns.find((entry) => entry.id === card.columnId);
  return (
    <>
      <Modal
        open
        onClose={editor.close}
        size="lg"
        className="flex max-h-[calc(100dvh-32px)] !max-w-[900px] flex-col [&>div]:min-h-0 [&>div]:overflow-y-auto [&>footer]:shrink-0 [&>footer]:flex-wrap [&>header]:shrink-0 [&>header_h2]:truncate"
        label="Card details"
        title={`${board.name} · ${column?.name ?? "Unknown column"}`}
        icon={<Icon name="kanban" size={18} className="text-accent" />}
        footer={<CardFooter editor={editor} />}
      >
        <div className="flex flex-col gap-6 pb-5 md:flex-row md:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <CardBanners editor={editor} />
            <fieldset
              disabled={!editor.canEdit || editor.busy}
              className="flex min-w-0 flex-col gap-6"
            >
              <CardTitle editor={editor} />
              <CardNotes editor={editor} />
              <CardChecklist editor={editor} />
            </fieldset>
            <CardGithubLinks editor={editor} />
            <CardAttachments editor={editor} />
            <CardComments editor={editor} />
            <CardActivity editor={editor} />
          </div>
          <CardSidebar editor={editor} />
        </div>
      </Modal>
      <LinkFromGithub editor={editor} />
      <CardConfirmations editor={editor} />
      <RemoveCommentDialog editor={editor} />
    </>
  );
}
