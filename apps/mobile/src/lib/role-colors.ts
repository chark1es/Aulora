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

/** Case- and whitespace-insensitive comparison of a saved and a draft color. */
export function roleColorDraftChanged(savedColor: string | null, draftColor: string): boolean {
  const normalize = (value: string | null) => (value ?? "").trim().toUpperCase();
  return normalize(savedColor) !== normalize(draftColor);
}

/**
 * Which back step owns a press. The editor only exists while its role is still
 * in the manageable list: another client may delete it (or the viewer may lose
 * the position to manage it), leaving the UI on the list. The raw
 * `selectedId` would still look like the editor was open and trap Back.
 */
export function roleColorBackTarget(
  state: RoleColorPageState,
  rows: readonly RoleColorEditorRole[],
): "editor" | "list" {
  return rows.some((row) => row.role.id === state.selectedId) ? "editor" : "list";
}

/** The role-color page shows the role list or one role's editor. */
export interface RoleColorPageState {
  readonly selectedId: string | null;
  readonly draftColor: string;
  readonly error: string | null;
}

export const EMPTY_ROLE_COLOR_PAGE: RoleColorPageState = {
  selectedId: null,
  draftColor: "",
  error: null,
};

export type RoleColorPageAction =
  | { readonly type: "open"; readonly role: RoleView }
  | { readonly type: "draft"; readonly color: string }
  | { readonly type: "error"; readonly message: string | null }
  | { readonly type: "back" };

/**
 * Keeps the role editor and the role list from sharing stale state: going back
 * clears the draft and the last error, and opening another role starts from
 * that role's saved color.
 */
export function roleColorPageReducer(
  state: RoleColorPageState,
  action: RoleColorPageAction,
): RoleColorPageState {
  switch (action.type) {
    case "open":
      return { selectedId: action.role.id, draftColor: action.role.color ?? "", error: null };
    case "draft":
      return { ...state, draftColor: action.color };
    case "error":
      return { ...state, error: action.message };
    case "back":
      return EMPTY_ROLE_COLOR_PAGE;
  }
}
