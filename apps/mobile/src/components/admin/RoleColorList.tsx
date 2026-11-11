import { roleColorCss } from "@aulora/core";
import { Text, usePalette } from "@aulora/ui-native";
import { ScrollView, View } from "react-native";
import type { Fn } from "../../lib/function-type";
import { type RoleColorEditorRole, roleColorSummary } from "../../lib/role-colors";
import { ListGroup, ListRow } from "../chat/List";

export interface RoleColorListProps {
  readonly rows: readonly RoleColorEditorRole[];
  readonly onOpen: Fn<[row: RoleColorEditorRole], void>;
}

/** The roles the viewer can see, each with its current colour and whether it is editable. */
export function RoleColorList({ rows, onOpen }: RoleColorListProps) {
  const palette = usePalette();
  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16, gap: 12 }}
    >
      <Text size="sm" tone="muted">
        Pick a color for each role you manage. The preview shows the role name on both themes before
        you save.
      </Text>
      <ListGroup inset={44}>
        {rows.map((row) => (
          <ListRow
            key={row.role.id}
            title={row.role.name}
            subtitle={`${roleColorSummary(row.role.color)}${row.editable ? "" : " · Above your role"}`}
            leading={
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  backgroundColor: roleColorCss(row.role.color) ?? palette["surface-3"],
                  borderWidth: 1,
                  borderColor: palette.border,
                }}
              />
            }
            trailing={
              <Text size="xs" tone={row.editable ? "accent" : "muted"}>
                {row.editable ? "Edit" : "Locked"}
              </Text>
            }
            disabled={!row.editable}
            onPress={() => {
              onOpen(row);
            }}
            chevron={row.editable}
          />
        ))}
      </ListGroup>
      {rows.length === 0 && (
        <Text size="sm" tone="muted">
          No roles to show yet.
        </Text>
      )}
    </ScrollView>
  );
}
