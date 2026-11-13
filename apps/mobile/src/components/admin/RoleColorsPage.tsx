/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { useCallback, useMemo, useReducer } from "react";
import { View } from "react-native";
import type { RoleView } from "../../lib/permissions";
import {
  EMPTY_ROLE_COLOR_PAGE,
  manageableRoleColors,
  type RoleColorEditorRole,
  roleColorBackTarget,
  roleColorDraftChanged,
  roleColorPageReducer,
} from "../../lib/role-colors";
import { PaneHeader, RoundButton, useDockClearance } from "../chat/HubPane";
import { PageTransition } from "../chat/PageTransition";
import { confirm } from "../kanban/board-menus";
import { useBackPress } from "../navigation/BackPress";
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

interface RoleColorEditorViewProps {
  readonly row: RoleColorEditorRole;
  readonly draftColor: string;
  readonly error: string | null;
  readonly clearance: number;
  readonly onDraftColor: (color: string) => void;
  readonly onError: (message: string | null) => void;
  readonly onSaved: () => void;
  readonly onBack: () => void;
}

/** The editor for one role, including the header's guarded back control. */
function RoleColorEditorView(props: RoleColorEditorViewProps) {
  const { row, clearance, onBack } = props;
  return (
    <PageTransition key={row.role.id}>
      <View className="flex-1 min-w-0" style={{ paddingBottom: clearance }}>
        <PaneHeader
          title={`Color for ${row.role.name}`}
          leading={<RoundButton icon="chevron-left" label="Back to roles" onPress={onBack} />}
        />
        <RoleColorEditor
          row={row}
          draftColor={props.draftColor}
          onDraftColor={props.onDraftColor}
          error={props.error}
          onError={props.onError}
          onSaved={props.onSaved}
          onBack={onBack}
        />
      </View>
    </PageTransition>
  );
}

interface RoleColorListViewProps {
  readonly rows: readonly RoleColorEditorRole[];
  readonly clearance: number;
  readonly onOpen: (row: RoleColorEditorRole) => void;
  readonly onBack: () => void;
}

/** The managed role list, with the same back control as the page around it. */
function RoleColorListView({ rows, clearance, onOpen, onBack }: RoleColorListViewProps) {
  return (
    <PageTransition key="list">
      <View className="flex-1 min-w-0" style={{ paddingBottom: clearance }}>
        <PaneHeader
          title="Role colors"
          leading={<RoundButton icon="chevron-left" label="Back to You" onPress={onBack} />}
        />
        <RoleColorList rows={rows} onOpen={onOpen} />
      </View>
    </PageTransition>
  );
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
  useBackPress(active, () => {
    goBack();
    return true;
  });

  if (selected !== null) {
    return (
      <RoleColorEditorView
        row={selected}
        draftColor={state.draftColor}
        error={state.error}
        clearance={clearance}
        onDraftColor={(color) => {
          dispatch({ type: "draft", color });
        }}
        onError={(message) => {
          dispatch({ type: "error", message });
        }}
        onSaved={() => {
          dispatch({ type: "back" });
        }}
        onBack={requestEditorBack}
      />
    );
  }

  return (
    <RoleColorListView
      rows={rows}
      clearance={clearance}
      onOpen={({ role }) => {
        dispatch({ type: "open", role });
      }}
      onBack={onBack}
    />
  );
}
