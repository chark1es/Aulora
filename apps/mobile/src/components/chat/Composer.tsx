import type { RoleMentionTarget } from "@aulora/core";
import { Button, Icon, IconButton, Text, usePalette } from "@aulora/ui-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, TextInput, useWindowDimensions, View } from "react-native";
import {
  type PickedFile,
  pickDocuments,
  pickFromCamera,
  pickFromClipboard,
  pickFromLibrary,
} from "../../lib/attachments";
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
  pick: () => Promise<readonly PickedFile[]>;
}[] = [
  {
    key: "camera",
    label: "Camera",
    pick: async () => {
      const file = await pickFromCamera();
      return file === null ? [] : [file];
    },
  },
  { key: "photos", label: "Photo library", pick: pickFromLibrary },
  {
    key: "clipboard",
    label: "Paste image",
    pick: async () => {
      const file = await pickFromClipboard();
      return file === null ? [] : [file];
    },
  },
  { key: "files", label: "Files", pick: pickDocuments },
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
  const { fontScale } = useWindowDimensions();
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

  return (
    <View className="gap-1 border-t border-border bg-bg px-3 pb-2 pt-2">
      {files.length > 0 && (
        <View className="flex-row flex-wrap gap-1">
          {files.map((entry) => (
            <Pressable
              key={entry.key}
              accessibilityLabel={`Remove ${entry.file.name}`}
              className="rounded-pill border border-border bg-surface-2 px-2 py-0.5"
              onPress={() =>
                setFiles((current) => current.filter((value) => value.key !== entry.key))
              }
            >
              <Text size="xs" tone="muted" numberOfLines={1} className="max-w-[10rem]">
                {entry.file.name} ×
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {suggestions.length > 0 && (
        <View className="rounded-input border border-border bg-surface-2 p-1">
          {suggestions.map((candidate) => (
            <Pressable
              key={candidate.key}
              accessibilityRole="button"
              accessibilityLabel={`Insert ${candidate.insert}`}
              className="flex-row items-center justify-between rounded-input px-2 py-2"
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
        <View className="rounded-input border border-border bg-surface-2 px-3 py-2">
          <RichText
            text={value}
            mentionNames={members.map((member) => member.displayName)}
            channelNames={channels.map((channel) => channel.name)}
            viewerName={viewerName}
          />
        </View>
      )}
      <View className="flex-row items-end gap-2 rounded-input border border-border bg-surface-2 p-2">
        <Pressable
          accessibilityLabel="Attach"
          disabled={disabled === true || busy}
          accessibilityRole="button"
          className="h-12 w-12 items-center justify-center rounded-pill"
          onPress={() => setMenuOpen(true)}
        >
          <Icon
            name="paperclip"
            size={18}
            color={disabled === true ? palette["text-muted"] : palette.text}
          />
        </Pressable>
        <TextInput
          maxFontSizeMultiplier={2}
          ref={inputRef}
          accessibilityLabel={placeholder}
          placeholder={placeholder}
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
          className="max-h-32 min-h-12 flex-1 px-1 py-2 text-[17px] text-text"
        />
        {fontScale > 1.5 ? (
          <IconButton
            label="Send"
            disabled={disabled === true || (value.trim().length === 0 && files.length === 0)}
            onPress={send}
          >
            <Icon name="send" color={palette.text} />
          </IconButton>
        ) : (
          <Button
            size="sm"
            disabled={disabled === true || (value.trim().length === 0 && files.length === 0)}
            onPress={send}
          >
            Send
          </Button>
        )}
      </View>

      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable className="flex-1 justify-end bg-black/50" onPress={() => setMenuOpen(false)}>
          <View className="gap-1 rounded-t-card bg-surface-2 p-4">
            <Text size="xs" tone="muted" style={{ color: palette["text-muted"] }}>
              Formatting: **bold** *italic* `code`
            </Text>
            {ATTACH_OPTIONS.map((option) => (
              <Pressable
                key={option.key}
                className="rounded-input px-3 py-3"
                onPress={() => void pick(option)}
              >
                <Text>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
