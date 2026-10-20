/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import {
  type DiffLine,
  diffLines,
  diffStats,
  formatEditCount,
  formatLineStats,
  groupHistory,
  type HistoryGroup,
  type RevisionSummary,
  type RevisionSummaryOptions,
  summarizeRevision,
} from "@aulora/core";
import { Icon, Text, usePalette } from "@aulora/ui-native";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { timeAgo } from "../../lib/kanban";
import { noteTitle } from "../../lib/notes";
import { useReduceMotion } from "../../lib/use-entrance";
import { PaneHeader } from "../chat/HubPane";
import { NoteBackButton, NotesError, NotesLoading } from "./NoteParts";
import { formatGroupTime } from "./note-history-format";
import type { NoteHistoryEntry, NotesController } from "./use-notes";

function actorName(ctl: NotesController, actorId: string): string {
  if (actorId === ctl.ownUserId) return "You";
  return ctl.members.find((member) => member.userId === actorId)?.displayName ?? "Someone";
}

/**
 * Fades an expanded block in, but only once the OS has said Reduce Motion is
 * off. While the preference is unknown it renders statically, matching
 * `useEntrance`'s rule of never animating before the answer arrives.
 */
function Reveal({ children }: { readonly children: ReactNode }) {
  const reduced = useReduceMotion();
  if (reduced !== false) return <>{children}</>;
  return <Animated.View entering={FadeIn.duration(160)}>{children}</Animated.View>;
}

function lineTint(
  type: DiffLine["type"],
  palette: ReturnType<typeof usePalette>,
): string | undefined {
  if (type === "add") return `${palette.secondary}1F`;
  if (type === "del") return `${palette.danger}1F`;
  return undefined;
}

function DiffView({ lines }: { readonly lines: readonly DiffLine[] }) {
  const palette = usePalette();
  if (lines.length === 0) {
    return (
      <Text size="xs" tone="muted" className="px-3 py-2">
        No text changes
      </Text>
    );
  }
  return (
    <View className="mt-2 overflow-hidden rounded-input">
      {lines.map((line, index) => {
        const lineKey = `${index}:${line.type}`;
        return (
          <View
            key={lineKey}
            className="flex-row"
            style={{ backgroundColor: lineTint(line.type, palette) }}
          >
            <Text
              mono
              size="xs"
              className="w-5 text-center"
              style={{ color: palette["text-muted"] }}
            >
              {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
            </Text>
            <Text mono size="xs" className="flex-1" style={{ color: palette.text }}>
              {line.text.length > 0 ? line.text : " "}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** The expanded body of one revision; the line diff is only built when opened. */
function RevisionDetail({
  revision,
  summary,
}: {
  readonly revision: NoteHistoryEntry;
  readonly summary: RevisionSummary;
}) {
  const lines = useMemo(
    () => diffLines(revision.before?.body ?? "", revision.after?.body ?? ""),
    [revision],
  );
  const stats = useMemo(() => diffStats(lines), [lines]);
  const bodyChanged = stats.added + stats.removed > 0;
  const meta = summary.details.filter((detail) => detail.kind !== "body");
  if (!bodyChanged && meta.length === 0) {
    return (
      <Text size="xs" tone="muted" className="px-3 py-2">
        No text changes
      </Text>
    );
  }
  return (
    <View className="gap-1 px-3 pb-2">
      {meta.map((detail) => (
        <Text key={`${detail.kind}:${detail.text}`} size="xs" tone="muted">
          {detail.text}
        </Text>
      ))}
      {bodyChanged && <DiffView lines={lines} />}
    </View>
  );
}

/** One tappable row header: a chevron, the summary and the time. */
function RowHeader({
  expanded,
  label,
  sublabel,
  testID,
  onToggle,
}: {
  readonly expanded: boolean;
  readonly label: ReactNode;
  readonly sublabel?: ReactNode;
  readonly testID?: string;
  readonly onToggle: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      testID={testID}
      className="flex-row items-center gap-2 px-4 py-3 active:bg-surface-2"
      onPress={onToggle}
    >
      <Icon
        name={expanded ? "chevron-down" : "chevron-right"}
        size={16}
        color={palette["text-muted"]}
      />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="min-w-0" numberOfLines={1}>
          {label}
        </Text>
        {sublabel !== undefined && (
          <Text size="xs" tone="muted" style={{ fontVariant: ["tabular-nums"] }} numberOfLines={1}>
            {sublabel}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function RevisionRow({
  ctl,
  options,
  revision,
  open,
  now,
  onToggle,
}: {
  readonly ctl: NotesController;
  readonly options: RevisionSummaryOptions;
  readonly revision: NoteHistoryEntry;
  readonly open: boolean;
  readonly now: number;
  readonly onToggle: () => void;
}) {
  const summary = useMemo(() => summarizeRevision(revision, options), [revision, options]);
  return (
    <View className="border-b border-border">
      <RowHeader
        expanded={open}
        testID={`note-revision-${revision.id}`}
        label={
          <>
            <Text className="font-medium">{actorName(ctl, revision.actorId)}</Text>{" "}
            {summary.headline}
          </>
        }
        sublabel={timeAgo(revision.at, now)}
        onToggle={onToggle}
      />
      {open && (
        <Reveal>
          <RevisionDetail revision={revision} summary={summary} />
        </Reveal>
      )}
    </View>
  );
}

interface EditGroupProps {
  readonly ctl: NotesController;
  readonly options: RevisionSummaryOptions;
  readonly group: HistoryGroup<NoteHistoryEntry>;
  readonly now: number;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly openIds: ReadonlySet<string>;
  readonly onToggleRevision: (id: string) => void;
}

function EditGroupRow(props: EditGroupProps) {
  const { ctl, options, group, now, open, onToggle, openIds, onToggleRevision } = props;
  return (
    <View className="border-b border-border">
      <RowHeader
        expanded={open}
        testID={`note-edit-group-${group.id}`}
        label={`${formatEditCount(group.revisions.length)} by ${actorName(ctl, group.actorId)}`}
        sublabel={`${formatGroupTime(group.from, group.to, now)} · ${formatLineStats(group.stats)}`}
        onToggle={onToggle}
      />
      {open && (
        <Reveal>
          <View className="bg-surface-2/40">
            {group.revisions.map((revision) => (
              <RevisionRow
                key={revision.id}
                ctl={ctl}
                options={options}
                revision={revision}
                open={openIds.has(revision.id)}
                now={now}
                onToggle={() => {
                  onToggleRevision(revision.id);
                }}
              />
            ))}
          </View>
        </Reveal>
      )}
    </View>
  );
}

function toggleInSet(current: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** One group's row: a run of edits, or a lone revision rendered directly. */
interface HistoryGroupRowProps {
  readonly ctl: NotesController;
  readonly options: RevisionSummaryOptions;
  readonly group: HistoryGroup<NoteHistoryEntry>;
  readonly now: number;
  readonly openIds: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly onToggleRevision: (id: string) => void;
}

function HistoryGroupRow(props: HistoryGroupRowProps) {
  const { ctl, options, group, now, openIds, onToggle, onToggleRevision } = props;
  if (group.kind === "edits") {
    return (
      <EditGroupRow
        ctl={ctl}
        options={options}
        group={group}
        now={now}
        open={openIds.has(group.id)}
        onToggle={() => {
          onToggle(group.id);
        }}
        openIds={openIds}
        onToggleRevision={onToggleRevision}
      />
    );
  }
  const entry = group.revisions.at(0);
  if (entry === undefined) return null;
  return (
    <RevisionRow
      ctl={ctl}
      options={options}
      revision={entry}
      open={openIds.has(entry.id)}
      now={now}
      onToggle={() => {
        onToggle(entry.id);
      }}
    />
  );
}

/** Folder and tag name lookups so summaries read "moved to Work", not an id. */
function useSummaryOptions(ctl: NotesController): RevisionSummaryOptions {
  const folders = ctl.folders;
  const tags = ctl.tags;
  return useMemo<RevisionSummaryOptions>(() => {
    const byFolder = new Map<string, string>(folders.map((folder) => [folder.id, folder.name]));
    const byTag = new Map<string, string>(tags.map((tag) => [tag.id, tag.name]));
    return {
      folderName: (folderId: string | null) =>
        folderId === null ? "Unfiled" : byFolder.get(folderId),
      tagName: (tagId: string) => byTag.get(tagId),
    };
  }, [folders, tags]);
}

/** Which rows are open, plus the grouped list and the expand-all control. */
function useHistoryState(ctl: NotesController) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const options = useSummaryOptions(ctl);
  const groups = useMemo(
    () => (ctl.history === undefined ? [] : groupHistory(ctl.history)),
    [ctl.history],
  );
  const allIds = useMemo(
    () => groups.flatMap((group) => [group.id, ...group.revisions.map((entry) => entry.id)]),
    [groups],
  );
  const allOpen = allIds.length > 0 && allIds.every((id) => open.has(id));
  const toggle = useCallback((id: string) => {
    setOpen((current) => toggleInSet(current, id));
  }, []);
  const toggleAll = useCallback(() => {
    setOpen(allOpen ? new Set<string>() : new Set(allIds));
  }, [allOpen, allIds]);
  return { open, options, groups, allOpen, toggle, toggleAll };
}

function HistoryEmpty() {
  const palette = usePalette();
  return (
    <View className="flex-1 items-center justify-center gap-2 px-8">
      <Icon name="history" size={28} color={palette["text-muted"]} />
      <Text size="sm" tone="muted" className="text-center">
        No history yet. Changes to this note will appear here.
      </Text>
    </View>
  );
}

interface HistoryToolbarProps {
  readonly count: number;
  readonly allOpen: boolean;
  readonly onToggleAll: () => void;
}

function HistoryToolbar({ count, allOpen, onToggleAll }: HistoryToolbarProps) {
  return (
    <View className="flex-row items-center justify-between gap-3 border-b border-border px-4 py-1.5">
      <Text size="xs" tone="muted" style={{ fontVariant: ["tabular-nums"] }}>
        {count} {count === 1 ? "revision" : "revisions"}
      </Text>
      <Pressable
        accessibilityRole="button"
        testID="note-history-toggle-all"
        hitSlop={6}
        onPress={onToggleAll}
        className="rounded-input px-2 py-1 active:bg-surface-3"
      >
        <Text size="sm" tone="muted">
          {allOpen ? "Collapse all" : "Expand all"}
        </Text>
      </Pressable>
    </View>
  );
}

/** The note's revisions, newest first, collapsed until tapped open. */
export function NoteHistoryScreen({ ctl }: { readonly ctl: NotesController }) {
  const state = useHistoryState(ctl);
  const now = Date.now();
  const title = ctl.detail === undefined ? "History" : noteTitle(ctl.detail);
  return (
    <View className="flex-1">
      <PaneHeader
        title="History"
        subtitle={title}
        leading={<NoteBackButton onPress={ctl.backToList} />}
      />
      <NotesError ctl={ctl} />
      {ctl.history === undefined ? (
        <NotesLoading label="Loading history" />
      ) : ctl.history.length === 0 ? (
        <HistoryEmpty />
      ) : (
        <>
          <HistoryToolbar
            count={ctl.history.length}
            allOpen={state.allOpen}
            onToggleAll={state.toggleAll}
          />
          <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
            {state.groups.map((group) => (
              <HistoryGroupRow
                key={group.id}
                ctl={ctl}
                options={state.options}
                group={group}
                now={now}
                openIds={state.open}
                onToggle={state.toggle}
                onToggleRevision={state.toggle}
              />
            ))}
          </ScrollView>
        </>
      )}
    </View>
  );
}
