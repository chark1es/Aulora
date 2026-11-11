import { useEffect, useMemo, useState } from "react";
import type { RoleView } from "../../lib/permissions";
import { manageableRoleColors } from "../../lib/role-colors";
import { Sheet } from "../chat/Sheet";
import { RoleColorEditor } from "./RoleColorEditor";
import { RoleColorList } from "./RoleColorList";

export interface RoleColorsSheetProps {
  readonly visible: boolean;
  readonly roles: readonly RoleView[];
  readonly isOwner: boolean;
  readonly topPosition: number;
  readonly onClose: () => void;
}

/** Which role is open, its draft colour and error; closing never leaves a stale selection. */
function useRoleColorSelection(visible: boolean, onClose: () => void) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftColor, setDraftColor] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) {
      setSelectedId(null);
      setError(null);
    }
  }, [visible]);
  return {
    selectedId,
    draftColor,
    setDraftColor,
    error,
    setError,
    open: (role: RoleView) => {
      setSelectedId(role.id);
      setDraftColor(role.color ?? "");
      setError(null);
    },
    backToRoles: () => {
      setSelectedId(null);
      setDraftColor("");
      setError(null);
    },
    close: () => {
      setSelectedId(null);
      setError(null);
      onClose();
    },
  };
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
  const rows = useMemo(
    () => manageableRoleColors(roles, { isOwner, topPosition }, true),
    [roles, isOwner, topPosition],
  );
  const pick = useRoleColorSelection(visible, onClose);
  const selected = rows.find((row) => row.role.id === pick.selectedId) ?? null;

  if (selected !== null) {
    return (
      <Sheet visible={visible} title={`Color for ${selected.role.name}`} onClose={pick.close}>
        <RoleColorEditor
          row={selected}
          draftColor={pick.draftColor}
          onDraftColor={pick.setDraftColor}
          error={pick.error}
          onError={pick.setError}
          onDone={pick.backToRoles}
        />
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} title="Role colors" dismiss="done" onClose={pick.close}>
      <RoleColorList
        rows={rows}
        onOpen={({ role }) => {
          pick.open(role);
        }}
      />
    </Sheet>
  );
}
