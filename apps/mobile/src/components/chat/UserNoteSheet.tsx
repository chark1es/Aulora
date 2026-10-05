import { Button, Text, usePalette } from "@aulora/ui-native";
import { useEffect, useState } from "react";
import { Keyboard, TextInput, View } from "react-native";
import { Sheet } from "./Sheet";

export interface UserNoteSheetProps {
  readonly visible: boolean;
  readonly memberName: string;
  readonly loadNote: () => Promise<string | null>;
  readonly onSave: (_body: string) => Promise<void>;
  readonly onClose: () => void;
}

function useUserNote(
  visible: boolean,
  loadNote: () => Promise<string | null>,
  onSave: (body: string) => Promise<void>,
  onClose: () => void,
) {
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
      .then((value) => {
        setBody(value ?? "");
      })
      .catch(() => {
        setError("Could not load this note. Close it and try again.");
      })
      .finally(() => {
        setLoading(false);
      });
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
      .finally(() => {
        setSaving(false);
      });
  }

  return { body, setBody, loading, saving, error, submit };
}

function NoteActions({
  saving,
  loading,
  error,
  onClear,
  onSave,
}: {
  readonly saving: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onClear: () => void;
  readonly onSave: () => void;
}) {
  const disabled = saving || loading || error !== null;
  return (
    <View className="mt-3 flex-row justify-end gap-2">
      <Button size="sm" variant="secondary" onPress={onClear} disabled={disabled}>
        Clear
      </Button>
      <Button size="sm" onPress={onSave} disabled={disabled} loading={saving}>
        Save
      </Button>
    </View>
  );
}

/** A private, server-stored note about another member. */
export function UserNoteSheet({
  visible,
  memberName,
  loadNote,
  onSave,
  onClose,
}: UserNoteSheetProps) {
  const palette = usePalette();
  const { body, setBody, loading, saving, error, submit } = useUserNote(
    visible,
    loadNote,
    onSave,
    onClose,
  );

  return (
    <Sheet visible={visible} title={`Note · ${memberName}`} onClose={onClose}>
      <View className="flex-1 p-4">
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
        <NoteActions
          saving={saving}
          loading={loading}
          error={error}
          onClear={() => {
            submit(true);
          }}
          onSave={() => {
            submit(false);
          }}
        />
      </View>
    </Sheet>
  );
}
