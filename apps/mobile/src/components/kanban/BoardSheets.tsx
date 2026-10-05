import { View } from "react-native";
import { type Board, PRIORITIES, priorityInfo, UNASSIGNED } from "../../lib/kanban";
import { MemberAvatar } from "../chat/MemberAvatar";
import { BoardSettingsSheet } from "./BoardSettingsSheet";
import { boardActions, boardChoices, cardActions } from "./board-menus";
import { NewBoardSheet } from "./NewBoardSheet";
import { PickerSheet } from "./PickerSheet";
import { PriorityFlag } from "./parts";
import { ActionSheet } from "./sheets";
import type { BoardController } from "./use-board";

interface SheetProps {
  readonly ctl: BoardController;
  readonly onClose: () => void;
}

function AssigneeFilter({ ctl, onClose }: SheetProps) {
  const unassigned = {
    id: UNASSIGNED,
    label: "Unassigned",
    leading: <View className="h-7 w-7 rounded-pill border border-dashed border-text-muted" />,
  };
  const people = ctl.boardMembers.map((member) => ({
    id: member.userId,
    label: member.displayName,
    leading: <MemberAvatar userId={member.userId} size={28} />,
  }));
  return (
    <PickerSheet
      multiple
      title="Filter by assignee"
      searchPlaceholder="Find a person"
      options={[unassigned, ...people]}
      selected={ctl.filters.assignees}
      onChange={(assignees) => {
        ctl.setFilters({ ...ctl.filters, assignees });
      }}
      onClose={onClose}
    />
  );
}

function LabelFilter({ ctl, onClose, board }: SheetProps & { readonly board: Board }) {
  return (
    <PickerSheet
      multiple
      title="Filter by label"
      emptyText="This board has no labels yet"
      options={board.labels.map((label) => ({
        id: label.id,
        label: label.name,
        leading: <View className="h-3 w-3 rounded-pill" style={{ backgroundColor: label.color }} />,
      }))}
      selected={ctl.filters.labels}
      onChange={(labels) => {
        ctl.setFilters({ ...ctl.filters, labels });
      }}
      onClose={onClose}
    />
  );
}

function PriorityFilter({ ctl, onClose }: SheetProps) {
  return (
    <PickerSheet
      multiple
      title="Filter by priority"
      options={[...PRIORITIES].reverse().map((priority) => ({
        id: priority,
        label: priorityInfo(priority).label,
        leading: <PriorityFlag priority={priority} />,
      }))}
      selected={ctl.filters.priorities}
      onChange={(priorities) => {
        ctl.setFilters({ ...ctl.filters, priorities });
      }}
      onClose={onClose}
    />
  );
}

/** The menus and filters that need a board to be open. */
function OpenBoardSheet({ ctl, onClose, board }: SheetProps & { readonly board: Board }) {
  const open = ctl.open;
  if (open === undefined) return null;
  if (open.kind === "board")
    return <ActionSheet title={board.name} actions={boardActions(ctl, board)} onClose={onClose} />;
  if (open.kind === "assignees") return <AssigneeFilter ctl={ctl} onClose={onClose} />;
  if (open.kind === "labels") return <LabelFilter ctl={ctl} board={board} onClose={onClose} />;
  if (open.kind === "priorities") return <PriorityFilter ctl={ctl} onClose={onClose} />;
  if (open.kind === "settings")
    return (
      <BoardSettingsSheet key={board.id} board={board} members={ctl.members} onClose={onClose} />
    );
  if (open.kind !== "card") return null;
  const card = ctl.cards?.find((entry) => entry._id === open.cardId);
  if (card === undefined) return null;
  return (
    <ActionSheet title={card.title} actions={cardActions(ctl, board, card)} onClose={onClose} />
  );
}

/** Whichever menu, filter or form is open over the board. */
export function BoardSheets({ ctl }: { readonly ctl: BoardController }) {
  const { open, board } = ctl;
  const onClose = () => {
    ctl.setOpen(undefined);
  };
  if (open === undefined) return null;
  if (open.kind === "boards")
    return (
      <ActionSheet
        title={ctl.archivedBoards ? "Archived boards" : "Boards"}
        actions={boardChoices(ctl)}
        onClose={onClose}
      />
    );
  if (open.kind === "newBoard")
    return (
      <NewBoardSheet
        ownUserId={ctl.ownUserId}
        onClose={onClose}
        onCreated={(id) => {
          ctl.setArchivedBoards(false);
          ctl.selectBoard(id);
        }}
      />
    );
  if (board === undefined) return null;
  return <OpenBoardSheet ctl={ctl} board={board} onClose={onClose} />;
}
