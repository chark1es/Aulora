import { View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { BoardColumns } from "./BoardColumns";
import { ArchivedBanner, BoardFilters } from "./BoardFilters";
import { BoardEmpty, BoardError, BoardHeader, BoardLoading } from "./BoardHeader";
import { BoardSheets } from "./BoardSheets";
import { CardSheet } from "./CardSheet";
import { type BoardController, type BoardProps, useBoard } from "./use-board";

/** The open board: its filters, then its columns once the cards have loaded. */
function BoardBody({ ctl }: { readonly ctl: BoardController }) {
  const { board } = ctl;
  if (ctl.boards === undefined) return <BoardLoading label="Loading boards" />;
  if (board === undefined) return <BoardEmpty ctl={ctl} />;
  return (
    <View className="flex-1">
      <BoardFilters ctl={ctl} board={board} />
      <ArchivedBanner ctl={ctl} board={board} />
      {ctl.cards === undefined ? (
        <BoardLoading label="Loading cards" />
      ) : (
        <BoardColumns key={board.id} ctl={ctl} board={board} />
      )}
    </View>
  );
}

/** The card opened from the board, if it still exists. */
function OpenCard({ ctl }: { readonly ctl: BoardController }) {
  const card = ctl.cards?.find((entry) => entry._id === ctl.detail);
  if (card === undefined || ctl.board === undefined) return null;
  return (
    <CardSheet
      key={card._id}
      card={card}
      board={ctl.board}
      members={ctl.members}
      permissions={ctl.permissions}
      ownUserId={ctl.ownUserId}
      onClose={() => {
        ctl.setDetail(undefined);
      }}
    />
  );
}

/**
 * The Kanban addon on a phone or tablet: one board at a time, with columns
 * that page sideways and cards that open in a sheet.
 */
export function KanbanScreen(props: BoardProps) {
  const ctl = useBoard(props);
  return (
    // Lifts the add-card composer clear of the keyboard.
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <BoardHeader ctl={ctl} />
      <BoardError ctl={ctl} />
      <BoardBody ctl={ctl} />
      <BoardSheets ctl={ctl} />
      <OpenCard ctl={ctl} />
    </KeyboardAvoidingView>
  );
}
