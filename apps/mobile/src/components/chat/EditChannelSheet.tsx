import { Button, Icon, Input, Text, usePalette } from "@aulora/ui-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import type { MobileMemberEntry } from "../../lib/permissions";
import { MemberAvatar } from "./MemberAvatar";
import { Sheet } from "./Sheet";

export interface EditChannelPatch {
  readonly name: string;
  readonly topic: string;
  readonly private: boolean;
  readonly memberIds: readonly string[];
  readonly blockedUserIds: readonly string[];
}

export interface EditChannelSheetProps {
  readonly visible: boolean;
  readonly channelName: string;
  readonly channelTopic: string;
  readonly isPrivate: boolean;
  readonly initialMemberIds: readonly string[];
  readonly initialBlockedUserIds: readonly string[];
  readonly ownUserId: string;
  readonly members: readonly MobileMemberEntry[];
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onClose: () => void;
  readonly onSave: (patch: EditChannelPatch) => void | Promise<void>;
}

/**
 * Bottom sheet that edits an existing channel: rename, retopic, switch
 * public/private, pick who can access and block specific members. The mobile
 * counterpart of the web {@link EditChannelModal}; blocked users reuse the
 * channel override system (a member override denying `ViewChannel`).
 */
export function EditChannelSheet({
  visible,
  channelName,
  channelTopic,
  isPrivate,
  initialMemberIds,
  initialBlockedUserIds,
  ownUserId,
  members,
  busy = false,
  error = null,
  onClose,
  onSave,
}: EditChannelSheetProps) {
  const palette = usePalette();
  const [name, setName] = useState(channelName);
  const [topic, setTopic] = useState(channelTopic);
  const [privateChannel, setPrivateChannel] = useState(isPrivate);
  const [selectedMembers, setSelectedMembers] = useState<readonly string[]>(initialMemberIds);
  const [blockedUserIds, setBlockedUserIds] = useState<readonly string[]>(initialBlockedUserIds);
  const [memberQuery, setMemberQuery] = useState("");
  const [blockQuery, setBlockQuery] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset the form each time the sheet opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on open, not on every prop identity change
  useEffect(() => {
    if (!visible) {
      return;
    }
    setName(channelName);
    setTopic(channelTopic);
    setPrivateChannel(isPrivate);
    setSelectedMembers(initialMemberIds);
    setBlockedUserIds(initialBlockedUserIds);
    setMemberQuery("");
    setBlockQuery("");
    setSaving(false);
  }, [visible]);

  const memberById = useMemo(
    () => new Map(members.map((member) => [member.userId, member] as const)),
    [members],
  );

  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [members],
  );
  const memberNeedle = memberQuery.trim().toLowerCase();
  const blockNeedle = blockQuery.trim().toLowerCase();
  const filteredMembers = useMemo(
    () => sortedMembers.filter((member) => member.displayName.toLowerCase().includes(memberNeedle)),
    [sortedMembers, memberNeedle],
  );
  const filteredBlockMembers = useMemo(
    () => sortedMembers.filter((member) => member.displayName.toLowerCase().includes(blockNeedle)),
    [sortedMembers, blockNeedle],
  );

  function toggleMember(userId: string) {
    if (userId === ownUserId) {
      return;
    }
    setSelectedMembers((current) =>
      current.includes(userId) ? current.filter((value) => value !== userId) : [...current, userId],
    );
  }

  function toggleBlocked(userId: string) {
    if (userId === ownUserId) {
      return;
    }
    setBlockedUserIds((current) =>
      current.includes(userId) ? current.filter((value) => value !== userId) : [...current, userId],
    );
  }

  const trimmedName = name.trim();
  const disabled = trimmedName.length === 0 || busy || saving;

  function submit() {
    if (disabled) {
      return;
    }
    setSaving(true);
    void Promise.resolve(
      onSave({
        name: trimmedName,
        topic: topic.trim(),
        private: privateChannel,
        memberIds: privateChannel ? [...new Set([ownUserId, ...selectedMembers])] : [],
        blockedUserIds: [...new Set(blockedUserIds)],
      }),
    ).finally(() => {
      setSaving(false);
    });
  }

  return (
    <Sheet visible={visible} title={"Edit channel"} onClose={onClose}>
      <View className="flex-1 p-4">
        <ScrollView contentContainerStyle={{ gap: 14, paddingVertical: 12 }}>
          <Input
            label="Name"
            placeholder="e.g. product-launch"
            value={name}
            maxLength={80}
            onChangeText={setName}
          />

          <Input
            label="Topic"
            placeholder="What is this channel about?"
            value={topic}
            maxLength={160}
            onChangeText={setTopic}
          />

          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: privateChannel }}
            className="flex-row items-center gap-3 rounded-input border border-border bg-surface-2 px-3.5 py-2.5"
            onPress={() => {
              setPrivateChannel(!privateChannel);
            }}
          >
            <Icon
              name={privateChannel ? "lock" : "hash"}
              size={17}
              color={privateChannel ? palette.accent : palette["text-muted"]}
            />
            <View className="flex-1">
              <Text size="sm" className="font-medium">
                Private channel
              </Text>
              <Text size="xs" tone="muted">
                Only people you add can see this channel or its history.
              </Text>
            </View>
            <View
              className={
                privateChannel
                  ? "h-6 w-10 rounded-pill bg-accent"
                  : "h-6 w-10 rounded-pill bg-surface-3"
              }
            >
              <View
                className={
                  privateChannel
                    ? "mt-0.5 h-5 w-5 self-end rounded-pill bg-on-accent"
                    : "ml-0.5 mt-0.5 h-5 w-5 rounded-pill bg-text-muted"
                }
              />
            </View>
          </Pressable>

          {privateChannel && (
            <View className="gap-2.5 rounded-input border border-border bg-surface-2 p-3">
              <View className="flex-row items-center justify-between">
                <Text size="xs" tone="muted" className="font-medium">
                  Who can access
                </Text>
                <View className="flex-row items-center gap-1">
                  <Icon name="lock" size={12} color={palette["text-muted"]} />
                  <Text size="xs" tone="muted">
                    Private
                  </Text>
                </View>
              </View>

              <View className="min-h-9 flex-row flex-wrap items-center gap-1.5 rounded-input border border-border bg-surface-3 px-2 py-1.5">
                {selectedMembers.map((userId) => {
                  const member = memberById.get(userId);
                  const self = userId === ownUserId;
                  return (
                    <View
                      key={`member:${userId}`}
                      className="flex-row items-center gap-1 rounded-pill bg-accent-soft py-0.5 pl-2 pr-1"
                    >
                      {member?.roleColor !== null && member?.roleColor !== undefined && (
                        <View
                          className="h-1.5 w-1.5 rounded-pill"
                          style={{ backgroundColor: member.roleColor }}
                        />
                      )}
                      <Text size="xs" tone="accent" numberOfLines={1}>
                        {member?.displayName ?? userId}
                        {self ? " (you)" : ""}
                      </Text>
                      {!self && (
                        <Pressable
                          accessibilityRole="button"
                          className="min-h-12 min-w-12 items-center justify-center"
                          accessibilityLabel={`Remove ${member?.displayName ?? userId}`}
                          onPress={() => {
                            toggleMember(userId);
                          }}
                        >
                          <Icon name="x" size={11} color={palette.accent} />
                        </Pressable>
                      )}
                    </View>
                  );
                })}
                <TextInput
                  accessibilityLabel="Search members"
                  placeholder={selectedMembers.length === 0 ? "Add people" : ""}
                  placeholderTextColor={palette["text-muted"]}
                  value={memberQuery}
                  onChangeText={setMemberQuery}
                  className="min-h-12 min-w-[8rem] flex-1 px-1 py-1 text-base text-text"
                />
              </View>

              {filteredMembers.map((member) => {
                const checked = selectedMembers.includes(member.userId);
                const self = member.userId === ownUserId;
                return (
                  <Pressable
                    key={`member-option:${member.userId}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked, disabled: self }}
                    disabled={self}
                    className={
                      self
                        ? "min-h-12 flex-row items-center gap-2.5 rounded-input px-2.5 py-1.5 opacity-60"
                        : "min-h-12 flex-row items-center gap-2.5 rounded-input px-2.5 py-1.5"
                    }
                    onPress={() => {
                      toggleMember(member.userId);
                    }}
                  >
                    <MemberAvatar userId={member.userId} size={26} roleColor={member.roleColor} />
                    <Text size="sm" className="min-w-0 flex-1" numberOfLines={1}>
                      {member.displayName}
                      {self ? " (you)" : ""}
                    </Text>
                    <View
                      className={
                        checked
                          ? "h-5 w-5 items-center justify-center rounded-pill border border-accent bg-accent"
                          : "h-5 w-5 items-center justify-center rounded-pill border border-border"
                      }
                    >
                      {checked && <Icon name="check" size={13} color={palette["on-accent"]} />}
                    </View>
                  </Pressable>
                );
              })}
              {filteredMembers.length === 0 && (
                <Text size="xs" tone="muted" className="py-2 text-center">
                  No people match that search.
                </Text>
              )}
            </View>
          )}

          <View className="gap-2.5 rounded-input border border-border bg-surface-2 p-3">
            <View className="flex-row items-center justify-between">
              <Text size="xs" tone="muted" className="font-medium">
                Blocked users
              </Text>
              <View className="flex-row items-center gap-1">
                <Icon name="x" size={12} color={palette["text-muted"]} />
                <Text size="xs" tone="muted">
                  Cannot view
                </Text>
              </View>
            </View>

            <View className="min-h-9 flex-row flex-wrap items-center gap-1.5 rounded-input border border-border bg-surface-3 px-2 py-1.5">
              {blockedUserIds.length === 0 && (
                <Text size="xs" tone="muted">
                  No one is blocked.
                </Text>
              )}
              {blockedUserIds.map((userId) => {
                const member = memberById.get(userId);
                const label = member?.displayName ?? userId;
                return (
                  <View
                    key={`blocked:${userId}`}
                    className="flex-row items-center gap-1 rounded-pill bg-danger/15 py-0.5 pl-2 pr-1"
                  >
                    <Text size="xs" tone="danger" numberOfLines={1}>
                      {label}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      className="min-h-12 min-w-12 items-center justify-center"
                      accessibilityLabel={`Unblock ${label}`}
                      onPress={() => {
                        toggleBlocked(userId);
                      }}
                    >
                      <Icon name="x" size={11} color={palette.danger} />
                    </Pressable>
                  </View>
                );
              })}
            </View>

            <View className="flex-row items-center gap-2 rounded-input border border-border bg-surface-3 px-2.5">
              <Icon name="search" size={14} color={palette["text-muted"]} />
              <TextInput
                accessibilityLabel="Search people to block"
                placeholder="Block a member…"
                placeholderTextColor={palette["text-muted"]}
                value={blockQuery}
                onChangeText={setBlockQuery}
                className="min-h-12 flex-1 px-1 py-2 text-base text-text"
              />
            </View>

            {filteredBlockMembers.map((member) => {
              const checked = blockedUserIds.includes(member.userId);
              const self = member.userId === ownUserId;
              return (
                <Pressable
                  key={`block-option:${member.userId}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked, disabled: self }}
                  disabled={self}
                  className={
                    self
                      ? "min-h-12 flex-row items-center gap-2.5 rounded-input px-2.5 py-1.5 opacity-60"
                      : "min-h-12 flex-row items-center gap-2.5 rounded-input px-2.5 py-1.5"
                  }
                  onPress={() => {
                    toggleBlocked(member.userId);
                  }}
                >
                  <Text size="sm" className="min-w-0 flex-1" numberOfLines={1}>
                    {member.displayName}
                    {self ? " (you)" : ""}
                  </Text>
                  <View
                    className={
                      checked
                        ? "h-5 w-5 items-center justify-center rounded-pill border border-danger bg-danger"
                        : "h-5 w-5 items-center justify-center rounded-pill border border-border"
                    }
                  >
                    {checked && <Icon name="check" size={13} color={palette["on-accent"]} />}
                  </View>
                </Pressable>
              );
            })}
            {filteredBlockMembers.length === 0 && (
              <Text size="xs" tone="muted" className="py-2 text-center">
                No people match that search.
              </Text>
            )}

            <Text size="xs" tone="muted">
              Blocked users cannot view or join this channel. Blocking denies the View channel
              permission on this channel only.
            </Text>
          </View>

          {error !== null && (
            <Text size="sm" tone="danger" accessibilityRole="alert">
              {error}
            </Text>
          )}

          <Button onPress={submit} disabled={disabled} loading={busy || saving}>
            {busy || saving ? "Saving…" : "Save changes"}
          </Button>
        </ScrollView>
      </View>
    </Sheet>
  );
}
