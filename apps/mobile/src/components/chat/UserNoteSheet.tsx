import { Button, Input, Text } from "@aulora/ui-native";
import { useEffect, useState } from "react";
import { Keyboard, View } from "react-native";
import { impactFeedback } from "../../lib/haptics";
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
    impactFeedback();
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
  const { body, setBody, loading, saving, error, submit } = useUserNote(
    visible,
    loadNote,
    onSave,
    onClose,
  );

  return (
    <Sheet visible={visible} title={`Note · ${memberName}`} onClose={onClose}>
      <View className="flex-1 gap-3 p-4">
        {error !== null && (
          <Text size="sm" tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        )}
        <Input
          label="Private note"
          multiline
          textAlignVertical="top"
          value={body}
          editable={!loading && !saving}
          onChangeText={setBody}
          placeholder={loading ? "Loading…" : "Add a private note…"}
          hint="Only you can see this note."
          className="max-h-40 min-h-32"
        />
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
