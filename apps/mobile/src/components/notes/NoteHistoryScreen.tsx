/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { type DiffLine, diffLines, diffStats } from "@aulora/core";
import { Icon, Text, usePalette } from "@aulora/ui-native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { timeAgo } from "../../lib/kanban";
import { diffSummary, noteTitle, revisionActionLabel } from "../../lib/notes";
import { PaneHeader } from "../chat/HubPane";
import { NoteBackButton, NotesError, NotesLoading } from "./NoteParts";
import type { NotesController } from "./use-notes";

function actorName(ctl: NotesController, actorId: string): string {
  if (actorId === ctl.ownUserId) return "You";
  return ctl.members.find((member) => member.userId === actorId)?.displayName ?? "Someone";
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

/** The note's revisions, newest first, each expandable to its text diff. */
export function NoteHistoryScreen({ ctl }: { readonly ctl: NotesController }) {
  const palette = usePalette();
  const [expanded, setExpanded] = useState<string | undefined>();
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
        <View className="flex-1 items-center justify-center gap-2 px-8">
          <Icon name="history" size={28} color={palette["text-muted"]} />
          <Text size="sm" tone="muted" className="text-center">
            No history yet. Changes to this note will appear here.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
          {ctl.history.map((revision) => {
            const lines = diffLines(revision.before?.body ?? "", revision.after?.body ?? "");
            const stats = diffStats(lines);
            const open = expanded === revision.id;
            return (
              <Pressable
                key={revision.id}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                className="border-b border-border px-4 py-3 active:bg-surface-2"
                onPress={() => {
                  setExpanded(open ? undefined : revision.id);
                }}
              >
                <View className="flex-row items-center gap-2">
                  <Text className="min-w-0 flex-1 font-medium" numberOfLines={1}>
                    {revisionActionLabel(revision.action)}
                  </Text>
                  <Text size="xs" tone="muted" style={{ fontVariant: ["tabular-nums"] }}>
                    {diffSummary(stats)}
                  </Text>
                  <Icon
                    name={open ? "chevron-down" : "chevron-right"}
                    size={16}
                    color={palette["text-muted"]}
                  />
                </View>
                <Text size="xs" tone="muted">
                  {actorName(ctl, revision.actorId)} · {timeAgo(revision.at, now)}
                </Text>
                {open && (
                  <Animated.View entering={FadeIn.duration(160)}>
                    <DiffView lines={lines} />
                  </Animated.View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
