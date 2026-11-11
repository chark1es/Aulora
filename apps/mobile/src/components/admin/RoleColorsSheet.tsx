import { roleColorCss } from "@aulora/core";
import { Button, RoleColorPreview, Text, usePalette } from "@aulora/ui-native";
import { useMutation } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import type { RoleView } from "../../lib/permissions";
import { manageableRoleColors, roleColorSavePatch, roleColorSummary } from "../../lib/role-colors";
import { ListGroup, ListRow } from "../chat/List";
import { Sheet } from "../chat/Sheet";
import { RoleColorPicker } from "./RoleColorPicker";

export interface RoleColorsSheetProps {
  readonly visible: boolean;
  readonly roles: readonly RoleView[];
  readonly isOwner: boolean;
  readonly topPosition: number;
  readonly onClose: () => void;
}

/**
 * Native role-color editor: the role list, the selected role’s picker and the
 * live two-theme preview. Saving is never blocked by the contrast warning; the
 * warning exists so an unreadable pick is visible before it is stored.
 */
export function RoleColorsSheet({
  visible,
  roles,
  isOwner,
  topPosition,
  onClose,
}: RoleColorsSheetProps) {
  const palette = usePalette();
  const updateRole = useMutation(api.roles.update);
  const rows = useMemo(
    () => manageableRoleColors(roles, { isOwner, topPosition }, true),
    [roles, isOwner, topPosition],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftColor, setDraftColor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = rows.find((row) => row.role.id === selectedId) ?? null;

  // Closing the sheet never leaves a stale selection or draft behind.
  useEffect(() => {
    if (!visible) {
      setSelectedId(null);
      setError(null);
    }
  }, [visible]);

  const openRole = (role: RoleView) => {
    setSelectedId(role.id);
    setDraftColor(role.color ?? "");
    setError(null);
  };

  const close = () => {
    setSelectedId(null);
    setError(null);
    onClose();
  };

  if (selected !== null) {
    return (
      <Sheet visible={visible} title={`Color for ${selected.role.name}`} onClose={close}>
        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16, gap: 16 }}
        >
          <Text size="sm" tone="muted">
            {selected.role.mentionable
              ? `This role can be mentioned as @${selected.role.name}. Check both previews before saving.`
              : "Check both previews before saving. The warning never blocks saving."}
          </Text>

          <RoleColorPreview
            name={selected.role.name}
            color={draftColor}
            mentionable={selected.role.mentionable}
            disabled={busy}
            onApplySuggestion={setDraftColor}
          />

          <RoleColorPicker value={draftColor} onChange={setDraftColor} disabled={busy} />

          {error !== null && (
            <Text size="sm" tone="danger" accessibilityRole="alert">
              {error}
            </Text>
          )}

          <View className="gap-2">
            <Button
              loading={busy}
              disabled={busy || !selected.editable}
              onPress={() => {
                const patch = roleColorSavePatch(selected.role, draftColor);
                if (patch === null) {
                  setError("Pick a valid hex color, such as #7C5CFF.");
                  return;
                }
                setBusy(true);
                setError(null);
                void Promise.resolve(
                  updateRole({ roleId: patch.roleId as never, color: patch.color }),
                )
                  .then(() => {
                    setSelectedId(null);
                    setDraftColor("");
                  })
                  .catch(() => {
                    setError("Couldn’t save the color. Try again when you are connected.");
                  })
                  .finally(() => {
                    setBusy(false);
                  });
              }}
            >
              Save color
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onPress={() => {
                setSelectedId(null);
                setError(null);
              }}
            >
              Back to roles
            </Button>
          </View>
        </ScrollView>
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} title="Role colors" dismiss="done" onClose={close}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16, gap: 12 }}
      >
        <Text size="sm" tone="muted">
          Pick a color for each role you manage. The preview shows the role name on both themes
          before you save.
        </Text>
        <ListGroup inset={44}>
          {rows.map(({ role, editable }) => (
            <ListRow
              key={role.id}
              title={role.name}
              subtitle={`${roleColorSummary(role.color)}${editable ? "" : " · Above your role"}`}
              leading={
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    backgroundColor: roleColorCss(role.color) ?? palette["surface-3"],
                    borderWidth: 1,
                    borderColor: palette.border,
                  }}
                />
              }
              trailing={
                <Text size="xs" tone={editable ? "accent" : "muted"}>
                  {editable ? "Edit" : "Locked"}
                </Text>
              }
              disabled={!editable}
              onPress={() => {
                openRole(role);
              }}
              chevron={editable}
            />
          ))}
        </ListGroup>
        {rows.length === 0 && (
          <Text size="sm" tone="muted">
            No roles to show yet.
          </Text>
        )}
      </ScrollView>
    </Sheet>
  );
}
