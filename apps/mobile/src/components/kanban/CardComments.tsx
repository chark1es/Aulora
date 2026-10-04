import { Button, Icon, Text, usePalette } from "@aulora/ui-native";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from "react-native-reanimated";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { timeAgo } from "../../lib/kanban";
import { MemberAvatar } from "../chat/MemberAvatar";
import { confirm } from "./board-menus";
import { field } from "./CardChecklist";
import { SectionTitle } from "./parts";
import { ActionSheet, type SheetAction } from "./sheets";
import type { CardComment, CardEditor } from "./use-card-editor";

interface SectionProps {
  readonly editor: CardEditor;
}

function nameOf(editor: CardEditor, userId: string): string {
  return editor.members.find((member) => member.userId === userId)?.displayName ?? "Former member";
}

/** Whether the viewer may edit or delete this comment. */
function mayChange(editor: CardEditor, entry: CardComment): boolean {
  return editor.canModerate && (entry.authorId === editor.ownUserId || editor.canManage);
}

/** Posting, editing and deleting comments on the card. */
function useCommentWrites(editor: CardEditor) {
  const comment = useMutation(api.kanbanComments.comment);
  const { card, commentText, editingComment } = editor;
  const submit = () => {
    if (!commentText.trim()) return;
    void editor.run(async () => {
      await comment({
        cardId: card._id,
        body: commentText,
        ...(editingComment === undefined ? {} : { commentId: editingComment.id }),
      });
      editor.setCommentText("");
      editor.setEditingComment(undefined);
    }, "comment");
  };
  const remove = (entry: CardComment) => {
    void editor.run(() =>
      comment({ cardId: card._id, body: "", commentId: entry.id, remove: true }),
    );
  };
  return { submit, remove };
}

function Composer({ editor, onSubmit }: SectionProps & { readonly onSubmit: () => void }) {
  const palette = usePalette();
  const editing = editor.editingComment !== undefined;
  const text = editor.commentText;
  return (
    <View className="flex-row gap-2.5">
      <MemberAvatar userId={editor.ownUserId} size={32} />
      <View className="min-w-0 flex-1 gap-2">
        <TextInput
          accessibilityLabel={editing ? "Edit comment" : "New comment"}
          placeholder="Write a comment…"
          placeholderTextColor={palette["text-muted"]}
          multiline
          scrollEnabled={false}
          textAlignVertical="top"
          maxLength={10000}
          editable={!editor.busy}
          value={text}
          onChangeText={editor.setCommentText}
          className={`min-h-[52px] ${field}`}
        />
        {(text.trim() !== "" || editing) && (
          <Animated.View entering={FadeIn.duration(160)} className="flex-row gap-2">
            <Button
              size="sm"
              disabled={editor.busy || !text.trim()}
              loading={editor.pending === "comment"}
              onPress={onSubmit}
            >
              {editing ? "Save comment" : "Comment"}
            </Button>
            {editing && (
              <Button
                size="sm"
                variant="ghost"
                onPress={() => {
                  editor.setEditingComment(undefined);
                  editor.setCommentText("");
                }}
              >
                Cancel edit
              </Button>
            )}
          </Animated.View>
        )}
      </View>
    </View>
  );
}

interface CommentRowProps extends SectionProps {
  readonly entry: CardComment;
  readonly onActions: (entry: CardComment) => void;
}

function CommentRow({ editor, entry, onActions }: CommentRowProps) {
  const edited = entry.updatedAt > entry.at + 1000 ? " · edited" : "";
  const editing = editor.editingComment?.id === entry.id;
  return (
    <Animated.View
      entering={FadeInDown.duration(200)}
      exiting={FadeOut.duration(120)}
      layout={LinearTransition.duration(220)}
    >
      <Pressable
        accessibilityHint="Long press for comment actions"
        delayLongPress={280}
        onLongPress={() => {
          onActions(entry);
        }}
        className={`flex-row gap-2.5 rounded-input py-1.5 active:opacity-70 ${
          editing ? "bg-accent-soft px-2" : ""
        }`}
      >
        <MemberAvatar userId={entry.authorId} size={32} />
        <View className="min-w-0 flex-1">
          <View className="flex-row items-center gap-2">
            <Text size="sm" className="shrink font-semibold" numberOfLines={1}>
              {nameOf(editor, entry.authorId)}
            </Text>
            <Text size="xs" tone="muted">
              {timeAgo(entry.at, editor.now)}
              {edited}
            </Text>
          </View>
          <Text size="sm" className="leading-[22px]">
            {entry.body}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** Copy for everyone; edit and delete for the author or a board manager. */
function commentActions(
  editor: CardEditor,
  entry: CardComment,
  remove: (entry: CardComment) => void,
): SheetAction[] {
  const copy: SheetAction = {
    id: "copy",
    label: "Copy text",
    icon: "copy",
    onPress: () => {
      void Clipboard.setStringAsync(entry.body);
    },
  };
  if (!mayChange(editor, entry)) return [copy];
  return [
    copy,
    {
      id: "edit",
      label: "Edit comment",
      icon: "pencil",
      section: true,
      onPress: () => {
        editor.setEditingComment(entry);
        editor.setCommentText(entry.body);
      },
    },
    {
      id: "delete",
      label: "Delete comment…",
      icon: "trash",
      danger: true,
      onPress: () => {
        confirm("Delete comment?", "This cannot be undone.", "Delete", () => {
          remove(entry);
        });
      },
    },
  ];
}

function listStatus(status: string, count: number): string | null {
  if (status === "LoadingFirstPage") return "Loading comments…";
  return count === 0 ? "No comments yet." : null;
}

export function CardComments({ editor }: SectionProps) {
  const comments = usePaginatedQuery(
    api.kanbanComments.comments,
    { cardId: editor.card._id },
    { initialNumItems: 20 },
  );
  const writes = useCommentWrites(editor);
  const [target, setTarget] = useState<CardComment>();
  const status = listStatus(comments.status, comments.results.length);
  const mayWrite = editor.canComment || (editor.canModerate && editor.editingComment !== undefined);
  return (
    <View className="gap-2">
      <SectionTitle icon="message" title="Comments" />
      {mayWrite && <Composer editor={editor} onSubmit={writes.submit} />}
      {comments.results.map((entry) => (
        <CommentRow key={entry.id} editor={editor} entry={entry} onActions={setTarget} />
      ))}
      {status !== null && (
        <Text size="sm" tone="muted">
          {status}
        </Text>
      )}
      {comments.status === "CanLoadMore" && (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          onPress={() => {
            comments.loadMore(20);
          }}
        >
          Load older comments
        </Button>
      )}
      {target !== undefined && (
        <ActionSheet
          title="Comment"
          actions={commentActions(editor, target, writes.remove)}
          onClose={() => {
            setTarget(undefined);
          }}
        />
      )}
    </View>
  );
}

function historyStatus(count: number | undefined): string {
  if (count === undefined) return "Loading activity…";
  return count > 0 ? "Showing the latest 50 events." : "No activity yet.";
}

/** Who did what to the card, loaded only once the section is opened. */
export function CardActivity({ editor }: SectionProps) {
  const palette = usePalette();
  const [shown, setShown] = useState(false);
  const history = useQuery(
    api.kanbanComments.history,
    shown ? { cardId: editor.card._id } : "skip",
  );
  return (
    <View className="gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: shown }}
        className="min-h-11 flex-row items-center gap-2 active:opacity-70"
        onPress={() => {
          setShown(!shown);
        }}
      >
        <Icon name="history" size={18} color={palette["text-muted"]} />
        <Text className="flex-1 font-semibold">Activity</Text>
        <View style={{ transform: [{ rotate: shown ? "180deg" : "0deg" }] }}>
          <Icon name="chevron-down" size={16} color={palette["text-muted"]} />
        </View>
      </Pressable>
      {shown && (
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
                  {nameOf(editor, entry.actorId)}
                </Text>{" "}
                {entry.body} · {timeAgo(entry.at, editor.now)}
              </Text>
            </Animated.View>
          ))}
          <Text size="xs" tone="muted">
            {historyStatus(history?.length)}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}
