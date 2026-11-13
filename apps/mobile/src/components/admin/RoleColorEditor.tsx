import { Button, RoleColorPreview, Text } from "@aulora/ui-native";
import { useMutation } from "convex/react";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import type { Fn } from "../../lib/function-type";
import { type RoleColorEditorRole, roleColorSavePatch } from "../../lib/role-colors";
import { RoleColorPicker } from "./RoleColorPicker";

export interface RoleColorEditorProps {
  readonly row: RoleColorEditorRole;
  readonly draftColor: string;
  readonly onDraftColor: Fn<[color: string], void>;
  readonly error: string | null;
  readonly onError: Fn<[message: string | null], void>;
  /** Leaves the editor after a successful save. */
  readonly onSaved: Fn<[], void>;
  /** Leaves without saving; the page asks before discarding a changed draft. */
  readonly onBack: Fn<[], void>;
}

/** Saves the draft colour; reports validation and network failures through `onError`. */
function useSaveRoleColor({ row, draftColor, onError, onSaved }: RoleColorEditorProps) {
  const updateRole = useMutation(api.roles.update);
  const [busy, setBusy] = useState(false);
  const save = () => {
    const patch = roleColorSavePatch(row.role, draftColor);
    if (patch === null) {
      onError("Pick a valid hex color, such as #7C5CFF.");
      return;
    }
    setBusy(true);
    onError(null);
    void Promise.resolve(updateRole({ roleId: patch.roleId as never, color: patch.color }))
      .then(() => {
        onSaved();
      })
      .catch(() => {
        onError("Couldn’t save the color. Try again when you are connected.");
      })
      .finally(() => {
        setBusy(false);
      });
  };
  return { busy, save };
}

/** The selected role’s explanation, preview, picker and save controls. */
export function RoleColorEditor(props: RoleColorEditorProps) {
  const { row, draftColor, onDraftColor, error } = props;
  const { busy, save } = useSaveRoleColor(props);
  const { role } = row;
  return (
    <ScrollView
      className="flex-1"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16, gap: 16 }}
    >
      <Text size="sm" tone="muted">
        {role.mentionable
          ? `This role can be mentioned as @${role.name}. Check both previews before saving.`
          : "Check both previews before saving. The warning never blocks saving."}
      </Text>
      <RoleColorPreview
        name={role.name}
        color={draftColor}
        mentionable={role.mentionable}
        disabled={busy}
        onApplySuggestion={onDraftColor}
      />
      <RoleColorPicker value={draftColor} onChange={onDraftColor} disabled={busy} />
      {error !== null && (
        <Text size="sm" tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      )}
      <View className="gap-2">
        <Button loading={busy} disabled={busy || !row.editable} onPress={save}>
          Save color
        </Button>
        <Button variant="secondary" disabled={busy} onPress={props.onBack}>
          Back to roles
        </Button>
      </View>
    </ScrollView>
  );
}
