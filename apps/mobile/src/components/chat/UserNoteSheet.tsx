import { Button, Heading, Text, usePalette } from "@aulora/ui-native";
import { useEffect, useState } from "react";
import { Keyboard, Modal, Pressable, TextInput, View } from "react-native";

export interface UserNoteSheetProps {
  readonly visible: boolean;
  readonly memberName: string;
  readonly loadNote: () => Promise<string | null>;
  readonly onSave: (body: string) => Promise<void>;
  readonly onClose: () => void;
}

/** A private, device-only note about another member. */
export function UserNoteSheet({
  visible,
  memberName,
  loadNote,
  onSave,
  onClose,
}: UserNoteSheetProps) {
  const palette = usePalette();
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload only when the sheet opens
  useEffect(() => {
    if (!visible) {
      return;
    }
    setLoading(true);
    setError(null);
    void loadNote()
      .then((value) => setBody(value ?? ""))
      .catch(() => setBody(""))
      .finally(() => setLoading(false));
  }, [visible]);

  function submit(clear: boolean) {
    const next = clear ? "" : body.trim();
    setSaving(true);
    setError(null);
    void onSave(next)
      .then(() => {
        Keyboard.dismiss();
        onClose();
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Could not save this note.");
      })
      .finally(() => setSaving(false));
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/50" onPress={onClose}>
        <Pressable onPress={() => {}} className="rounded-t-card bg-surface-1 p-4">
          <Heading level={3} numberOfLines={1}>
            Note · {memberName}
          </Heading>
          <Text size="xs" tone="muted" className="mt-1">
            Only you can see this note.
          </Text>
          {error !== null && (
            <Text size="sm" tone="danger" accessibilityRole="alert" className="mt-2">
              {error}
            </Text>
          )}
          <View className="mt-3 rounded-input border border-border bg-surface-2 p-2">
            <TextInput
              accessibilityLabel="Private note"
              multiline
              value={body}
              editable={!loading && !saving}
              onChangeText={setBody}
              placeholder={loading ? "Loading…" : "Add a private note…"}
              placeholderTextColor={palette["text-muted"]}
              className="max-h-32 min-h-32 text-base text-text"
            />
          </View>
          <View className="mt-3 flex-row justify-end gap-2">
            <Button size="sm" variant="ghost" onPress={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" variant="secondary" onPress={() => submit(true)} disabled={saving}>
              Clear
            </Button>
            <Button size="sm" onPress={() => submit(false)} disabled={saving} loading={saving}>
              Save
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
