import { Button, cn, Icon } from "@aulora/ui-web";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { PersonAvatar } from "../chat/member-avatars";
import { copyText } from "./board-logic";
import { Section } from "./card-parts";
import { timeAgo } from "./controls";
import { control } from "./types";
import type { CardComment, CardEditor } from "./use-card-editor";

interface Props {
  editor: CardEditor;
}

/** Posts a new comment, or saves the one being edited. */
export function useCommentSubmit(editor: CardEditor) {
  const comment = useMutation(api.kanbanComments.comment);
  const { card, commentText, editingComment } = editor;
  return () => {
    if (!commentText.trim()) return;
    void editor.run(
      async () => {
        await comment({
          cardId: card._id,
          body: commentText,
          ...(editingComment === undefined ? {} : { commentId: editingComment.id }),
        });
        editor.setCommentText("");
        editor.setEditingComment(undefined);
      },
      "Comment saved",
      "comment",
    );
  };
}

function Composer({ editor }: Props) {
  const submit = useCommentSubmit(editor);
  const editing = editor.editingComment !== undefined;
  return (
    <form
      className="flex gap-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <PersonAvatar userId={editor.ownUserId} size={28} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <textarea
          aria-label={editing ? "Edit comment" : "New comment"}
          placeholder="Write a comment…"
          rows={2}
          maxLength={10000}
          className={cn(control, "resize-y placeholder:text-text-muted")}
          value={editor.commentText}
          onChange={(event) => {
            editor.setCommentText(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
            event.preventDefault();
            submit();
          }}
          disabled={editor.busy}
        />
        <div className="flex gap-2">
          <Button
            type="submit"
            size="sm"
            disabled={editor.busy || !editor.commentText.trim()}
            loading={editor.pending === "comment"}
          >
            {editing ? "Save comment" : "Comment"}
          </Button>
          {editing && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                editor.setEditingComment(undefined);
                editor.setCommentText("");
              }}
            >
              Cancel edit
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

/** Copy for everyone; edit and delete for the author or a board manager. */
function commentMenu(editor: CardEditor, entry: CardComment, mine: boolean, edit: () => void) {
  const copy = {
    id: "copy",
    label: "Copy text",
    icon: <Icon name="copy" size={14} />,
    onSelect: () => {
      copyText(entry.body);
    },
  };
  if (!mine) return [copy];
  return [
    copy,
    {
      id: "edit",
      label: "Edit comment",
      icon: <Icon name="pencil" size={14} />,
      separatorBefore: true,
      disabled: editor.busy,
      onSelect: edit,
    },
    {
      id: "delete",
      label: "Delete comment…",
      icon: <Icon name="trash" size={14} />,
      danger: true,
      disabled: editor.busy,
      onSelect: () => {
        editor.setRemovingComment(entry);
      },
    },
  ];
}

function CommentRow({ editor, entry }: Props & { entry: CardComment }) {
  const mine = editor.canModerate && (entry.authorId === editor.ownUserId || editor.canManage);
  const edit = () => {
    editor.setEditingComment(entry);
    editor.setCommentText(entry.body);
  };
  return (
    <article
      className={cn(
        "group -mx-2 flex animate-message-in gap-2.5 rounded-[8px] px-2 py-1.5 transition-colors",
        editor.editingComment?.id === entry.id && "bg-accent-soft",
      )}
      onContextMenu={(event) => {
        editor.menu(event, "Comment actions", commentMenu(editor, entry, mine, edit));
      }}
    >
      <PersonAvatar userId={entry.authorId} size={28} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex min-h-7 items-center gap-2">
          <span className="truncate text-[13px] font-semibold">
            {editor.memberName(entry.authorId)}
          </span>
          <time
            className="shrink-0 text-xs text-text-muted"
            dateTime={new Date(entry.at).toISOString()}
            title={new Date(entry.at).toLocaleString()}
          >
            {timeAgo(entry.at, editor.now)}
            {entry.updatedAt > entry.at + 1000 ? " · edited" : ""}
          </time>
          <span className="flex-1" />
          {mine && (
            <span className="flex opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
              <Button size="sm" variant="ghost" disabled={editor.busy} onClick={edit}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={editor.busy}
                onClick={() => {
                  editor.setRemovingComment(entry);
                }}
              >
                Delete
              </Button>
            </span>
          )}
        </div>
        <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{entry.body}</p>
      </div>
    </article>
  );
}

function listStatus(status: string, count: number): string | null {
  if (status === "LoadingFirstPage") return "Loading comments…";
  return count === 0 ? "No comments yet." : null;
}

export function CardComments({ editor }: Props) {
  const comments = usePaginatedQuery(
    api.kanbanComments.comments,
    { cardId: editor.card._id },
    { initialNumItems: 20 },
  );
  const status = listStatus(comments.status, comments.results.length);
  const mayWrite = editor.canComment || (editor.canModerate && editor.editingComment !== undefined);
  return (
    <Section icon="message" title="Comments">
      {mayWrite && <Composer editor={editor} />}
      {comments.results.map((entry) => (
        <CommentRow key={entry.id} editor={editor} entry={entry} />
      ))}
      {status !== null && <p className="text-xs text-text-muted">{status}</p>}
      {comments.status === "CanLoadMore" && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => {
            comments.loadMore(20);
          }}
        >
          Load older comments
        </Button>
      )}
    </Section>
  );
}

/** Who did what to the card; collapsed until asked for. */
export function CardActivity({ editor }: Props) {
  const [shown, setShown] = useState(false);
  const history = useQuery(api.kanbanComments.history, { cardId: editor.card._id });
  return (
    <section aria-label="Activity" className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={shown}
        onClick={() => {
          setShown(!shown);
        }}
        className="flex min-h-7 items-center gap-2 text-left text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Icon name="history" size={15} className="text-text-muted" />
        <span className="flex-1">Activity</span>
        <Icon
          name="chevron-down"
          size={14}
          className={cn("text-text-muted transition-transform", shown && "-rotate-180")}
        />
      </button>
      {shown && (
        <>
          <ol className="stagger flex flex-col gap-1.5 border-l border-border pl-3">
            {history?.map((entry) => (
              <li key={entry.id} className="text-xs text-text-muted">
                <span className="font-medium text-text">{editor.memberName(entry.actorId)}</span>{" "}
                {entry.body}
                <time
                  className="ml-2"
                  dateTime={new Date(entry.at).toISOString()}
                  title={new Date(entry.at).toLocaleString()}
                >
                  {timeAgo(entry.at, editor.now)}
                </time>
              </li>
            ))}
          </ol>
          <p className="text-xs text-text-muted">
            {history?.length ? "Showing the latest 50 events." : "No activity yet."}
          </p>
        </>
      )}
    </section>
  );
}
