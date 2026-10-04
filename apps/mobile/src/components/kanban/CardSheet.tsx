import { hasPermission, isKanbanGithubLink, kanbanDuration, Permission } from "@aulora/core";
import { Button, Icon, Text, usePalette } from "@aulora/ui-native";
import { useAction, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import * as Clipboard from "expo-clipboard";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useMemo, useRef, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from "react-native-reanimated";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import type { Id } from "../../../../../packages/convex/convex/_generated/dataModel";
import { type PickedFile, pickDocuments, pickFromLibrary } from "../../lib/attachments";
import {
  applyTimer,
  type Board,
  type BoardMember,
  type Card,
  dayOf,
  dueLabel,
  endOfDay,
  failure,
  formatDay,
  isColumnFull,
  newItemId,
  PRIORITIES,
  PRIORITY,
  startOfDay,
  timeAgo,
  trackedTime,
} from "../../lib/kanban";
import { MemberAvatar } from "../chat/MemberAvatar";
import { Sheet } from "../chat/Sheet";
import {
  AvatarStack,
  CheckBox,
  LabelChip,
  PriorityFlag,
  PropertyRow,
  SectionTitle,
  useNow,
} from "./parts";
import { ActionSheet, DateSheet, PickerSheet, type SheetAction } from "./sheets";

function draftFor(card: Card) {
  return {
    title: card.title,
    notes: card.notes,
    checklist: card.checklist,
    githubLinks: card.githubLinks,
    labelIds: card.labelIds,
    assigneeIds: card.assigneeIds,
    priority: card.priority,
    startAt: dayOf(card.startAt),
    dueAt: dayOf(card.dueAt),
    estimateMinutes: card.estimateMinutes === undefined ? "" : String(card.estimateMinutes),
    revision: card.revision,
  };
}

type Picker =
  | "column"
  | "priority"
  | "assignees"
  | "labels"
  | "start"
  | "due"
  | "attach"
  | { comment: { id: Id<"kanbanComments">; body: string; mine: boolean } };

const field =
  "rounded-input border border-border bg-surface-3 px-3 py-2.5 text-[16px] leading-[22px] text-text";

/** The tracked time, re-rendering by itself each second while the timer runs. */
function TimerClock({ card }: { readonly card: Card }) {
  const palette = usePalette();
  const running = card.timerStartedAt !== undefined;
  const tracked = trackedTime(card, useNow(running));
  return (
    <Text
      mono
      className="text-[20px]"
      style={{ color: running ? palette.accent : palette.text, fontVariant: ["tabular-nums"] }}
    >
      {kanbanDuration(tracked)}
    </Text>
  );
}

/** Everything about one card. Edits are kept until **Save card** is pressed. */
export function CardSheet({
  card,
  board,
  members,
  permissions,
  ownUserId,
  onClose,
}: {
  readonly card: Card;
  readonly board: Board;
  readonly members: readonly BoardMember[];
  readonly permissions: bigint;
  readonly ownUserId: string;
  readonly onClose: () => void;
}) {
  const palette = usePalette();
  const update = useMutation(api.kanban.updateCard);
  const move = useMutation(api.kanban.moveCard);
  const archive = useMutation(api.kanban.archiveCard);
  const deleteCard = useMutation(api.kanban.deleteCard);
  const attach = useMutation(api.kanban.attachFile);
  const uploadUrl = useMutation(api.files.generateUploadUrl);
  const finalize = useAction(api.files.finalize);
  const downloadFile = useAction(api.files.download);
  const comment = useMutation(api.kanban.comment);
  const toggleTimer = useMutation(api.kanban.timer);
  const timer = useMemo(
    () =>
      toggleTimer.withOptimisticUpdate((store, args) => {
        for (const query of store.getAllQueries(api.kanban.listCards))
          if (query.value?.some((entry) => entry._id === args.cardId))
            store.setQuery(
              api.kanban.listCards,
              query.args,
              applyTimer(query.value, args, ownUserId, Date.now()),
            );
      }),
    [toggleTimer, ownUserId],
  );
  const comments = usePaginatedQuery(
    api.kanban.comments,
    { cardId: card._id },
    { initialNumItems: 20 },
  );
  const cards = useQuery(api.kanban.listCards, { boardId: board.id });
  const [showActivity, setShowActivity] = useState(false);
  const history = useQuery(api.kanban.history, showActivity ? { cardId: card._id } : "skip");
  const files = useQuery(api.files.getMany, { fileIds: card.fileIds });

  const [draft, setDraft] = useState(() => draftFor(card));
  const [baseline, setBaseline] = useState(() => JSON.stringify(draftFor(card)));
  const [pending, setPending] = useState<"save" | "comment" | "other" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [checkText, setCheckText] = useState("");
  const [linkText, setLinkText] = useState("");
  const [commentText, setCommentText] = useState("");
  const [editing, setEditing] = useState<Id<"kanbanComments"> | undefined>();
  const timing = useRef(false);
  const scroll = useRef<ScrollView | null>(null);

  const busy = pending !== null;
  const open = !board.archived && !card.archived;
  const canEdit = open && hasPermission(permissions, Permission.EditKanban);
  const canComment = open && hasPermission(permissions, Permission.CommentKanban);
  const canManage = hasPermission(permissions, Permission.ManageKanban);
  const canModerate = open && (canComment || canManage);
  const canAttach = canEdit && hasPermission(permissions, Permission.AttachFiles);
  const running = card.timerStartedAt !== undefined;
  const canTime = canEdit || (open && running && (card.timerUserId === ownUserId || canManage));
  const dirty = JSON.stringify(draft) !== baseline;
  const stale = draft.revision !== card.revision;
  // Only the clock ticks; the rest of the sheet reads the time it opened at.
  const now = useNow(false);
  const done = draft.checklist.filter((item) => item.done).length;
  const due = draft.dueAt ? dueLabel(endOfDay(draft.dueAt), now) : null;
  const column = board.columns.find((entry) => entry.id === card.columnId);
  const boardMembers = members.filter(
    (member) => !board.private || board.memberIds.includes(member.userId),
  );
  const nameOf = (id: string) =>
    members.find((member) => member.userId === id)?.displayName ?? "Former member";
  const labels = board.labels.filter((label) => draft.labelIds.includes(label.id));

  async function run(
    work: () => Promise<unknown>,
    kind: "save" | "comment" | "other" = "other",
  ): Promise<boolean> {
    setPending(kind);
    setError(null);
    try {
      await work();
      return true;
    } catch (cause) {
      setError(failure(cause));
      return false;
    } finally {
      setPending(null);
    }
  }
  function close() {
    if (busy) return;
    if (!dirty && !commentText.trim()) return onClose();
    Alert.alert("Discard unsaved changes?", undefined, [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: onClose },
    ]);
  }
  function reload() {
    const current = draftFor(card);
    setDraft(current);
    setBaseline(JSON.stringify(current));
  }
  function save() {
    void run(async () => {
      await update({
        cardId: card._id,
        ...draft,
        startAt: draft.startAt ? startOfDay(draft.startAt) : null,
        dueAt: draft.dueAt ? endOfDay(draft.dueAt) : null,
        estimateMinutes: draft.estimateMinutes === "" ? null : Number(draft.estimateMinutes),
      });
      const saved = { ...draft, revision: draft.revision + 1 };
      setDraft(saved);
      setBaseline(JSON.stringify(saved));
    }, "save");
  }
  // The timer does not touch the fields being edited, so it never locks the form.
  async function toggle() {
    if (timing.current) return;
    timing.current = true;
    setError(null);
    try {
      await timer({ cardId: card._id, running: !running });
    } catch (cause) {
      setError(failure(cause));
    } finally {
      timing.current = false;
    }
  }
  function moveTo(columnId: string) {
    if (columnId === card.columnId) return;
    void run(async () => {
      await move({ cardId: card._id, columnId });
      // A move bumps the revision without touching anything in the draft.
      setDraft((current) => ({ ...current, revision: current.revision + 1 }));
      setBaseline((current) =>
        JSON.stringify({ ...JSON.parse(current), revision: card.revision + 1 }),
      );
    });
  }
  function addItem() {
    if (!checkText.trim() || draft.checklist.length >= 100) return;
    setDraft({
      ...draft,
      checklist: [...draft.checklist, { id: newItemId(), text: checkText.trim(), done: false }],
    });
    setCheckText("");
  }
  function addLink() {
    const url = linkText.trim();
    if (!isKanbanGithubLink(url)) {
      setError("Paste the link of a GitHub repository, issue or pull request.");
      return;
    }
    setError(null);
    setDraft({ ...draft, githubLinks: [...new Set([...draft.githubLinks, url])] });
    setLinkText("");
  }
  function upload(picked: readonly PickedFile[]) {
    const file = picked[0];
    if (!file) return;
    void run(async () => {
      const bytes = await (await fetch(file.uri)).arrayBuffer();
      const response = await fetch(await uploadUrl({}), {
        method: "POST",
        headers: { "Content-Type": file.mime },
        body: bytes,
      });
      if (!response.ok) throw new Error("Upload failed. Try again.");
      const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
      const fileId = await finalize({
        storageId,
        name: file.name,
        mime: file.mime,
        kanbanBoardId: board.id,
      });
      await attach({ cardId: card._id, fileId });
    });
  }
  function share(file: { id: string; url: string | null; name: string | null }) {
    void run(async () => {
      const token = /[?&]token=([^&]+)/.exec(file.url ?? "")?.[1];
      if (!token) throw new Error("Download link expired. Reopen the card to refresh it.");
      if (!(await Sharing.isAvailableAsync()))
        throw new Error("File sharing is unavailable on this device.");
      const { bytes } = await downloadFile({ token: decodeURIComponent(token) });
      const directory = new Directory(
        Paths.cache,
        "shared-attachments",
        file.id.replace(/[^a-zA-Z0-9_-]/g, "_"),
      );
      directory.create({ idempotent: true, intermediates: true });
      const target = new File(
        directory,
        (file.name ?? "attachment")
          .replace(/[^\p{L}\p{N} ._-]/gu, "_")
          .replace(/^\.+/, "")
          .slice(0, 160) || "attachment",
      );
      target.write(new Uint8Array(bytes));
      await Sharing.shareAsync(target.uri, { dialogTitle: file.name ?? "Attachment" });
    });
  }
  function submitComment() {
    if (!commentText.trim()) return;
    void run(async () => {
      await comment({
        cardId: card._id,
        body: commentText,
        ...(editing ? { commentId: editing } : {}),
      });
      setCommentText("");
      setEditing(undefined);
    }, "comment");
  }
  function confirm(title: string, message: string, label: string, onConfirm: () => void) {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      { text: label, style: "destructive", onPress: onConfirm },
    ]);
  }

  const commentActions = (target: { id: Id<"kanbanComments">; body: string; mine: boolean }) => {
    const actions: SheetAction[] = [
      {
        id: "copy",
        label: "Copy text",
        icon: "copy",
        onPress: () => void Clipboard.setStringAsync(target.body),
      },
    ];
    if (target.mine)
      actions.push(
        {
          id: "edit",
          label: "Edit comment",
          icon: "pencil",
          section: true,
          onPress: () => {
            setEditing(target.id);
            setCommentText(target.body);
          },
        },
        {
          id: "delete",
          label: "Delete comment…",
          icon: "trash",
          danger: true,
          onPress: () =>
            confirm("Delete comment?", "This cannot be undone.", "Delete", () => {
              void run(() =>
                comment({ cardId: card._id, body: "", commentId: target.id, remove: true }),
              );
            }),
        },
      );
    return actions;
  };

  return (
    <Sheet
      visible
      title={`${board.name} · ${column?.name ?? "Unknown column"}`}
      onClose={close}
      swipeToClose={!dirty && !commentText.trim()}
      dismiss={dirty ? "cancel" : "done"}
      footer={
        (dirty || error !== null) && (
          <Animated.View
            entering={FadeInDown.duration(200)}
            className="gap-2 border-t border-border bg-surface-1 px-4 py-3"
          >
            {error !== null && (
              <Text size="sm" tone="danger" accessibilityRole="alert">
                {error}
              </Text>
            )}
            {dirty && canEdit && (
              <View className="flex-row items-center gap-3">
                <Text size="sm" tone="muted" className="flex-1">
                  Unsaved changes
                </Text>
                <Button
                  loading={pending === "save"}
                  disabled={busy || stale || !draft.title.trim()}
                  onPress={save}
                >
                  Save card
                </Button>
              </View>
            )}
          </Animated.View>
        )
      }
    >
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 22 }}
      >
        {card.archived && (
          <View className="flex-row items-center gap-2 rounded-input bg-surface-3 px-3 py-2.5">
            <Icon name="archive" size={16} color={palette["text-muted"]} />
            <Text size="sm" tone="muted" className="flex-1">
              This card is archived. Restore it to make changes.
            </Text>
          </View>
        )}
        {stale && (
          <Animated.View
            entering={FadeInDown.duration(200)}
            className="flex-row items-center gap-3 rounded-input border border-border bg-surface-2 px-3 py-2"
          >
            <Text size="sm" className="flex-1">
              This card changed while you were editing.
            </Text>
            <Button
              size="sm"
              variant="secondary"
              onPress={() =>
                dirty
                  ? confirm(
                      "Replace unsaved card changes?",
                      "Reloading replaces your edits with the latest saved version.",
                      "Reload card",
                      reload,
                    )
                  : reload()
              }
            >
              Reload
            </Button>
          </Animated.View>
        )}

        <TextInput
          accessibilityLabel="Title"
          placeholder="Card title"
          placeholderTextColor={palette["text-muted"]}
          editable={canEdit}
          multiline
          scrollEnabled={false}
          maxLength={200}
          submitBehavior="blurAndSubmit"
          value={draft.title}
          onChangeText={(title) => setDraft({ ...draft, title: title.replace(/\n/g, " ") })}
          className="text-[22px] font-semibold leading-7 text-text"
        />

        <View className="overflow-hidden rounded-card bg-surface-2">
          <PropertyRow
            icon="kanban"
            label="Column"
            onPress={canEdit ? () => setPicker("column") : undefined}
          >
            <Text size="sm" numberOfLines={1}>
              {column?.name ?? "Unknown column"}
            </Text>
          </PropertyRow>
          <PropertyRow
            icon="flag"
            label="Priority"
            onPress={canEdit ? () => setPicker("priority") : undefined}
          >
            <PriorityFlag priority={draft.priority} />
            <Text size="sm">{PRIORITY[draft.priority].label}</Text>
          </PropertyRow>
          <PropertyRow
            icon="users"
            label="Assignees"
            onPress={canEdit ? () => setPicker("assignees") : undefined}
          >
            {draft.assigneeIds.length ? (
              <>
                <AvatarStack
                  userIds={draft.assigneeIds}
                  members={members}
                  max={4}
                  ring="surface-2"
                />
                <Text size="sm" className="shrink" numberOfLines={1}>
                  {draft.assigneeIds.length === 1
                    ? nameOf(draft.assigneeIds[0] ?? "")
                    : `${draft.assigneeIds.length} people`}
                </Text>
              </>
            ) : (
              <Text size="sm" tone="muted">
                {canEdit ? "Assign someone" : "Unassigned"}
              </Text>
            )}
          </PropertyRow>
          <PropertyRow
            icon="label"
            label="Labels"
            onPress={canEdit && board.labels.length ? () => setPicker("labels") : undefined}
          >
            {labels.length ? (
              <>
                {labels.slice(0, 2).map((label) => (
                  <View key={label.id} className="shrink">
                    <LabelChip name={label.name} color={label.color} />
                  </View>
                ))}
                {labels.length > 2 && (
                  <Text size="xs" tone="muted">
                    +{labels.length - 2}
                  </Text>
                )}
              </>
            ) : (
              <Text size="sm" tone="muted">
                {board.labels.length ? (canEdit ? "Add label" : "None") : "No labels on this board"}
              </Text>
            )}
          </PropertyRow>
          <PropertyRow
            icon="calendar"
            label="Start"
            onPress={canEdit ? () => setPicker("start") : undefined}
          >
            <Text size="sm" tone={draft.startAt ? "default" : "muted"}>
              {draft.startAt ? formatDay(draft.startAt) : "None"}
            </Text>
          </PropertyRow>
          <PropertyRow
            icon="calendar"
            label="Due"
            onPress={canEdit ? () => setPicker("due") : undefined}
          >
            <Text size="sm" tone={due?.overdue ? "danger" : draft.dueAt ? "default" : "muted"}>
              {draft.dueAt
                ? `${formatDay(draft.dueAt)}${due?.overdue ? " · Overdue" : ""}`
                : "None"}
            </Text>
          </PropertyRow>
          <PropertyRow icon="timer" label="Estimate" last>
            <TextInput
              accessibilityLabel="Estimate in minutes"
              editable={canEdit}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={palette["text-muted"]}
              maxLength={6}
              value={draft.estimateMinutes}
              onChangeText={(text) =>
                setDraft({ ...draft, estimateMinutes: text.replace(/\D/g, "") })
              }
              className="min-h-9 min-w-[64px] rounded-input bg-surface-3 px-3 text-right text-[15px] text-text"
            />
            <Text size="sm" tone="muted">
              min
            </Text>
          </PropertyRow>
        </View>

        <View className="flex-row items-center gap-3 rounded-card bg-surface-2 px-4 py-3">
          <View className="min-w-0 flex-1">
            <TimerClock card={card} />
            <Text size="xs" tone="muted" numberOfLines={1}>
              {card.timerUserId
                ? `Running · ${nameOf(card.timerUserId)}`
                : card.estimateMinutes !== undefined
                  ? `Tracked of ${card.estimateMinutes} min estimated`
                  : "Time tracked"}
            </Text>
          </View>
          {canTime && (
            <Button
              variant={running ? "primary" : "secondary"}
              disabled={!!card.timerUserId && card.timerUserId !== ownUserId && !canManage}
              accessibilityLabel={running ? "Stop timer" : "Start timer"}
              leading={
                <Icon
                  name={running ? "stop" : "play"}
                  size={18}
                  color={running ? palette["on-accent"] : palette.text}
                />
              }
              onPress={() => void toggle()}
            >
              {running ? "Stop" : "Start"}
            </Button>
          )}
        </View>

        <View className="gap-2">
          <SectionTitle icon="note" title="Notes" />
          <TextInput
            accessibilityLabel="Notes"
            editable={canEdit}
            multiline
            scrollEnabled={false}
            textAlignVertical="top"
            maxLength={30000}
            placeholder={canEdit ? "Add details, context or links…" : "No notes"}
            placeholderTextColor={palette["text-muted"]}
            value={draft.notes}
            onChangeText={(notes) => setDraft({ ...draft, notes })}
            className={`min-h-[96px] ${field}`}
          />
        </View>

        <View className="gap-2">
          <SectionTitle
            icon="checklist"
            title="Checklist"
            aside={
              draft.checklist.length > 0 && (
                <Text size="xs" tone="muted" style={{ fontVariant: ["tabular-nums"] }}>
                  {done} of {draft.checklist.length} done
                </Text>
              )
            }
          />
          {draft.checklist.length > 0 && (
            <View className="h-1.5 overflow-hidden rounded-pill bg-surface-3">
              <Animated.View
                layout={LinearTransition.duration(260)}
                className="h-full rounded-pill"
                style={{
                  width: `${(done / draft.checklist.length) * 100}%`,
                  backgroundColor:
                    done === draft.checklist.length ? palette.secondary : palette.accent,
                }}
              />
            </View>
          )}
          {draft.checklist.map((item) => (
            <Animated.View
              key={item.id}
              entering={FadeInDown.duration(180)}
              exiting={FadeOut.duration(120)}
              layout={LinearTransition.duration(220)}
              className="flex-row items-center"
            >
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.done, disabled: !canEdit }}
                accessibilityLabel={item.text}
                disabled={!canEdit}
                className="min-h-11 flex-1 flex-row items-center gap-3 py-1.5 active:opacity-70"
                onPress={() =>
                  setDraft({
                    ...draft,
                    checklist: draft.checklist.map((entry) =>
                      entry.id === item.id ? { ...entry, done: !entry.done } : entry,
                    ),
                  })
                }
              >
                <CheckBox checked={item.done} />
                <Text
                  size="sm"
                  tone={item.done ? "muted" : "default"}
                  className={`flex-1 ${item.done ? "line-through" : ""}`}
                >
                  {item.text}
                </Text>
              </Pressable>
              {canEdit && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove checklist item ${item.text}`}
                  hitSlop={6}
                  className="h-9 w-9 items-center justify-center rounded-input active:bg-surface-3"
                  onPress={() =>
                    setDraft({
                      ...draft,
                      checklist: draft.checklist.filter((entry) => entry.id !== item.id),
                    })
                  }
                >
                  <Icon name="x" size={16} color={palette["text-muted"]} />
                </Pressable>
              )}
            </Animated.View>
          ))}
          {!draft.checklist.length && !canEdit && (
            <Text size="sm" tone="muted">
              No checklist items.
            </Text>
          )}
          {canEdit && (
            <View className="flex-row gap-2">
              <TextInput
                accessibilityLabel="New checklist item"
                placeholder="Add an item"
                placeholderTextColor={palette["text-muted"]}
                maxLength={500}
                returnKeyType="done"
                submitBehavior="submit"
                value={checkText}
                onChangeText={setCheckText}
                onSubmitEditing={addItem}
                className={`flex-1 ${field}`}
              />
              <Button
                variant="secondary"
                disabled={!checkText.trim() || draft.checklist.length >= 100}
                onPress={addItem}
              >
                Add
              </Button>
            </View>
          )}
        </View>

        <View className="gap-2">
          <SectionTitle icon="link" title="GitHub links" />
          {draft.githubLinks.map((url) => (
            <Animated.View
              key={url}
              entering={FadeInDown.duration(180)}
              exiting={FadeOut.duration(120)}
              className="flex-row items-center"
            >
              <Pressable
                accessibilityRole="link"
                className="min-h-11 flex-1 justify-center active:opacity-70"
                onPress={() => void Linking.openURL(url)}
              >
                <Text size="sm" tone="accent" numberOfLines={2}>
                  {url.replace("https://github.com/", "")}
                </Text>
              </Pressable>
              {canEdit && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Unlink ${url}`}
                  hitSlop={6}
                  className="h-9 w-9 items-center justify-center rounded-input active:bg-surface-3"
                  onPress={() =>
                    setDraft({
                      ...draft,
                      githubLinks: draft.githubLinks.filter((entry) => entry !== url),
                    })
                  }
                >
                  <Icon name="x" size={16} color={palette["text-muted"]} />
                </Pressable>
              )}
            </Animated.View>
          ))}
          {!draft.githubLinks.length && !canEdit && (
            <Text size="sm" tone="muted">
              No linked repositories, issues or pull requests.
            </Text>
          )}
          {canEdit && draft.githubLinks.length < 20 && (
            <View className="flex-row gap-2">
              <TextInput
                accessibilityLabel="GitHub link"
                placeholder="Paste a GitHub link"
                placeholderTextColor={palette["text-muted"]}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="done"
                submitBehavior="submit"
                value={linkText}
                onChangeText={setLinkText}
                onSubmitEditing={addLink}
                className={`flex-1 ${field}`}
              />
              <Button variant="secondary" disabled={!linkText.trim()} onPress={addLink}>
                Link
              </Button>
            </View>
          )}
        </View>

        <View className="gap-2">
          <SectionTitle icon="paperclip" title="Attachments" />
          {files?.map((file) => (
            <Animated.View
              key={file.id}
              entering={FadeInDown.duration(180)}
              exiting={FadeOut.duration(120)}
              className="flex-row items-center gap-2"
            >
              <Icon name="file" size={18} color={palette["text-muted"]} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Download ${file.name ?? "attachment"}`}
                disabled={busy}
                className="min-h-11 flex-1 justify-center active:opacity-70"
                onPress={() => share(file)}
              >
                <Text size="sm" numberOfLines={1}>
                  {file.name ?? "Attachment"}
                </Text>
                <Text size="xs" tone="muted">
                  {Math.ceil(file.sizeBytes / 1024)} KB
                </Text>
              </Pressable>
              {canAttach && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove attachment ${file.name ?? ""}`}
                  disabled={busy}
                  hitSlop={6}
                  className="h-9 w-9 items-center justify-center rounded-input active:bg-surface-3"
                  onPress={() =>
                    void run(() => attach({ cardId: card._id, fileId: file.id, remove: true }))
                  }
                >
                  <Icon name="x" size={16} color={palette["text-muted"]} />
                </Pressable>
              )}
            </Animated.View>
          ))}
          {!card.fileIds.length && !canAttach && (
            <Text size="sm" tone="muted">
              No attachments.
            </Text>
          )}
          {canAttach && (
            <Pressable
              accessibilityRole="button"
              disabled={busy || card.fileIds.length >= 20}
              className={`min-h-11 flex-row items-center gap-2 self-start rounded-input pr-3 active:bg-surface-3 ${
                busy || card.fileIds.length >= 20 ? "opacity-50" : ""
              }`}
              onPress={() => setPicker("attach")}
            >
              <Icon name="plus" size={18} color={palette["text-muted"]} />
              <Text size="sm" tone="muted">
                Add an attachment
              </Text>
            </Pressable>
          )}
        </View>

        <View className="gap-2">
          <SectionTitle icon="message" title="Comments" />
          {(canComment || (canModerate && editing !== undefined)) && (
            <View className="flex-row gap-2.5">
              <MemberAvatar userId={ownUserId} size={32} />
              <View className="min-w-0 flex-1 gap-2">
                <TextInput
                  accessibilityLabel={editing ? "Edit comment" : "New comment"}
                  placeholder="Write a comment…"
                  placeholderTextColor={palette["text-muted"]}
                  multiline
                  scrollEnabled={false}
                  textAlignVertical="top"
                  maxLength={10000}
                  editable={!busy}
                  value={commentText}
                  onChangeText={setCommentText}
                  className={`min-h-[52px] ${field}`}
                />
                {(commentText.trim() !== "" || editing !== undefined) && (
                  <Animated.View entering={FadeIn.duration(160)} className="flex-row gap-2">
                    <Button
                      size="sm"
                      disabled={busy || !commentText.trim()}
                      loading={pending === "comment"}
                      onPress={submitComment}
                    >
                      {editing ? "Save comment" : "Comment"}
                    </Button>
                    {editing !== undefined && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onPress={() => {
                          setEditing(undefined);
                          setCommentText("");
                        }}
                      >
                        Cancel edit
                      </Button>
                    )}
                  </Animated.View>
                )}
              </View>
            </View>
          )}
          {comments.results.map((entry) => {
            const mine = canModerate && (entry.authorId === ownUserId || canManage);
            return (
              <Animated.View
                key={entry.id}
                entering={FadeInDown.duration(200)}
                exiting={FadeOut.duration(120)}
                layout={LinearTransition.duration(220)}
              >
                <Pressable
                  accessibilityHint="Long press for comment actions"
                  delayLongPress={280}
                  onLongPress={() =>
                    setPicker({ comment: { id: entry.id, body: entry.body, mine } })
                  }
                  className={`flex-row gap-2.5 rounded-input py-1.5 active:opacity-70 ${
                    editing === entry.id ? "bg-accent-soft px-2" : ""
                  }`}
                >
                  <MemberAvatar userId={entry.authorId} size={32} />
                  <View className="min-w-0 flex-1">
                    <View className="flex-row items-center gap-2">
                      <Text size="sm" className="shrink font-semibold" numberOfLines={1}>
                        {nameOf(entry.authorId)}
                      </Text>
                      <Text size="xs" tone="muted">
                        {timeAgo(entry.at, now)}
                        {entry.updatedAt > entry.at + 1000 ? " · edited" : ""}
                      </Text>
                    </View>
                    <Text size="sm" className="leading-[22px]">
                      {entry.body}
                    </Text>
                  </View>
                </Pressable>
              </Animated.View>
            );
          })}
          {comments.status === "LoadingFirstPage" && (
            <Text size="sm" tone="muted">
              Loading comments…
            </Text>
          )}
          {!comments.results.length && comments.status !== "LoadingFirstPage" && (
            <Text size="sm" tone="muted">
              No comments yet.
            </Text>
          )}
          {comments.status === "CanLoadMore" && (
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              onPress={() => comments.loadMore(20)}
            >
              Load older comments
            </Button>
          )}
        </View>

        <View className="gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showActivity }}
            className="min-h-11 flex-row items-center gap-2 active:opacity-70"
            onPress={() => setShowActivity(!showActivity)}
          >
            <Icon name="history" size={18} color={palette["text-muted"]} />
            <Text className="flex-1 font-semibold">Activity</Text>
            <View style={{ transform: [{ rotate: showActivity ? "180deg" : "0deg" }] }}>
              <Icon name="chevron-down" size={16} color={palette["text-muted"]} />
            </View>
          </Pressable>
          {showActivity && (
            <Animated.View
              entering={FadeIn.duration(200)}
              className="gap-2 border-l border-border pl-3"
            >
              {history?.map((entry, index) => (
                <Animated.View
                  key={entry.id}
                  entering={FadeInDown.duration(180).delay(Math.min(index * 20, 200))}
                >
                  <Text size="xs" tone="muted">
                    <Text size="xs" className="font-medium">
                      {nameOf(entry.actorId)}
                    </Text>{" "}
                    {entry.body} · {timeAgo(entry.at, now)}
                  </Text>
                </Animated.View>
              ))}
              <Text size="xs" tone="muted">
                {history === undefined
                  ? "Loading activity…"
                  : history.length
                    ? "Showing the latest 50 events."
                    : "No activity yet."}
              </Text>
            </Animated.View>
          )}
        </View>

        {(canManage || (!board.archived && hasPermission(permissions, Permission.EditKanban))) && (
          <View className="flex-row flex-wrap gap-2 border-t border-border pt-4">
            {!board.archived && hasPermission(permissions, Permission.EditKanban) && (
              <Button
                variant="secondary"
                disabled={busy}
                accessibilityLabel={card.archived ? "Restore card" : "Archive card"}
                leading={
                  <Icon
                    name={card.archived ? "unarchive" : "archive"}
                    size={18}
                    color={palette.text}
                  />
                }
                onPress={() =>
                  void run(() => archive({ cardId: card._id, archived: !card.archived })).then(
                    (saved) => saved && onClose(),
                  )
                }
              >
                {card.archived ? "Restore" : "Archive"}
              </Button>
            )}
            {canManage && (
              <Button
                variant="ghost"
                disabled={busy}
                accessibilityLabel="Delete card"
                leading={<Icon name="trash" size={18} color={palette.danger} />}
                onPress={() =>
                  confirm(
                    "Permanently delete card?",
                    "This deletes the card with its comments, activity and attachments. It cannot be undone.",
                    "Delete card",
                    () =>
                      void run(() => deleteCard({ cardId: card._id })).then(
                        (saved) => saved && onClose(),
                      ),
                  )
                }
              >
                <Text tone="danger" className="font-medium">
                  Delete
                </Text>
              </Button>
            )}
          </View>
        )}
      </ScrollView>

      {picker === "column" && (
        <PickerSheet
          title="Move to column"
          options={board.columns.map((entry) => {
            const full = entry.id !== card.columnId && isColumnFull(entry, cards ?? []);
            return {
              id: entry.id,
              label: entry.name,
              disabled: full,
              ...(full ? { hint: "Column limit reached" } : {}),
            };
          })}
          selected={[card.columnId]}
          onChange={([columnId]) => columnId && moveTo(columnId)}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === "priority" && (
        <PickerSheet
          title="Priority"
          options={PRIORITIES.map((priority) => ({
            id: priority,
            label: PRIORITY[priority].label,
            leading: <PriorityFlag priority={priority} />,
          }))}
          selected={[draft.priority]}
          onChange={([priority]) =>
            priority && setDraft({ ...draft, priority: priority as Card["priority"] })
          }
          onClose={() => setPicker(null)}
        />
      )}
      {picker === "assignees" && (
        <PickerSheet
          multiple
          title="Assignees"
          searchPlaceholder="Find a person"
          emptyText="Nobody can be assigned on this board"
          options={[
            ...draft.assigneeIds
              .filter((id) => !boardMembers.some((member) => member.userId === id))
              .map((id) => ({ userId: id, displayName: "Former member" })),
            ...boardMembers,
          ].map((member) => ({
            id: member.userId,
            label: member.displayName,
            leading: <MemberAvatar userId={member.userId} size={28} />,
          }))}
          selected={draft.assigneeIds}
          onChange={(assigneeIds) => setDraft({ ...draft, assigneeIds })}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === "labels" && (
        <PickerSheet
          multiple
          title="Labels"
          options={board.labels.map((label) => ({
            id: label.id,
            label: label.name,
            leading: (
              <View className="h-3 w-3 rounded-pill" style={{ backgroundColor: label.color }} />
            ),
          }))}
          selected={draft.labelIds}
          onChange={(labelIds) => setDraft({ ...draft, labelIds })}
          onClose={() => setPicker(null)}
        />
      )}
      {(picker === "start" || picker === "due") && (
        <DateSheet
          title={picker === "start" ? "Start date" : "Due date"}
          value={picker === "start" ? draft.startAt : draft.dueAt}
          now={now}
          onChange={(day) =>
            setDraft(picker === "start" ? { ...draft, startAt: day } : { ...draft, dueAt: day })
          }
          onClose={() => setPicker(null)}
        />
      )}
      {picker === "attach" && (
        <ActionSheet
          title="Add an attachment"
          actions={[
            {
              id: "photo",
              label: "Photo library",
              icon: "image",
              onPress: () => void pickFromLibrary().then(upload, () => undefined),
            },
            {
              id: "file",
              label: "Choose a file",
              icon: "file",
              onPress: () => void pickDocuments().then(upload, () => undefined),
            },
          ]}
          onClose={() => setPicker(null)}
        />
      )}
      {typeof picker === "object" && picker !== null && (
        <ActionSheet
          title="Comment"
          actions={commentActions(picker.comment)}
          onClose={() => setPicker(null)}
        />
      )}
    </Sheet>
  );
}
