import { Button, Heading, Input, Text } from "@aulora/ui-native";
import { useState } from "react";
import { Modal, Pressable, ScrollView } from "react-native";

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
  readonly onBan: (options: { readonly reason?: string; readonly durationMs?: number }) => void;
  readonly onTimeout: (durationMs: number | undefined) => void;
  readonly onOpenNote: () => void;
  readonly onClose: () => void;
}

type Panel = "actions" | "ban" | "timeout";

/** Moderation and notes actions for one member, with duration pickers. */
export function MemberActionsSheet({
  visible,
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
}: MemberActionsSheetProps) {
  const [panel, setPanel] = useState<Panel>("actions");
  const [reason, setReason] = useState("");

  function close() {
    setPanel("actions");
    setReason("");
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable className="flex-1 justify-end bg-black/50" onPress={close}>
        <Pressable onPress={() => {}} className="max-h-[80%] rounded-t-card bg-surface-1 p-4">
          <Heading level={3} numberOfLines={1}>
            {memberName}
          </Heading>

          {error !== null && (
            <Text size="sm" tone="danger" accessibilityRole="alert" className="mt-2">
              {error}
            </Text>
          )}

          <ScrollView contentContainerStyle={{ gap: 4, paddingVertical: 12 }}>
            {panel === "actions" && (
              <>
                <Pressable
                  accessibilityRole="button"
                  className="rounded-input px-3 py-3"
                  onPress={() => {
                    close();
                    onOpenNote();
                  }}
                >
                  <Text>Add or edit note…</Text>
                </Pressable>
                {canTimeout && (
                  <Pressable
                    accessibilityRole="button"
                    className="rounded-input px-3 py-3"
                    onPress={() => setPanel("timeout")}
                  >
                    <Text>Timeout…</Text>
                  </Pressable>
                )}
                {canKick && (
                  <Pressable
                    accessibilityRole="button"
                    className="rounded-input px-3 py-3"
                    disabled={busy}
                    onPress={() => {
                      onKick();
                      close();
                    }}
                  >
                    <Text tone="danger">Kick</Text>
                  </Pressable>
                )}
                {canBan && (
                  <Pressable
                    accessibilityRole="button"
                    className="rounded-input px-3 py-3"
                    onPress={() => setPanel("ban")}
                  >
                    <Text tone="danger">Ban…</Text>
                  </Pressable>
                )}
                <Pressable
                  accessibilityRole="button"
                  className="rounded-input px-3 py-3"
                  onPress={close}
                >
                  <Text tone="muted">Cancel</Text>
                </Pressable>
              </>
            )}

            {panel === "timeout" && (
              <>
                <Text size="xs" tone="muted" className="px-3 pb-1">
                  Mute this member for…
                </Text>
                {TIMEOUT_DURATIONS.map((option) => (
                  <Pressable
                    key={`timeout:${option.label}`}
                    accessibilityRole="button"
                    className="rounded-input px-3 py-3"
                    disabled={busy}
                    onPress={() => {
                      onTimeout(option.durationMs);
                      close();
                    }}
                  >
                    <Text>{option.label}</Text>
                  </Pressable>
                ))}
                <Pressable
                  accessibilityRole="button"
                  className="rounded-input px-3 py-3"
                  disabled={busy}
                  onPress={() => {
                    onTimeout(undefined);
                    close();
                  }}
                >
                  <Text tone="muted">Clear timeout</Text>
                </Pressable>
                <Button size="sm" variant="ghost" onPress={() => setPanel("actions")}>
                  Back
                </Button>
              </>
            )}

            {panel === "ban" && (
              <>
                <Input
                  label="Reason (optional)"
                  value={reason}
                  onChangeText={setReason}
                  maxLength={200}
                  placeholder="Why is this member being banned?"
                />
                <Text size="xs" tone="muted" className="px-3 pt-1">
                  Ban for…
                </Text>
                {BAN_DURATIONS.map((option) => (
                  <Pressable
                    key={`ban:${option.label}`}
                    accessibilityRole="button"
                    className="rounded-input px-3 py-3"
                    disabled={busy}
                    onPress={() => {
                      const trimmed = reason.trim();
                      onBan({
                        ...(trimmed.length > 0 ? { reason: trimmed } : {}),
                        ...(option.durationMs !== undefined
                          ? { durationMs: option.durationMs }
                          : {}),
                      });
                      close();
                    }}
                  >
                    <Text>{option.label}</Text>
                  </Pressable>
                ))}
                <Button size="sm" variant="ghost" onPress={() => setPanel("actions")}>
                  Back
                </Button>
              </>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
