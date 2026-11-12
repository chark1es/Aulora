import { useCallback, useEffect, useMemo, useReducer } from "react";
import { BackHandler, View } from "react-native";
import type { RoleView } from "../../lib/permissions";
import {
  EMPTY_ROLE_COLOR_PAGE,
  manageableRoleColors,
  roleColorBackTarget,
  roleColorDraftChanged,
  roleColorPageReducer,
} from "../../lib/role-colors";
import { PaneHeader, RoundButton, useDockClearance } from "../chat/HubPane";
import { PageTransition } from "../chat/PageTransition";
import { confirm } from "../kanban/board-menus";
import { RoleColorEditor } from "./RoleColorEditor";
import { RoleColorList } from "./RoleColorList";

export interface RoleColorsPageProps {
  readonly roles: readonly RoleView[];
  readonly isOwner: boolean;
  readonly topPosition: number;
  /** False while the hub is swiped away, so chat back presses stay with the chat. */
  readonly active: boolean;
  readonly onBack: () => void;
}

/**
 * The role-color settings page. It opens inside the You tab like every other
 * settings detail, rather than as a separate native sheet: the role list, then
 * one role's editor, each with the same back control as the pages around it.
 */
export function RoleColorsPage({
  roles,
  isOwner,
  topPosition,
  active,
  onBack,
}: RoleColorsPageProps) {
  const clearance = useDockClearance();
  const rows = useMemo(
    () => manageableRoleColors(roles, { isOwner, topPosition }, true),
    [roles, isOwner, topPosition],
  );
  const [state, dispatch] = useReducer(roleColorPageReducer, EMPTY_ROLE_COLOR_PAGE);
  const selected = rows.find((row) => row.role.id === state.selectedId) ?? null;

  // A changed draft is discarded only after the person confirms; a save leaves
  // through `onSaved` instead, where there is nothing to discard.
  const requestEditorBack = useCallback(() => {
    if (selected === null) return;
    if (!roleColorDraftChanged(selected.role.color, state.draftColor)) {
      dispatch({ type: "back" });
      return;
    }
    confirm("Discard color change?", "Your unsaved color will be lost.", "Discard", () => {
      dispatch({ type: "back" });
    });
  }, [selected, state.draftColor]);

  const goBack = useCallback(() => {
    // A deleted/unmanageable role leaves `selectedId` set while the list is
    // rendered; Back must leave the page rather than call a no-op editor step.
    if (roleColorBackTarget(state, rows) === "editor") {
      requestEditorBack();
      return;
    }
    onBack();
  }, [state, rows, requestEditorBack, onBack]);

  // This page is pushed inside the You tab rather than presented as a modal,
  // so it owns the Android back step it used to get from the native sheet. It
  // registers no sibling handler, so the editor's step always runs before the
  // list's step back to the You tab.
  useEffect(() => {
    if (!active) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      goBack();
      return true;
    });
    return () => {
      subscription.remove();
    };
  }, [active, goBack]);

  if (selected !== null) {
    return (
      <PageTransition key={selected.role.id}>
        <View className="flex-1 min-w-0" style={{ paddingBottom: clearance }}>
          <PaneHeader
            title={`Color for ${selected.role.name}`}
            leading={
              <RoundButton icon="chevron-left" label="Back to roles" onPress={requestEditorBack} />
            }
          />
          <RoleColorEditor
            row={selected}
            draftColor={state.draftColor}
            onDraftColor={(color) => {
              dispatch({ type: "draft", color });
            }}
            error={state.error}
            onError={(message) => {
              dispatch({ type: "error", message });
            }}
            onSaved={() => {
              dispatch({ type: "back" });
            }}
            onBack={requestEditorBack}
          />
        </View>
      </PageTransition>
    );
  }

  return (
    <PageTransition key="list">
      <View className="flex-1 min-w-0" style={{ paddingBottom: clearance }}>
        <PaneHeader
          title="Role colors"
          leading={<RoundButton icon="chevron-left" label="Back to You" onPress={onBack} />}
        />
        <RoleColorList
          rows={rows}
          onOpen={({ role }) => {
            dispatch({ type: "open", role });
          }}
        />
      </View>
    </PageTransition>
  );
}
