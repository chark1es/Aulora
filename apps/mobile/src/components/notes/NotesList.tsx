/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */

import { highlightMatches } from "@aulora/core";
import { Button, EmptyState, Icon, IconButton, Text, usePalette } from "@aulora/ui-native";
import { Pressable, ScrollView, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { timeAgo } from "../../lib/kanban";
import { folderChildren, folderPath, noteCountLabel, noteTitle, tagsForIds } from "../../lib/notes";
import { PaneHeader, RoundButton } from "../chat/HubPane";
import { HorizontalScroll } from "../chat/SwipePanes";
import { SearchField } from "../kanban/sheets";
import { NoteBackButton, NotesError, NotesLoading, NoteTagChip } from "./NoteParts";
import type { NoteFolderView, NoteListItem, NotesController } from "./use-notes";

/** Search, new-note, and the overflow menu in the pane header. */
function NotesHeaderActions({ ctl }: { readonly ctl: NotesController }) {
  const palette = usePalette();
  return (
    <View className="flex-row items-center gap-1">
      <IconButton
        label={ctl.searching ? "Close search" : "Search notes"}
        size="sm"
        onPress={() => {
          if (ctl.searching) ctl.setFilters({ ...ctl.filters, query: "" });
          ctl.setSearching(!ctl.searching);
        }}
      >
        <Icon
          name={ctl.searching ? "x" : "search"}
          size={20}
          color={ctl.filters.query.trim() ? palette.accent : palette.text}
        />
      </IconButton>
      {ctl.permissions.create && (
        <>
          <RoundButton icon="plus" label="New note" tone="accent" onPress={ctl.newNote} />
          <IconButton
            label="New note options"
            size="sm"
            onPress={() => {
              ctl.setOpen({ kind: "create" });
            }}
          >
            <Icon name="chevron-down" size={18} color={palette.text} />
          </IconButton>
        </>
      )}
      <IconButton
        label="More note actions"
        size="sm"
        onPress={() => {
          ctl.setOpen({ kind: "more" });
        }}
      >
        <Icon name="more-horizontal" size={20} color={palette.text} />
      </IconButton>
    </View>
  );
}

function NotesHeader({ ctl }: { readonly ctl: NotesController }) {
  const inFolder = ctl.filters.folderId !== undefined && ctl.filters.folderId !== null;
  const folder = inFolder
    ? ctl.folders.find((entry) => entry.id === ctl.filters.folderId)
    : undefined;
  const title = folder?.name ?? (ctl.filters.archived ? "Archived notes" : "Notes");
  const subtitle = folder === undefined ? undefined : folderPath(ctl.folders, folder.id);
  return (
    <PaneHeader
      title={title}
      subtitle={subtitle}
      leading={
        inFolder ? (
          <NoteBackButton label="Up one folder" onPress={ctl.goUpFolder} />
        ) : ctl.onBack === undefined ? undefined : (
          <NoteBackButton onPress={ctl.onBack} />
        )
      }
      trailing={<NotesHeaderActions ctl={ctl} />}
    />
  );
}

function RailChip({
  label,
  active,
  icon,
  onPress,
  onLongPress,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly icon?: "plus" | undefined;
  readonly onPress: () => void;
  readonly onLongPress?: (() => void) | undefined;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      hitSlop={4}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={280}
      className={`min-h-9 flex-row items-center gap-1.5 rounded-pill border px-3 active:opacity-70 ${
        active ? "border-accent bg-accent-soft" : "border-border bg-surface-2"
      }`}
    >
      {icon !== undefined && (
        <Icon name={icon} size={16} color={active ? palette.accent : palette["text-muted"]} />
      )}
      <Text size="sm" tone={active ? "default" : "muted"} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function FolderRail({ ctl }: { readonly ctl: NotesController }) {
  const totalInView = ctl.notes.filter((note) => note.archived === ctl.filters.archived).length;
  return (
    <View className="border-b border-border">
      <HorizontalScroll
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          gap: 8,
          paddingHorizontal: 16,
          paddingVertical: 8,
          alignItems: "center",
        }}
      >
        <RailChip
          label="All"
          active={ctl.filters.folderId === undefined}
          onPress={() => {
            ctl.setFilters({ ...ctl.filters, folderId: undefined });
          }}
        />
        <RailChip
          label="Unfiled"
          active={ctl.filters.folderId === null}
          onPress={() => {
            ctl.setFilters({ ...ctl.filters, folderId: null });
          }}
        />
        {ctl.flatFolders.map((entry) => (
          <RailChip
            key={entry.folder.id}
            label={`${"  ".repeat(entry.depth)}${entry.folder.name}`}
            active={ctl.filters.folderId === entry.folder.id}
            onPress={() => {
              ctl.setFilters({ ...ctl.filters, folderId: entry.folder.id });
            }}
            onLongPress={
              ctl.permissions.edit || ctl.permissions.remove
                ? () => {
                    ctl.setOpen({ kind: "folder", folderId: entry.folder.id });
                  }
                : undefined
            }
          />
        ))}
        {ctl.permissions.create && (
          <RailChip
            label="Folder"
            icon="plus"
            active={false}
            onPress={() => {
              ctl.setOpen({ kind: "folderForm", folderId: null, parentId: null });
            }}
          />
        )}
        <RailChip
          label={ctl.filters.tagIds.length > 0 ? `Tags (${ctl.filters.tagIds.length})` : "Tags"}
          active={ctl.filters.tagIds.length > 0}
          onPress={() => {
            ctl.setOpen({ kind: "tagFilter" });
          }}
        />
        <Text size="xs" tone="muted" style={{ fontVariant: ["tabular-nums"] }}>
          {noteCountLabel(ctl.visible.length, totalInView, {
            archived: ctl.filters.archived,
            filtering: ctl.selecting,
          })}
        </Text>
      </HorizontalScroll>
    </View>
  );
}

function NoteRowSnippet({
  ctl,
  note,
}: {
  readonly ctl: NotesController;
  readonly note: NoteListItem;
}) {
  const query = ctl.filters.query.trim();
  const snippet = ctl.hits.get(note.id)?.snippet;
  if (query.length === 0 || snippet === undefined || snippet.length === 0) return null;
  return (
    <Text size="xs" tone="muted" numberOfLines={2}>
      {highlightMatches(snippet, query).map((segment, index) =>
        segment.match ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional text runs
          <Text key={index} className="font-semibold text-accent">
            {segment.text}
          </Text>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional text runs
          <Text key={index}>{segment.text}</Text>
        ),
      )}
    </Text>
  );
}

function NoteRowTitle({
  ctl,
  note,
}: {
  readonly ctl: NotesController;
  readonly note: NoteListItem;
}) {
  const palette = usePalette();
  return (
    <View className="flex-row items-center gap-2">
      <Text className="min-w-0 flex-1 font-medium" numberOfLines={1}>
        {noteTitle(note)}
      </Text>
      {note.archived && <Icon name="archive" size={14} color={palette["text-muted"]} />}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Actions for ${noteTitle(note)}`}
        hitSlop={8}
        onPress={() => {
          ctl.setOpen({ kind: "note", noteId: note.id });
        }}
        className="h-8 w-8 items-center justify-center rounded-input active:bg-surface-3"
      >
        <Icon name="more-horizontal" size={18} color={palette["text-muted"]} />
      </Pressable>
    </View>
  );
}

function NoteRow({
  ctl,
  note,
  index,
  now,
}: {
  readonly ctl: NotesController;
  readonly note: NoteListItem;
  readonly index: number;
  readonly now: number;
}) {
  const tags = tagsForIds(ctl.tags, note.tagIds).slice(0, 3);
  const folder =
    note.folderId === null ? undefined : ctl.folders.find((f) => f.id === note.folderId);
  return (
    <Animated.View entering={FadeIn.duration(180).delay(Math.min(index * 20, 160))}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open note ${noteTitle(note)}`}
        accessibilityHint="Long press for note actions"
        delayLongPress={280}
        onPress={() => {
          ctl.openNote(note.id);
        }}
        onLongPress={() => {
          ctl.setOpen({ kind: "note", noteId: note.id });
        }}
        className="gap-1.5 border-b border-border px-4 py-3 active:bg-surface-2"
      >
        <NoteRowTitle ctl={ctl} note={note} />
        <NoteRowSnippet ctl={ctl} note={note} />
        {tags.length > 0 && (
          <View className="flex-row flex-wrap gap-1">
            {tags.map((tag) => (
              <NoteTagChip key={tag.id} tag={tag} />
            ))}
          </View>
        )}
        <View className="flex-row items-center gap-2">
          <Text size="xs" tone="muted" className="min-w-0 flex-1" numberOfLines={1}>
            {ctl.searching
              ? folder === undefined
                ? "Unfiled"
                : folderPath(ctl.folders, folder.id)
              : (folder?.name ?? "Unfiled")}
          </Text>
          <Text size="xs" tone="muted">
            {timeAgo(note.updatedAt, now)}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** A subfolder row: name, an item count and a chevron to drill in. */
function FolderRow({
  ctl,
  folder,
  onOpen,
}: {
  readonly ctl: NotesController;
  readonly folder: NoteFolderView;
  readonly onOpen: () => void;
}) {
  const palette = usePalette();
  const childCount = folderChildren(ctl.folders, folder.id).length;
  const noteCount = ctl.notes.filter(
    (note) => note.folderId === folder.id && note.archived === ctl.filters.archived,
  ).length;
  const parts = [
    childCount > 0 ? `${childCount} ${childCount === 1 ? "folder" : "folders"}` : "",
    noteCount > 0 ? `${noteCount} ${noteCount === 1 ? "note" : "notes"}` : "",
  ].filter((part) => part.length > 0);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open folder ${folder.name}`}
      onPress={onOpen}
      onLongPress={() => {
        if (ctl.permissions.edit || ctl.permissions.remove) {
          ctl.setOpen({ kind: "folder", folderId: folder.id });
        }
      }}
      className="flex-row items-center gap-3 border-b border-border px-4 py-3 active:bg-surface-2"
    >
      <Icon name="file" size={20} color={palette.accent} />
      <View className="min-w-0 flex-1">
        <Text className="font-medium" numberOfLines={1}>
          {folder.name}
        </Text>
        <Text size="xs" tone="muted" numberOfLines={1}>
          {parts.length > 0 ? parts.join(" · ") : "Empty"}
        </Text>
      </View>
      <Icon name="chevron-right" size={20} color={palette["text-muted"]} />
    </Pressable>
  );
}

function NotesEmpty({ ctl }: { readonly ctl: NotesController }) {
  const heading = ctl.filters.archived
    ? "No archived notes"
    : ctl.selecting
      ? "No matching notes"
      : "Write your first note";
  return (
    <EmptyState
      icon="note"
      title={heading}
      message={
        ctl.filters.archived
          ? "Notes you archive are kept here until you restore or delete them."
          : ctl.selecting
            ? "Try a different search or clear the filters."
            : "Notes are written in Markdown and can be filed into folders and tagged."
      }
    >
      {!ctl.filters.archived && ctl.permissions.create && (
        <Button onPress={ctl.newNote}>New note</Button>
      )}
    </EmptyState>
  );
}

function NoteListBody({ ctl }: { readonly ctl: NotesController }) {
  const now = Date.now();
  const folders = ctl.childFoldersInView;
  if (ctl.visible.length === 0 && folders.length === 0) return <NotesEmpty ctl={ctl} />;
  const grouped = ctl.filters.query.trim().length === 0 && ctl.order === "updated";
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 16 }}>
      {folders.map((folder) => (
        <FolderRow
          key={folder.id}
          ctl={ctl}
          folder={folder}
          onOpen={() => {
            ctl.openFolder(folder.id);
          }}
        />
      ))}
      {ctl.visible.length > 0 && folders.length > 0 && (
        <Text
          size="xs"
          tone="muted"
          className="px-4 pb-1 pt-3 font-semibold uppercase"
          accessibilityRole="header"
        >
          Notes
        </Text>
      )}
      {grouped
        ? ctl.groups.map((group) => (
            <View key={group.key}>
              <Text
                size="xs"
                tone="muted"
                className="px-4 pb-1 pt-3 font-semibold uppercase"
                accessibilityRole="header"
              >
                {group.label}
              </Text>
              {group.notes.map((note, index) => (
                <NoteRow key={note.id} ctl={ctl} note={note} index={index} now={now} />
              ))}
            </View>
          ))
        : ctl.visible.map((note, index) => (
            <NoteRow key={note.id} ctl={ctl} note={note} index={index} now={now} />
          ))}
    </ScrollView>
  );
}

/** The folders-and-notes list, with search, filters and the note rows. */
export function NotesList({ ctl }: { readonly ctl: NotesController }) {
  if (ctl.overview === undefined) return <NotesLoading label="Loading notes" />;
  return (
    <View className="flex-1">
      <NotesHeader ctl={ctl} />
      <NotesError ctl={ctl} />
      {ctl.searching && (
        <SearchField
          label="Search notes"
          value={ctl.filters.query}
          onChange={(query) => {
            ctl.setFilters({ ...ctl.filters, query });
          }}
        />
      )}
      <FolderRail ctl={ctl} />
      <NoteListBody ctl={ctl} />
    </View>
  );
}
