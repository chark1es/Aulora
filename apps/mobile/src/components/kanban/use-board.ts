/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { hasPermission, Permission } from "@aulora/core";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import {
  type BoardMember,
  type CardFilters,
  failure,
  filterCards,
  filterCount,
  NO_FILTERS,
} from "../../lib/kanban";
import { useBoardMutations } from "./use-board-mutations";

export interface BoardProps {
  readonly ownUserId: string;
  readonly permissions: bigint;
  readonly members: readonly BoardMember[];
  /** Kept by the parent so the board survives a visit to another tab. */
  readonly boardId: string | null;
  readonly onBoardChange: (boardId: string | null) => void;
}

/** The sheet currently over the board, if any. */
export type OpenSheet =
  | { readonly kind: "boards" | "board" | "assignees" | "labels" | "priorities" }
  | { readonly kind: "settings" | "newBoard" }
  | { readonly kind: "card"; readonly cardId: string };

/** What the viewer has switched on: archived views, filters, and what is open. */
function useBoardState() {
  const [archivedBoards, setArchivedBoards] = useState(false);
  const [archivedCards, setArchivedCards] = useState(false);
  const [filters, setFilters] = useState<CardFilters>(NO_FILTERS);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState<OpenSheet | undefined>();
  const [detail, setDetail] = useState<string | undefined>();
  const [composing, setComposing] = useState<string | undefined>();
  return {
    archivedBoards,
    setArchivedBoards,
    archivedCards,
    setArchivedCards,
    filters,
    setFilters,
    searching,
    setSearching,
    open,
    setOpen,
    detail,
    setDetail,
    composing,
    setComposing,
  };
}

type BoardState = ReturnType<typeof useBoardState>;

/** Runs a write and keeps its failure for the banner. */
function useRunner() {
  const [error, setError] = useState<string | undefined>();
  const run = useCallback(async (work: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await work();
      return true;
    } catch (cause) {
      setError(failure(cause));
      return false;
    }
  }, []);
  return { error, setError, run };
}

/** The boards and cards the viewer may see, and what they may do with them. */
function useBoardData(props: BoardProps, state: BoardState) {
  const { archivedBoards, archivedCards, filters } = state;
  const boards = useQuery(api.kanban.listBoards, {});
  const visibleBoards = useMemo(
    () => (boards ?? []).filter((entry) => entry.archived === archivedBoards),
    [boards, archivedBoards],
  );
  const board = visibleBoards.find((entry) => entry.id === props.boardId) ?? visibleBoards.at(0);
  const cards = useQuery(api.kanban.listCards, board ? { boardId: board.id } : "skip");
  const canManage = hasPermission(props.permissions, Permission.ManageKanban);
  const canEdit =
    hasPermission(props.permissions, Permission.EditKanban) && board?.archived !== true;
  const boardMembers = useMemo(
    () =>
      props.members.filter(
        (member) => board?.private !== true || board.memberIds.includes(member.userId),
      ),
    [props.members, board],
  );
  const inView = useMemo(
    () => (cards ?? []).filter((card) => card.archived === archivedCards),
    [cards, archivedCards],
  );
  const filtered = useMemo(() => filterCards(inView, filters), [inView, filters]);
  return {
    boards,
    visibleBoards,
    board,
    cards,
    canManage,
    canEdit,
    canArrange: canEdit && !archivedCards,
    boardMembers,
    inView,
    filtered,
    filtering: filterCount(filters) > 0,
  };
}

/** Cards stagger in once per board; anything arriving later just fades in. */
function useFirstPaint(scope: string, loaded: boolean): boolean {
  const [settled, setSettled] = useState<string | undefined>();
  useEffect(() => {
    if (!loaded) return;
    const timeout = setTimeout(() => {
      setSettled(scope);
    }, 700);
    return () => {
      clearTimeout(timeout);
    };
  }, [scope, loaded]);
  return settled !== scope;
}

function ignoreColumn(): void {
  // Until the column pager mounts there is nothing to scroll.
}

/** Everything the board screen and its parts share. */
export function useBoard(props: BoardProps) {
  const state = useBoardState();
  const data = useBoardData(props, state);
  const runner = useRunner();
  const mutations = useBoardMutations(props.ownUserId);
  const showColumn = useRef<(index: number) => void>(ignoreColumn);
  const boardId = data.board?.id;
  const { setFilters, setSearching, setArchivedCards, setComposing, setDetail } = state;
  // A board change starts a new filter and editing context.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset whenever the selected board changes
  useEffect(() => {
    setFilters(NO_FILTERS);
    setSearching(false);
    setArchivedCards(false);
    setComposing(undefined);
    setDetail(undefined);
  }, [boardId]);
  const firstPaint = useFirstPaint(
    `${boardId ?? ""}:${String(state.archivedCards)}`,
    data.cards !== undefined,
  );
  return {
    ...state,
    ...data,
    ...runner,
    mutations,
    firstPaint,
    ownUserId: props.ownUserId,
    permissions: props.permissions,
    members: props.members,
    selectBoard: props.onBoardChange,
    /** Set by the column pager, so a menu can bring a column into view. */
    showColumn,
  };
}

export type BoardController = ReturnType<typeof useBoard>;
