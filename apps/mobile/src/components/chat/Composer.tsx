import type { RoleMentionTarget } from "@aulora/core";
import type { IconName } from "@aulora/tokens";
import { Icon, Text, usePalette } from "@aulora/ui-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  type PickedFile,
  pickDocuments,
  pickFromCamera,
  pickFromClipboard,
  pickFromLibrary,
} from "../../lib/attachments";
import { BottomSheet } from "./BottomSheet";
import { ListGroup, ListRow } from "./List";
import { RichText } from "./RichText";

export interface MentionCandidate {
  readonly key: string;
  readonly label: string;
  readonly insert: string;
  readonly detail: string;
}

export interface ComposerProps {
  readonly channelId: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  /** Members who can be `@mentioned`; omitted disables mention autocomplete. */
  readonly members?: readonly { readonly userId: string; readonly displayName: string }[];
  /** Mentionable roles offered by `@` autocomplete. */
  readonly roles?: readonly RoleMentionTarget[];
  /** Channels that can be `#mentioned`; omitted disables channel autocomplete. */
  readonly channels?: readonly { readonly id: string; readonly name: string }[];
  readonly canMentionEveryone?: boolean;
  readonly viewerName?: string;
  readonly onTyping: (channelId: string) => void;
  readonly onSend: (input: { text: string; files: readonly PickedFile[] }) => void | Promise<void>;
}

const ATTACH_OPTIONS: readonly {
  key: string;
  label: string;
  icon: IconName;
  pick: () => Promise<readonly PickedFile[]>;
}[] = [
  {
    key: "camera",
    label: "Take a photo",
    icon: "camera",
    pick: async () => {
      const file = await pickFromCamera();
      return file === null ? [] : [file];
    },
  },
  { key: "photos", label: "Photo library", icon: "image", pick: pickFromLibrary },
  {
    key: "clipboard",
    label: "Paste image from clipboard",
    icon: "image-plus",
    pick: async () => {
      const file = await pickFromClipboard();
      return file === null ? [] : [file];
    },
  },
  { key: "files", label: "Browse files", icon: "file", pick: pickDocuments },
];

const TRIGGER = /(^|\s)([@#])([^\s@#]*)$/;

/** Mobile composer with attachments, `@`/`#` autocomplete and a markdown preview. */
export function Composer({
  channelId,
  placeholder = "Message",
  disabled,
  members = [],
  roles = [],
  channels = [],
  canMentionEveryone = false,
  viewerName = "You",
  onTyping,
  onSend,
}: ComposerProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState("");
  const [files, setFiles] = useState<readonly { key: string; file: PickedFile }[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<TextInput | null>(null);
  const fileSeq = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: channelId is the reset trigger
  useEffect(() => {
    setValue("");
    setFiles([]);
  }, [channelId]);

  const candidates = useMemo<MentionCandidate[]>(() => {
    const broadcast: MentionCandidate[] = canMentionEveryone
      ? [
          { key: "@here", label: "here", insert: "@here", detail: "Notify everyone online" },
          { key: "@everyone", label: "everyone", insert: "@everyone", detail: "Notify everyone" },
        ]
      : [];
    return [
      ...broadcast,
      ...members.map((member) => ({
        key: `@${member.userId}`,
        label: member.displayName,
        insert: `@${member.displayName}`,
        detail: "Member",
      })),
      ...roles
        .filter((role) => role.mentionable)
        .map((role) => ({
          key: `role:${role.roleId}`,
          label: role.name,
          insert: `@${role.name}`,
          detail: "Role",
        })),
      ...channels.map((channel) => ({
        key: `#${channel.id}`,
        label: channel.name,
        insert: `#${channel.name}`,
        detail: "Channel",
      })),
    ];
  }, [canMentionEveryone, members, roles, channels]);

  const trigger = TRIGGER.exec(value);
  const suggestions = useMemo(() => {
    if (trigger === null) {
      return [];
    }
    const prefix = trigger[2] ?? "";
    const query = (trigger[3] ?? "").toLowerCase();
    return candidates
      .filter((candidate) => candidate.insert.startsWith(prefix))
      .filter((candidate) => candidate.label.toLowerCase().includes(query))
      .slice(0, 6);
  }, [trigger, candidates]);

  const showPreview =
    value.includes("**") ||
    value.includes("`") ||
    /(^|\s)[*_]/.test(value) ||
    /https?:\/\//.test(value) ||
    value.includes("#");

  async function pick(option: (typeof ATTACH_OPTIONS)[number]) {
    setMenuOpen(false);
    setBusy(true);
    try {
      const picked = await option.pick();
      if (picked.length > 0) {
        setFiles((current) => [
          ...current,
          ...picked.map((file) => {
            fileSeq.current += 1;
            return { key: `file-${fileSeq.current}`, file };
          }),
        ]);
      }
    } finally {
      setBusy(false);
    }
  }

  function applySuggestion(candidate: MentionCandidate) {
    const next = value.replace(
      TRIGGER,
      (_match, leading: string) => `${leading}${candidate.insert} `,
    );
    setValue(next);
  }

  function send() {
    const text = value.trim();
    if (text.length === 0 && files.length === 0) {
      return;
    }
    void onSend({ text, files: files.map((entry) => entry.file) });
    setValue("");
    setFiles([]);
  }

  const canSend = disabled !== true && (value.trim().length > 0 || files.length > 0);

  return (
    <View
      className="gap-1.5 bg-bg px-3 pt-1.5"
      style={{ paddingBottom: Math.max(insets.bottom, 8) }}
    >
      {files.length > 0 && (
        <View className="flex-row flex-wrap gap-1.5">
          {files.map((entry) => (
            <Pressable
              key={entry.key}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${entry.file.name}`}
              hitSlop={6}
              className="flex-row items-center gap-1.5 rounded-pill bg-surface-2 py-1.5 pl-3 pr-2 active:opacity-70"
              onPress={() =>
                setFiles((current) => current.filter((value) => value.key !== entry.key))
              }
            >
              <Icon name="paperclip" size={14} color={palette["text-muted"]} />
              <Text size="xs" numberOfLines={1} className="max-w-[10rem]">
                {entry.file.name}
              </Text>
              <Icon name="x" size={14} color={palette["text-muted"]} />
            </Pressable>
          ))}
        </View>
      )}
      {suggestions.length > 0 && (
        <View className="overflow-hidden rounded-card border border-border bg-surface-2">
          {suggestions.map((candidate) => (
            <Pressable
              key={candidate.key}
              accessibilityRole="button"
              accessibilityLabel={`Insert ${candidate.insert}`}
              className="min-h-11 flex-row items-center justify-between px-3 active:bg-surface-3"
              onPress={() => applySuggestion(candidate)}
            >
              <Text size="sm">{candidate.insert}</Text>
              <Text size="xs" tone="muted">
                {candidate.detail}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {showPreview && value.trim().length > 0 && (
        <View className="rounded-card border border-border bg-surface-2 px-3 py-2">
          <RichText
            text={value}
            mentionNames={members.map((member) => member.displayName)}
            channelNames={channels.map((channel) => channel.name)}
            viewerName={viewerName}
          />
        </View>
      )}
      <View className="flex-row items-end gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Attach"
          disabled={disabled === true || busy}
          hitSlop={4}
          className={`h-11 w-11 items-center justify-center rounded-pill bg-surface-2 active:opacity-70 ${
            disabled === true ? "opacity-50" : ""
          }`}
          onPress={() => setMenuOpen(true)}
        >
          <Icon name="plus" size={22} color={palette.text} />
        </Pressable>
        <View className="min-h-11 flex-1 justify-center rounded-[22px] border border-border bg-surface-2 px-4">
          <TextInput
            maxFontSizeMultiplier={2}
            ref={inputRef}
            accessibilityLabel={placeholder}
            placeholder={disabled === true ? "You can't send messages here" : placeholder}
            placeholderTextColor={palette["text-muted"]}
            value={value}
            multiline
            editable={disabled !== true}
            onChangeText={(next) => {
              setValue(next);
              if (next.length > 0) {
                onTyping(channelId);
              }
            }}
            className="max-h-32 py-2.5 text-[17px] leading-[22px] text-text"
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          hitSlop={4}
          onPress={send}
          className={`h-11 w-11 items-center justify-center rounded-pill active:opacity-80 ${
            canSend ? "bg-accent" : "bg-surface-2"
          }`}
        >
          <Icon
            name="send"
            size={20}
            color={canSend ? palette["on-accent"] : palette["text-muted"]}
          />
        </Pressable>
      </View>

      <BottomSheet
        visible={menuOpen}
        title="Add to message"
        subtitle="Formatting: **bold**, *italic*, `code`"
        onClose={() => setMenuOpen(false)}
      >
        <ListGroup>
          {ATTACH_OPTIONS.map((option) => (
            <ListRow
              key={option.key}
              icon={option.icon}
              title={option.label}
              onPress={() => void pick(option)}
            />
          ))}
        </ListGroup>
      </BottomSheet>
    </View>
  );
}
