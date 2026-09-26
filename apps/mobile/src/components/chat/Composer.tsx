import { Button, Text } from "@aulora/ui-native";
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, TextInput, View } from "react-native";
import {
  type PickedFile,
  pickDocuments,
  pickFromCamera,
  pickFromClipboard,
  pickFromLibrary,
} from "../../lib/attachments";

export interface ComposerProps {
  readonly channelId: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
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

/** Mobile composer with attachments (camera, photos, clipboard paste, files). */
export function Composer({
  channelId,
  placeholder = "Message",
  disabled,
  onTyping,
  onSend,
}: ComposerProps) {
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
      <View className="flex-row items-end gap-2 rounded-input border border-border bg-surface-2 p-2">
        <Pressable
          accessibilityLabel="Attach"
          disabled={disabled === true || busy}
          className="rounded-pill px-2 py-1"
          onPress={() => setMenuOpen(true)}
        >
          <Text size="lg" tone={disabled === true ? "muted" : "default"}>
            📎
          </Text>
        </Pressable>
        <TextInput
          ref={inputRef}
          accessibilityLabel={placeholder}
          placeholder={placeholder}
          placeholderTextColor="#8B8A94"
          value={value}
          multiline
          editable={disabled !== true}
          onChangeText={(next) => {
            setValue(next);
            if (next.length > 0) {
              onTyping(channelId);
            }
          }}
          className="max-h-32 min-h-9 flex-1 px-1 py-1.5 text-base text-text"
        />
        <Button
          size="sm"
          disabled={disabled === true || (value.trim().length === 0 && files.length === 0)}
          onPress={send}
        >
          Send
        </Button>
      </View>

      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable className="flex-1 justify-end bg-black/50" onPress={() => setMenuOpen(false)}>
          <View className="gap-1 rounded-t-card bg-surface-2 p-4">
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
