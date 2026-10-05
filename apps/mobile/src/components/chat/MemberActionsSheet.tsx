import { Text, usePalette } from "@aulora/ui-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { BottomSheet } from "./BottomSheet";
import { ListGroup, ListHeader, ListRow } from "./List";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface BanDurationOption {
  readonly label: string;
  readonly durationMs?: number;
}

export const BAN_DURATIONS: readonly BanDurationOption[] = [
  { label: "1 minute", durationMs: MINUTE },
  { label: "1 hour", durationMs: HOUR },
  { label: "1 day", durationMs: DAY },
  { label: "7 days", durationMs: 7 * DAY },
  { label: "30 days", durationMs: 30 * DAY },
  { label: "Permanent" },
];

export const TIMEOUT_DURATIONS: readonly BanDurationOption[] = [
  { label: "1 minute", durationMs: MINUTE },
  { label: "5 minutes", durationMs: 5 * MINUTE },
  { label: "1 hour", durationMs: HOUR },
  { label: "1 day", durationMs: DAY },
];

export interface MemberActionsSheetProps {
  readonly visible: boolean;
  readonly memberName: string;
  readonly canKick: boolean;
  readonly canBan: boolean;
  readonly canTimeout: boolean;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onKick: () => void;
  readonly onBan: (_options: { readonly reason?: string; readonly durationMs?: number }) => void;
  readonly onTimeout: (_durationMs: number | undefined) => void;
  readonly onOpenNote: () => void;
  readonly onClose: () => void;
}

type Panel = "actions" | "ban" | "timeout";

function TimeoutPanel({
  busy,
  onTimeout,
  onBack,
}: {
  readonly busy: boolean;
  readonly onTimeout: (_durationMs: number | undefined) => void;
  readonly onBack: () => void;
}) {
  return (
    <>
      <ListGroup inset={12}>
        {TIMEOUT_DURATIONS.map((option) => (
          <ListRow
            key={`timeout:${option.label}`}
            title={option.label}
            disabled={busy}
            onPress={() => {
              onTimeout(option.durationMs);
            }}
          />
        ))}
      </ListGroup>
      <ListGroup inset={12}>
        <ListRow
          title="Clear timeout"
          disabled={busy}
          onPress={() => {
            onTimeout(undefined);
          }}
        />
        <ListRow title="Back" onPress={onBack} />
      </ListGroup>
    </>
  );
}

function QuickActions({
  canTimeout,
  onNote,
  onTimeout,
}: {
  readonly canTimeout: boolean;
  readonly onNote: () => void;
  readonly onTimeout: () => void;
}) {
  return (
    <ListGroup>
      <ListRow icon="note" title="Private note" subtitle="Only you can see it" onPress={onNote} />
      {canTimeout && <ListRow icon="bell-off" title="Time out" chevron onPress={onTimeout} />}
    </ListGroup>
  );
}

function ModerationActions({
  memberName,
  canKick,
  canBan,
  busy,
  onKick,
  onOpenBan,
}: {
  readonly memberName: string;
  readonly canKick: boolean;
  readonly canBan: boolean;
  readonly busy: boolean;
  readonly onKick: () => void;
  readonly onOpenBan: () => void;
}) {
  return (
    <ListGroup>
      {canKick && (
        <ListRow
          icon="logout"
          title="Kick from workspace"
          tone="danger"
          disabled={busy}
          onPress={() => {
            Alert.alert(
              `Kick ${memberName}?`,
              "They lose access now and can rejoin with a new invitation.",
              [
                { text: "Cancel", style: "cancel" },
                { text: "Kick", style: "destructive", onPress: onKick },
              ],
            );
          }}
        />
      )}
      {canBan && <ListRow icon="ban" title="Ban" tone="danger" chevron onPress={onOpenBan} />}
    </ListGroup>
  );
}

function MemberActionsBody({
  props,
  panel,
  setPanel,
  reason,
  setReason,
}: {
  readonly props: MemberActionsSheetProps;
  readonly panel: Panel;
  readonly setPanel: (_panel: Panel) => void;
  readonly reason: string;
  readonly setReason: (_reason: string) => void;
}) {
  const {
    memberName,
    canKick,
    canBan,
    canTimeout,
    busy = false,
    error = null,
    onKick,
    onBan,
    onTimeout,
    onOpenNote,
    onClose,
  } = props;
  return (
    <>
      {error !== null && (
        <Text size="sm" tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      )}

      {panel === "actions" && (
        <>
          <QuickActions
            canTimeout={canTimeout}
            onNote={() => {
              onClose();
              onOpenNote();
            }}
            onTimeout={() => {
              setPanel("timeout");
            }}
          />
          {(canKick || canBan) && (
            <ModerationActions
              memberName={memberName}
              canKick={canKick}
              canBan={canBan}
              busy={busy}
              onKick={onKick}
              onOpenBan={() => {
                setPanel("ban");
              }}
            />
          )}
        </>
      )}

      {panel === "timeout" && (
        <TimeoutPanel
          busy={busy}
          onTimeout={onTimeout}
          onBack={() => {
            setPanel("actions");
          }}
        />
      )}

      {panel === "ban" && (
        <BanPanel
          memberName={memberName}
          busy={busy}
          reason={reason}
          onReasonChange={setReason}
          onBack={() => {
            setPanel("actions");
          }}
          onBan={onBan}
        />
      )}
    </>
  );
}

/** Moderation and notes actions for one member, with duration pickers. */
export function MemberActionsSheet(props: MemberActionsSheetProps) {
  const { visible, memberName, onClose } = props;
  const [panel, setPanel] = useState<Panel>("actions");
  const [reason, setReason] = useState("");

  // The caller hides the sheet once a moderation request succeeds; a failure
  // keeps it open with the error. Either way the next opening starts clean.
  useEffect(() => {
    if (!visible) {
      setPanel("actions");
      setReason("");
    }
  }, [visible]);

  return (
    <BottomSheet
      visible={visible}
      title={panel === "ban" ? `Ban ${memberName}` : panel === "timeout" ? "Time out" : memberName}
      subtitle={panel === "timeout" ? `${memberName} can't send messages until it ends` : undefined}
      onClose={onClose}
    >
      <MemberActionsBody
        props={props}
        panel={panel}
        setPanel={setPanel}
        reason={reason}
        setReason={setReason}
      />
    </BottomSheet>
  );
}

function BanPanel({
  memberName,
  busy,
  reason,
  onReasonChange,
  onBack,
  onBan,
}: {
  readonly memberName: string;
  readonly busy: boolean;
  readonly reason: string;
  readonly onReasonChange: (_reason: string) => void;
  readonly onBack: () => void;
  readonly onBan: (_options: { readonly reason?: string; readonly durationMs?: number }) => void;
}) {
  const palette = usePalette();
  return (
    <>
      <BottomSheetTextInput
        accessibilityLabel="Reason, optional"
        value={reason}
        onChangeText={onReasonChange}
        maxLength={200}
        placeholder="Reason (optional)"
        placeholderTextColor={palette["text-muted"]}
        style={{
          color: palette.text,
          backgroundColor: palette["surface-2"],
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontSize: 17,
        }}
      />
      <ListHeader title="Ban for" />
      <ListGroup inset={12}>
        {BAN_DURATIONS.map((option) => (
          <ListRow
            key={`ban:${option.label}`}
            title={option.label}
            tone="danger"
            disabled={busy}
            onPress={() => {
              const trimmed = reason.trim();
              Alert.alert(
                `Ban ${memberName}?`,
                option.durationMs === undefined
                  ? "They can't rejoin until someone lifts the ban."
                  : `They can't rejoin for ${option.label}.`,
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Ban",
                    style: "destructive",
                    onPress: () => {
                      onBan({
                        ...(trimmed.length > 0 ? { reason: trimmed } : {}),
                        ...(option.durationMs !== undefined
                          ? { durationMs: option.durationMs }
                          : {}),
                      });
                    },
                  },
                ],
              );
            }}
          />
        ))}
      </ListGroup>
      <ListGroup inset={12}>
        <ListRow title="Back" onPress={onBack} />
      </ListGroup>
    </>
  );
}
