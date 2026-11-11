import { canManageRole, parseHexColor, roleColorCss } from "@aulora/core";
import type { RoleView } from "./permissions";

export interface RoleColorEditorRole {
  readonly role: RoleView;
  /** True when the viewer may change this role’s color. */
  readonly editable: boolean;
}

export interface RoleColorEditorViewer {
  readonly isOwner: boolean;
  readonly topPosition: number;
}

/**
 * The mobile role-color editor’s role list: highest first, with the same
 * hierarchy rule the server enforces. `@everyone` is owner-only.
 */
export function manageableRoleColors(
  roles: readonly RoleView[],
  viewer: RoleColorEditorViewer,
  canManageRoles: boolean,
): RoleColorEditorRole[] {
  return [...roles]
    .sort((a, b) => b.position - a.position)
    .map((role) => ({
      role,
      editable:
        canManageRoles &&
        (role.isEveryone
          ? viewer.isOwner
          : canManageRole(
              { userId: "viewer", topRolePosition: viewer.topPosition, isOwner: viewer.isOwner },
              role.position,
            )),
    }));
}

/**
 * The patch the editor sends when saving a color. The color is trimmed and
 * normalized to #RRGGBB (an empty string clears it); an invalid value is refused so a
 * broken string never reaches the renderer.
 */
export function roleColorSavePatch(
  role: RoleView,
  color: string,
): { readonly roleId: string; readonly color: string } | null {
  const trimmed = color.trim();
  if (trimmed.length > 0 && parseHexColor(trimmed) === null) {
    return null;
  }
  return { roleId: role.id, color: roleColorCss(trimmed) ?? "" };
}

/** A readable summary of the picked color for the list row. */
export function roleColorSummary(color: string | null): string {
  return roleColorCss(color) ?? "No color";
}
