import { DEFAULT_KANBAN_COLUMNS, reportBroadcastFallback } from "@aulora/core";
import { Button, Heading, RoleColorPreview } from "@aulora/ui-native";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { Composer } from "../components/chat/Composer";
import { MemberActionsSheet } from "../components/chat/MemberActionsSheet";
import { BoardSettingsSheet } from "../components/kanban/BoardSettingsSheet";
import { NewBoardSheet } from "../components/kanban/NewBoardSheet";
import { KeyboardAvoidingPane } from "../components/layout/ScreenContainer";
import type { Fn } from "../lib/function-type";
import type { Board, BoardMember } from "../lib/kanban";

const MEMBERS: readonly BoardMember[] = [
  { userId: "me", displayName: "You" },
  { userId: "sam", displayName: "Sam Chen" },
];

const COMPOSER_MEMBERS = [
  { userId: "alex", displayName: "Alex Rivera" },
  { userId: "sam", displayName: "Sam Chen" },
  { userId: "jordan", displayName: "Jordan Ellis" },
];

const BOARD = {
  id: "fixture-board",
  name: "Launch plan",
  description: "Everything left before the release.",
  columns: DEFAULT_KANBAN_COLUMNS,
  labels: [],
  private: true,
  memberIds: ["me", "sam"],
  archived: false,
  updatedAt: 0,
} as unknown as Board;

const ROLE_COLOR_SAMPLES = [
  { label: "Blocked", color: "#C2410C" },
  { label: "Repairable", color: "#1C80AF" },
  { label: "Fails both", color: "#7C5CFF" },
  { label: "Unparseable", color: "nope" },
] as const;

type FixtureName = "new-board" | "board-settings" | "member-actions" | "composer";

const nothing = () => {
  // Offline fixture: moderation actions only close the sheet.
};

/**
 * The real Composer in the same keyboard-avoiding column as the chat screen, under a
 * channel-header stand-in and without the demo banner, so the mention list gets the
 * room it has in the shipped app.
 */
function ComposerFixture() {
  return (
    <KeyboardAvoidingPane style={{ flex: 1 }}>
      <View className="min-h-14 justify-center border-border border-b px-4">
        <Heading level={3}># general</Heading>
      </View>
      <View className="flex-1 p-4">
        {/* Stands in for a send that fell back to plain-text @here on an old server. */}
        <Button
          variant="secondary"
          onPress={() => {
            reportBroadcastFallback("fixture");
          }}
        >
          Simulate @here fallback
        </Button>
      </View>
      <Composer
        channelId="fixture"
        members={COMPOSER_MEMBERS}
        canMentionEveryone
        onTyping={nothing}
        onSend={nothing}
      />
    </KeyboardAvoidingPane>
  );
}

const LAUNCHERS: readonly { readonly fixture: FixtureName; readonly label: string }[] = [
  { fixture: "new-board", label: "New board" },
  { fixture: "board-settings", label: "Board settings" },
  { fixture: "member-actions", label: "Member actions" },
  { fixture: "composer", label: "Composer" },
];

function FixtureLauncher({ onOpen }: { readonly onOpen: Fn<[fixture: FixtureName], void> }) {
  const [roleColor, setRoleColor] = useState("#f4d03f");
  return (
    <ScrollView contentContainerStyle={{ gap: 12, padding: 16 }}>
      <Heading level={2}>Sheet fixtures</Heading>
      {LAUNCHERS.map(({ fixture, label }) => (
        <Button
          key={fixture}
          onPress={() => {
            onOpen(fixture);
          }}
        >
          {label}
        </Button>
      ))}
      {/* One pick per verdict: refused repair, repairable on both, failing on both. */}
      {ROLE_COLOR_SAMPLES.map(({ label, color }) => (
        <Button
          key={color}
          variant="secondary"
          onPress={() => {
            setRoleColor(color);
          }}
        >
          {`${label} ${color}`}
        </Button>
      ))}
      {/* The demo has no roles; this shows the preview's shipped face on device. */}
      <RoleColorPreview
        name="Moderator"
        color={roleColor}
        mentionable
        onApplySuggestion={setRoleColor}
      />
    </ScrollView>
  );
}

function FixtureSheets({
  open,
  onClose,
}: {
  readonly open: FixtureName | null;
  readonly onClose: () => void;
}) {
  return (
    <>
      {open === "new-board" && (
        <NewBoardSheet
          ownUserId="me"
          onCreated={() => {
            // Nothing is created offline.
          }}
          onClose={onClose}
        />
      )}
      <MemberActionsSheet
        visible={open === "member-actions"}
        memberName="Sam Chen"
        canKick
        canBan
        canTimeout
        onKick={nothing}
        onBan={nothing}
        onTimeout={nothing}
        onOpenNote={nothing}
        onClose={onClose}
      />
      {open === "board-settings" && (
        <BoardSettingsSheet board={BOARD} members={MEMBERS} onClose={onClose} />
      )}
    </>
  );
}

/** Development-only launcher for sheets the offline demo has no route to. */
export function SheetFixtures() {
  // Like the demo, sheets need a Convex client in context; nothing is sent.
  const client = useMemo(() => new ConvexReactClient("http://127.0.0.1:9"), []);
  const [open, setOpen] = useState<FixtureName | null>(null);
  if (open === "composer") return <ComposerFixture />;
  return (
    <ConvexProvider client={client}>
      <FixtureLauncher onOpen={setOpen} />
      <FixtureSheets
        open={open}
        onClose={() => {
          setOpen(null);
        }}
      />
    </ConvexProvider>
  );
}
