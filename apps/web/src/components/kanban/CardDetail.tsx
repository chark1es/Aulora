import { hasPermission, kanbanDuration, Permission } from "@aulora/core";
import {
  Button,
  ConfirmDialog,
  type ContextMenuItem,
  cn,
  Icon,
  type IconProps,
  Modal,
  Select,
  useContextMenu,
} from "@aulora/ui-web";
import { useAction, useConvex, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import type { Id } from "../../../../../packages/convex/convex/_generated/dataModel";
import { PersonAvatar } from "../chat/member-avatars";
import {
  addButton,
  ChecklistMenu,
  CheckMark,
  dueLabel,
  LabelChip,
  PeoplePicker,
  PRIORITIES,
  PRIORITY,
  PriorityFlag,
  timeAgo,
} from "./controls";
import { GithubBrowser } from "./GithubBrowser";
import { type Board, type BoardMember, type Card, control, failure, newItemId } from "./types";

function dateInput(at: number | undefined) {
  return at === undefined ? "" : new Date(at).toISOString().slice(0, 10);
}
function Section({
  icon,
  title,
  aside,
  children,
}: {
  icon: IconProps["name"];
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <div className="flex min-h-7 items-center gap-2">
        <Icon name={icon} size={15} className="text-text-muted" />
        <h3 className="flex-1 text-[13px] font-semibold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}
function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-text-muted">{label}</span>
      {children}
    </div>
  );
}
const field =
  "h-8 w-full min-w-0 rounded-[8px] border border-border bg-surface-3 px-2 text-[13px] text-text focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-60";
const rowAction =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-text-muted opacity-0 transition hover:bg-surface-3 hover:text-text focus-visible:opacity-100 group-hover:opacity-100 disabled:pointer-events-none";
function draftFor(card: Card) {
  return {
    title: card.title,
    notes: card.notes,
    checklist: card.checklist,
    githubLinks: card.githubLinks,
    labelIds: card.labelIds,
    assigneeIds: card.assigneeIds,
    priority: card.priority,
    startAt: dateInput(card.startAt),
    dueAt: dateInput(card.dueAt),
    estimateMinutes: card.estimateMinutes === undefined ? "" : String(card.estimateMinutes),
    revision: card.revision,
  };
}
export function CardDetail({
  card,
  board,
  members,
  permissions,
  ownUserId,
  now,
  onClose,
}: {
  card: Card;
  board: Board;
  members: readonly BoardMember[];
  permissions: bigint;
  ownUserId: string;
  now: number;
  onClose: () => void;
}) {
  const client = useConvex();
  const update = useMutation(api.kanban.updateCard);
  const move = useMutation(api.kanban.moveCard);
  const archive = useMutation(api.kanban.archiveCard);
  const deleteCard = useMutation(api.kanban.deleteCard);
  const timer = useMutation(api.kanban.timer);
  const attach = useMutation(api.kanban.attachFile);
  const uploadUrl = useMutation(api.files.generateUploadUrl);
  const finalize = useAction(api.files.finalize);
  const downloadFile = useAction(api.files.download);
  const comment = useMutation(api.kanban.comment);
  const comments = usePaginatedQuery(
    api.kanban.comments,
    { cardId: card._id },
    { initialNumItems: 20 },
  );
  const history = useQuery(api.kanban.history, { cardId: card._id });
  const files = useQuery(api.files.getMany, { fileIds: card.fileIds });
  const [draft, setDraft] = useState(() => draftFor(card));
  const [baseline, setBaseline] = useState(() => JSON.stringify(draftFor(card)));
  const [commentText, setComment] = useState("");
  const [editingComment, setEditingComment] = useState<Id<"kanbanComments"> | undefined>();
  const [checkText, setCheckText] = useState("");
  const [github, setGithub] = useState(false);
  const [pending, setPending] = useState<"save" | "comment" | "other" | null>(null);
  const busy = pending !== null;
  const timing = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [discard, setDiscard] = useState(false);
  const [reloadConfirm, setReloadConfirm] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [removeComment, setRemoveComment] = useState<Id<"kanbanComments"> | null>(null);
  const [showActivity, setShowActivity] = useState(false);
  const canEdit =
    !board.archived && !card.archived && hasPermission(permissions, Permission.EditKanban);
  const canComment =
    !board.archived && !card.archived && hasPermission(permissions, Permission.CommentKanban);
  const canManage = hasPermission(permissions, Permission.ManageKanban);
  const canModerate = !board.archived && !card.archived && (canComment || canManage);
  const dirty = JSON.stringify(draft) !== baseline;
  const memberName = (id: string) =>
    members.find((m) => m.userId === id)?.displayName ?? "Former member";
  async function run(
    work: () => Promise<unknown>,
    success?: string,
    kind: "save" | "comment" | "other" = "other",
  ) {
    setPending(kind);
    setError(null);
    setNotice(null);
    try {
      await work();
      if (success) setNotice(success);
    } catch (cause) {
      setError(failure(cause));
    } finally {
      setPending(null);
    }
  }
  // The timer does not touch the fields being edited, so it runs without locking the form.
  async function toggleTimer() {
    if (timing.current) return;
    timing.current = true;
    setError(null);
    try {
      await timer({ cardId: card._id, running: card.timerStartedAt === undefined });
    } catch (cause) {
      setError(failure(cause));
    } finally {
      timing.current = false;
    }
  }
  function close() {
    if (busy) return;
    if (dirty || commentText.trim()) setDiscard(true);
    else onClose();
  }
  function reload() {
    const current = draftFor(card);
    setDraft(current);
    setBaseline(JSON.stringify(current));
    setReloadConfirm(false);
  }
  const tracked =
    card.trackedMs +
    (card.timerStartedAt === undefined ? 0 : Math.max(0, now - card.timerStartedAt));
  const openMenu = useContextMenu();
  const titleField = useRef<HTMLTextAreaElement | null>(null);
  // The title wraps instead of scrolling sideways, so the field grows with it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the title changes
  useLayoutEffect(() => {
    const node = titleField.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight + 2}px`;
  }, [draft.title]);
  const boardMembers = members.filter((m) => !board.private || board.memberIds.includes(m.userId));
  const canAttach = canEdit && hasPermission(permissions, Permission.AttachFiles);
  const canTime =
    canEdit ||
    (!board.archived &&
      !card.archived &&
      card.timerStartedAt !== undefined &&
      (card.timerUserId === ownUserId || canManage));
  const done = draft.checklist.filter((i) => i.done).length;
  const due = draft.dueAt ? dueLabel(Date.parse(`${draft.dueAt}T23:59:59Z`), now) : null;
  const columnName = board.columns.find((c) => c.id === card.columnId)?.name ?? "Unknown column";
  const toggleItem = (id: string) =>
    setDraft((d) => ({
      ...d,
      checklist: d.checklist.map((i) => (i.id === id ? { ...i, done: !i.done } : i)),
    }));
  const removeItem = (id: string) =>
    setDraft((d) => ({ ...d, checklist: d.checklist.filter((i) => i.id !== id) }));
  function addItem() {
    if (!checkText.trim() || draft.checklist.length >= 100) return;
    setDraft({
      ...draft,
      checklist: [...draft.checklist, { id: newItemId(), text: checkText.trim(), done: false }],
    });
    setCheckText("");
  }
  function save() {
    void run(
      async () => {
        await update({
          cardId: card._id,
          ...draft,
          startAt: draft.startAt ? Date.parse(`${draft.startAt}T00:00:00Z`) : null,
          dueAt: draft.dueAt ? Date.parse(`${draft.dueAt}T23:59:59Z`) : null,
          estimateMinutes: draft.estimateMinutes === "" ? null : Number(draft.estimateMinutes),
        });
        const saved = { ...draft, revision: draft.revision + 1 };
        setDraft(saved);
        setBaseline(JSON.stringify(saved));
      },
      "Card saved",
      "save",
    );
  }
  function download(file: { url: string; name?: string | null }) {
    void run(async () => {
      const token = new URL(file.url, window.location.origin).searchParams.get("token");
      if (!token) throw new Error("Download link expired. Reopen the card to refresh it.");
      const { bytes } = await downloadFile({ token });
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name ?? "attachment";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  function upload(file: File) {
    void run(async () => {
      const url = new URL(await uploadUrl({}));
      // Self-hosted storage may advertise its internal origin. Use the
      // same public backend origin as queries, including the Docker proxy.
      const target = /^\/api\/storage\/upload(?:\/|$)/.test(url.pathname)
        ? new URL(`${url.pathname}${url.search}`, client.url).href
        : url.href;
      const response = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!response.ok) throw new Error("Upload failed. Try again.");
      const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
      const fileId = await finalize({
        storageId,
        name: file.name,
        mime: file.type || "application/octet-stream",
        kanbanBoardId: board.id,
      });
      await attach({ cardId: card._id, fileId });
    }, "Attachment added");
  }
  function submitComment() {
    if (!commentText.trim()) return;
    void run(
      async () => {
        await comment({
          cardId: card._id,
          body: commentText,
          ...(editingComment ? { commentId: editingComment } : {}),
        });
        setComment("");
        setEditingComment(undefined);
      },
      "Comment saved",
      "comment",
    );
  }
  /** Right-click menus mirror the row's own buttons. */
  function menu(event: React.MouseEvent, label: string, items: ContextMenuItem[]) {
    if (!items.length) return;
    event.preventDefault();
    openMenu({ clientX: event.clientX, clientY: event.clientY, items, label });
  }
  return (
    <>
      <Modal
        open
        onClose={close}
        size="lg"
        className="flex max-h-[calc(100dvh-32px)] !max-w-[900px] flex-col [&>div]:min-h-0 [&>div]:overflow-y-auto [&>footer]:shrink-0 [&>footer]:flex-wrap [&>header]:shrink-0 [&>header_h2]:truncate"
        label="Card details"
        title={`${board.name} · ${columnName}`}
        icon={<Icon name="kanban" size={18} className="text-accent" />}
        footer={
          <>
            {(notice || error) && (
              <div className="w-full text-[13px]">
                {notice && (
                  <p role="status" className="animate-fade-in text-secondary">
                    {notice}
                  </p>
                )}
                {error && (
                  <p role="alert" className="text-danger">
                    {error}
                  </p>
                )}
              </div>
            )}
            <div className="mr-auto flex items-center gap-1">
              {!board.archived && hasPermission(permissions, Permission.EditKanban) && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  aria-label={card.archived ? "Restore card" : "Archive card"}
                  leading={<Icon name={card.archived ? "unarchive" : "archive"} size={15} />}
                  onClick={() => setArchiveConfirm(true)}
                >
                  {card.archived ? "Restore" : "Archive"}
                </Button>
              )}
              {canManage && (
                <Button
                  variant="ghost"
                  className="hover:bg-danger/10 hover:text-danger"
                  disabled={busy}
                  aria-label="Delete card"
                  leading={<Icon name="trash" size={15} />}
                  onClick={() => setDeleteConfirm(true)}
                >
                  Delete
                </Button>
              )}
            </div>
            {dirty && (
              <span className="animate-fade-in text-xs text-text-muted">Unsaved changes</span>
            )}
            <Button variant="secondary" onClick={close}>
              Close
            </Button>
            {canEdit && (
              <Button
                loading={pending === "save"}
                disabled={busy || !dirty || draft.revision !== card.revision}
                onClick={save}
              >
                Save card
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-6 pb-5 md:flex-row md:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            {card.archived && (
              <p className="flex items-center gap-2 rounded-[8px] bg-surface-3 px-3 py-2 text-[13px] text-text-muted">
                <Icon name="archive" size={14} />
                This card is archived. Restore it to make changes.
              </p>
            )}
            {draft.revision !== card.revision && (
              <div className="flex animate-slide-up items-center gap-3 rounded-[8px] border border-idle/40 bg-idle/10 px-3 py-2 text-[13px]">
                <span className="flex-1">This card changed while you were editing.</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => (dirty ? setReloadConfirm(true) : reload())}
                >
                  Reload card
                </Button>
              </div>
            )}
            <fieldset disabled={!canEdit || busy} className="flex min-w-0 flex-col gap-6">
              <textarea
                ref={titleField}
                aria-label="Title"
                placeholder="Card title"
                rows={1}
                maxLength={200}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value.replace(/\n/g, " ") })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
                className="-mx-2 w-[calc(100%+1rem)] resize-none overflow-hidden rounded-[8px] border border-transparent bg-transparent px-2 py-1 text-[20px] font-semibold leading-tight tracking-[-0.01em] text-text placeholder:text-text-muted enabled:hover:bg-surface-3 focus-visible:border-accent focus-visible:bg-surface-3 focus-visible:outline-none"
              />
              <Section icon="note" title="Notes">
                <textarea
                  aria-label="Notes"
                  rows={5}
                  maxLength={30000}
                  placeholder={canEdit ? "Add details, context or links…" : "No notes"}
                  className={cn(control, "resize-y leading-relaxed placeholder:text-text-muted")}
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                />
              </Section>
              <Section
                icon="checklist"
                title="Checklist"
                aside={
                  !!draft.checklist.length && (
                    <span className="text-xs tabular-nums text-text-muted">
                      {done} of {draft.checklist.length} done
                    </span>
                  )
                }
              >
                {!!draft.checklist.length && (
                  <div className="h-1 overflow-hidden rounded-full bg-surface-3">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-300 ease-out",
                        done === draft.checklist.length ? "bg-secondary" : "bg-accent",
                      )}
                      style={{ width: `${(done / draft.checklist.length) * 100}%` }}
                    />
                  </div>
                )}
                <div className="flex flex-col">
                  {draft.checklist.map((item) => (
                    // biome-ignore lint/a11y/noStaticElementInteractions: the right-click menu repeats the row's own controls
                    <div
                      key={item.id}
                      className="group -mx-1.5 flex animate-message-in items-start gap-1 rounded-[7px] px-1.5 transition-colors hover:bg-surface-3"
                      onContextMenu={(e) =>
                        menu(
                          e,
                          "Checklist item actions",
                          canEdit
                            ? [
                                {
                                  id: "toggle",
                                  label: item.done ? "Mark as not done" : "Mark as done",
                                  icon: <Icon name="check" size={14} />,
                                  onSelect: () => toggleItem(item.id),
                                },
                                {
                                  id: "remove",
                                  label: "Remove item",
                                  icon: <Icon name="trash" size={14} />,
                                  danger: true,
                                  onSelect: () => removeItem(item.id),
                                },
                              ]
                            : [],
                        )
                      }
                    >
                      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 py-1.5 text-[13px]">
                        <input
                          type="checkbox"
                          className="peer sr-only"
                          checked={item.done}
                          onChange={() => toggleItem(item.id)}
                        />
                        <CheckMark className="mt-px" />
                        <span
                          className={cn(
                            "min-w-0 break-words",
                            "transition-colors",
                            item.done && "text-text-muted line-through",
                          )}
                        >
                          {item.text}
                        </span>
                      </label>
                      {canEdit && (
                        <button
                          type="button"
                          aria-label={`Remove checklist item ${item.text}`}
                          className={cn(rowAction, "mt-1")}
                          onClick={() => removeItem(item.id)}
                        >
                          <Icon name="x" size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {!draft.checklist.length && !canEdit && (
                  <p className="text-xs text-text-muted">No checklist items.</p>
                )}
                {canEdit && (
                  <div className="flex gap-2">
                    <input
                      aria-label="New checklist item"
                      placeholder="Add an item"
                      maxLength={500}
                      className={cn(field, "h-9 px-3")}
                      value={checkText}
                      onChange={(e) => setCheckText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addItem();
                        }
                      }}
                    />
                    <Button
                      variant="secondary"
                      disabled={!checkText.trim() || draft.checklist.length >= 100}
                      onClick={addItem}
                    >
                      Add
                    </Button>
                  </div>
                )}
              </Section>
            </fieldset>
            <Section
              icon="link"
              title="GitHub links"
              aside={
                canEdit && (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => setGithub(true)}>
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
                  {canEdit && (
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Unlink ${url}`}
                      className={rowAction}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          githubLinks: draft.githubLinks.filter((u) => u !== url),
                        })
                      }
                    >
                      <Icon name="x" size={14} />
                    </button>
                  )}
                </div>
              ))}
              {!draft.githubLinks.length && (
                <p className="text-xs text-text-muted">
                  No linked repositories, issues or pull requests.
                </p>
              )}
            </Section>
            <Section icon="paperclip" title="Attachments">
              {files?.map((file) => (
                // biome-ignore lint/a11y/noStaticElementInteractions: the right-click menu repeats the row's own controls
                <div
                  key={file.id}
                  className="group flex min-h-7 animate-message-in items-center gap-2"
                  onContextMenu={(e) =>
                    menu(e, "Attachment actions", [
                      {
                        id: "download",
                        label: "Download",
                        icon: <Icon name="download" size={14} />,
                        disabled: busy,
                        onSelect: () => download(file),
                      },
                      ...(canAttach
                        ? [
                            {
                              id: "remove",
                              label: "Remove attachment",
                              icon: <Icon name="trash" size={14} />,
                              danger: true,
                              disabled: busy,
                              onSelect: () =>
                                void run(() =>
                                  attach({ cardId: card._id, fileId: file.id, remove: true }),
                                ),
                            },
                          ]
                        : []),
                    ])
                  }
                >
                  <Icon name="file" size={15} className="text-text-muted" />
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Download ${file.name ?? "attachment"}`}
                    className="min-w-0 flex-1 break-all text-left text-[13px] text-text hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    onClick={() => download(file)}
                  >
                    {file.name ?? "Attachment"}
                    <span className="ml-2 text-xs text-text-muted">
                      {Math.ceil(file.sizeBytes / 1024)} KB
                    </span>
                  </button>
                  {canAttach && (
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Remove attachment ${file.name}`}
                      className={rowAction}
                      onClick={() =>
                        void run(() => attach({ cardId: card._id, fileId: file.id, remove: true }))
                      }
                    >
                      <Icon name="x" size={14} />
                    </button>
                  )}
                </div>
              ))}
              {!card.fileIds.length && !canAttach && (
                <p className="text-xs text-text-muted">No attachments.</p>
              )}
              {canAttach && (
                <label
                  className={cn(
                    addButton,
                    "w-fit cursor-pointer focus-within:ring-2 focus-within:ring-accent",
                    (busy || card.fileIds.length >= 20) && "pointer-events-none opacity-50",
                  )}
                >
                  <Icon name="plus" size={14} />
                  Add an attachment
                  <input
                    type="file"
                    className="sr-only"
                    disabled={busy || card.fileIds.length >= 20}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) upload(file);
                    }}
                  />
                </label>
              )}
            </Section>
            <Section icon="message" title="Comments">
              {(canComment || (canModerate && editingComment !== undefined)) && (
                <form
                  className="flex gap-2.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitComment();
                  }}
                >
                  <PersonAvatar userId={ownUserId} size={28} className="mt-0.5" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <textarea
                      aria-label={editingComment ? "Edit comment" : "New comment"}
                      placeholder="Write a comment…"
                      rows={2}
                      maxLength={10000}
                      className={cn(control, "resize-y placeholder:text-text-muted")}
                      value={commentText}
                      onChange={(e) => setComment(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          submitComment();
                        }
                      }}
                      disabled={busy}
                    />
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        size="sm"
                        disabled={busy || !commentText.trim()}
                        loading={pending === "comment"}
                      >
                        {editingComment ? "Save comment" : "Comment"}
                      </Button>
                      {editingComment && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingComment(undefined);
                            setComment("");
                          }}
                        >
                          Cancel edit
                        </Button>
                      )}
                    </div>
                  </div>
                </form>
              )}
              {comments.results.map((c) => {
                const mine = canModerate && (c.authorId === ownUserId || canManage);
                const edit = () => {
                  setEditingComment(c.id);
                  setComment(c.body);
                };
                return (
                  <article
                    key={c.id}
                    className={cn(
                      "group -mx-2 flex animate-message-in gap-2.5 rounded-[8px] px-2 py-1.5 transition-colors",
                      editingComment === c.id && "bg-accent-soft",
                    )}
                    onContextMenu={(e) =>
                      menu(e, "Comment actions", [
                        {
                          id: "copy",
                          label: "Copy text",
                          icon: <Icon name="copy" size={14} />,
                          onSelect: () => void navigator.clipboard?.writeText(c.body),
                        },
                        ...(mine
                          ? [
                              {
                                id: "edit",
                                label: "Edit comment",
                                icon: <Icon name="pencil" size={14} />,
                                separatorBefore: true,
                                disabled: busy,
                                onSelect: edit,
                              },
                              {
                                id: "delete",
                                label: "Delete comment…",
                                icon: <Icon name="trash" size={14} />,
                                danger: true,
                                disabled: busy,
                                onSelect: () => setRemoveComment(c.id),
                              },
                            ]
                          : []),
                      ])
                    }
                  >
                    <PersonAvatar userId={c.authorId} size={28} className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-h-7 items-center gap-2">
                        <span className="truncate text-[13px] font-semibold">
                          {memberName(c.authorId)}
                        </span>
                        <time
                          className="shrink-0 text-xs text-text-muted"
                          dateTime={new Date(c.at).toISOString()}
                          title={new Date(c.at).toLocaleString()}
                        >
                          {timeAgo(c.at, now)}
                          {c.updatedAt > c.at + 1000 ? " · edited" : ""}
                        </time>
                        <span className="flex-1" />
                        {mine && (
                          <span className="flex opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
                            <Button size="sm" variant="ghost" disabled={busy} onClick={edit}>
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => setRemoveComment(c.id)}
                            >
                              Delete
                            </Button>
                          </span>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
                        {c.body}
                      </p>
                    </div>
                  </article>
                );
              })}
              {comments.status === "LoadingFirstPage" && (
                <p className="text-xs text-text-muted">Loading comments…</p>
              )}
              {!comments.results.length && comments.status !== "LoadingFirstPage" && (
                <p className="text-xs text-text-muted">No comments yet.</p>
              )}
              {comments.status === "CanLoadMore" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => comments.loadMore(20)}
                >
                  Load older comments
                </Button>
              )}
            </Section>
            <section aria-label="Activity" className="flex flex-col gap-2">
              <button
                type="button"
                aria-expanded={showActivity}
                onClick={() => setShowActivity(!showActivity)}
                className="flex min-h-7 items-center gap-2 text-left text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Icon name="history" size={15} className="text-text-muted" />
                <span className="flex-1">Activity</span>
                <Icon
                  name="chevron-down"
                  size={14}
                  className={cn(
                    "text-text-muted transition-transform",
                    showActivity && "-rotate-180",
                  )}
                />
              </button>
              {showActivity && (
                <>
                  <ol className="stagger flex flex-col gap-1.5 border-l border-border pl-3">
                    {history?.map((h) => (
                      <li key={h.id} className="text-xs text-text-muted">
                        <span className="font-medium text-text">{memberName(h.actorId)}</span>{" "}
                        {h.body}
                        <time
                          className="ml-2"
                          dateTime={new Date(h.at).toISOString()}
                          title={new Date(h.at).toLocaleString()}
                        >
                          {timeAgo(h.at, now)}
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
          </div>
          <aside className="flex shrink-0 flex-col gap-4 md:sticky md:top-0 md:w-[248px] md:border-l md:border-border md:pl-5">
            <fieldset disabled={!canEdit || busy} className="flex min-w-0 flex-col gap-4">
              {canEdit ? (
                <Select
                  label="Column"
                  value={card.columnId}
                  options={board.columns.map((c) => ({ value: c.id, label: c.name }))}
                  onChange={(columnId) => {
                    if (columnId === card.columnId) return;
                    void run(async () => {
                      await move({ cardId: card._id, columnId });
                      setDraft((d) => ({ ...d, revision: d.revision + 1 }));
                      setBaseline((b) =>
                        JSON.stringify({ ...JSON.parse(b), revision: card.revision + 1 }),
                      );
                    });
                  }}
                />
              ) : (
                <Property label="Column">
                  <span className="text-[13px]">{columnName}</span>
                </Property>
              )}
              {canEdit ? (
                <Select
                  label="Priority"
                  value={draft.priority}
                  options={PRIORITIES.map((p) => ({
                    value: p,
                    label: PRIORITY[p].label,
                    leading: <PriorityFlag priority={p} />,
                  }))}
                  onChange={(priority) => setDraft({ ...draft, priority })}
                />
              ) : (
                <Property label="Priority">
                  <span className="flex items-center gap-2 text-[13px]">
                    <PriorityFlag priority={draft.priority} />
                    {PRIORITY[draft.priority].label}
                  </span>
                </Property>
              )}
              <Property
                label={
                  draft.assigneeIds.length > 1
                    ? `Assignees · ${draft.assigneeIds.length}`
                    : "Assignees"
                }
              >
                <PeoplePicker
                  label="Assignees"
                  addLabel="Assign someone"
                  members={boardMembers}
                  selected={draft.assigneeIds}
                  onChange={(assigneeIds) => setDraft({ ...draft, assigneeIds })}
                  editable={canEdit}
                  emptyText="Unassigned"
                />
              </Property>
              <Property label="Labels">
                {!!draft.labelIds.length && (
                  <div className="flex flex-wrap gap-1">
                    {board.labels
                      .filter((l) => draft.labelIds.includes(l.id))
                      .map((l) => (
                        <LabelChip key={l.id} name={l.name} color={l.color} />
                      ))}
                  </div>
                )}
                {!board.labels.length ? (
                  <p className="text-xs text-text-muted">
                    A board manager can add labels in Board settings.
                  </p>
                ) : canEdit ? (
                  <ChecklistMenu
                    label="Labels"
                    options={board.labels.map((l) => ({
                      id: l.id,
                      label: l.name,
                      leading: (
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: l.color }}
                        />
                      ),
                    }))}
                    selected={draft.labelIds}
                    onChange={(labelIds) => setDraft({ ...draft, labelIds })}
                    triggerClassName={addButton}
                    trigger={
                      <>
                        <Icon name="plus" size={14} />
                        {draft.labelIds.length ? "Edit" : "Add label"}
                      </>
                    }
                  />
                ) : (
                  !draft.labelIds.length && <p className="text-[13px] text-text-muted">None</p>
                )}
              </Property>
              <Property label="Schedule">
                <div className="grid grid-cols-[60px_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 text-[13px]">
                  <label htmlFor="kanban-card-start">Start</label>
                  <input
                    id="kanban-card-start"
                    aria-label="Start date"
                    type="date"
                    className={field}
                    value={draft.startAt}
                    onChange={(e) => setDraft({ ...draft, startAt: e.target.value })}
                  />
                  <label htmlFor="kanban-card-due">Due</label>
                  <input
                    id="kanban-card-due"
                    aria-label="Due date"
                    type="date"
                    className={cn(field, due?.overdue && "border-danger/60 text-danger")}
                    value={draft.dueAt}
                    onChange={(e) => setDraft({ ...draft, dueAt: e.target.value })}
                  />
                  <label htmlFor="kanban-card-estimate">Estimate</label>
                  <span className="flex items-center gap-2">
                    <input
                      id="kanban-card-estimate"
                      aria-label="Estimate in minutes"
                      type="number"
                      min={0}
                      max={525600}
                      placeholder="0"
                      className={field}
                      value={draft.estimateMinutes}
                      onChange={(e) => setDraft({ ...draft, estimateMinutes: e.target.value })}
                    />
                    <span className="text-xs text-text-muted">min</span>
                  </span>
                </div>
                {due?.overdue && <p className="text-xs text-danger">Overdue</p>}
              </Property>
            </fieldset>
            <Property label="Time tracked">
              <div className="flex items-center gap-3 rounded-[10px] bg-surface-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "font-mono text-[15px] tabular-nums",
                      card.timerStartedAt !== undefined && "text-accent",
                    )}
                  >
                    {kanbanDuration(tracked)}
                  </p>
                  <p className="truncate text-[11px] text-text-muted">
                    {card.timerUserId
                      ? `Running · ${memberName(card.timerUserId)}`
                      : card.estimateMinutes !== undefined
                        ? `of ${card.estimateMinutes} min estimated`
                        : "Not running"}
                  </p>
                </div>
                {canTime && (
                  <Button
                    variant={card.timerStartedAt === undefined ? "secondary" : "primary"}
                    size="sm"
                    disabled={
                      busy || (!!card.timerUserId && card.timerUserId !== ownUserId && !canManage)
                    }
                    aria-label={card.timerStartedAt === undefined ? "Start timer" : "Stop timer"}
                    leading={
                      <Icon name={card.timerStartedAt === undefined ? "play" : "stop"} size={14} />
                    }
                    onClick={() => void toggleTimer()}
                  >
                    {card.timerStartedAt === undefined ? "Start" : "Stop"}
                  </Button>
                )}
              </div>
            </Property>
          </aside>
        </div>
      </Modal>
      {github && (
        <GithubBrowser
          onClose={() => setGithub(false)}
          onPick={(item) => {
            setDraft({ ...draft, githubLinks: [...new Set([...draft.githubLinks, item.url])] });
            setGithub(false);
          }}
        />
      )}
      <ConfirmDialog
        open={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        title="Permanently delete card?"
        description="This deletes the card, comments, activity and attachments that are not used on other cards. It cannot be undone."
        confirmLabel="Delete card"
        variant="danger"
        onConfirm={() => {
          setDeleteConfirm(false);
          void run(async () => {
            await deleteCard({ cardId: card._id });
            onClose();
          });
        }}
      />
      <ConfirmDialog
        open={reloadConfirm}
        onClose={() => setReloadConfirm(false)}
        title="Replace unsaved card changes?"
        description="Reloading replaces your card edits with the latest saved version. Your comment draft is kept."
        confirmLabel="Reload card"
        onConfirm={reload}
      />
      <ConfirmDialog
        open={discard}
        onClose={() => setDiscard(false)}
        title="Discard unsaved changes?"
        confirmLabel="Discard changes"
        onConfirm={onClose}
      />
      <ConfirmDialog
        open={archiveConfirm}
        onClose={() => setArchiveConfirm(false)}
        title={card.archived ? "Restore card?" : "Archive card?"}
        description="Archived cards keep their notes, comments and attachments. Running timers stop."
        confirmLabel={card.archived ? "Restore" : "Archive"}
        onConfirm={() => {
          setArchiveConfirm(false);
          void run(async () => {
            await archive({ cardId: card._id, archived: !card.archived });
            onClose();
          });
        }}
      />
      <ConfirmDialog
        open={removeComment !== null}
        onClose={() => setRemoveComment(null)}
        title="Delete comment?"
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          const id = removeComment;
          setRemoveComment(null);
          if (id)
            void run(() => comment({ cardId: card._id, body: "", commentId: id, remove: true }));
        }}
      />
    </>
  );
}
