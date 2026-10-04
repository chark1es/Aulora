/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { hasPermission, Permission } from "@aulora/core";
import { useContextMenu } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { type CardFilters, filterCards, isFiltering, NO_FILTERS } from "./board-logic";
import { type BoardMember, type Card, failure } from "./types";

export interface KanbanProps {
  ownUserId: string;
  permissions: bigint;
  members: readonly BoardMember[];
  onBack: () => void;
}

/** A destructive action waiting for the user to confirm it. */
export type Confirm = { kind: "deleteBoard" | "archiveBoard" } | { kind: "deleteCard"; card: Card };

/** What the viewer has switched on: archived views, filters, and what is open. */
function useBoardState() {
  const [boardId, setBoardId] = useState<string | undefined>();
  const [archivedBoards, setArchivedBoards] = useState(false);
  const [archivedCards, setArchivedCards] = useState(false);
  const [filters, setFilters] = useState<CardFilters>(NO_FILTERS);
  const [newBoard, setNewBoard] = useState(false);
  const [settings, setSettings] = useState(false);
  const [github, setGithub] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | undefined>();
  const [selectedCard, setSelectedCard] = useState<string | undefined>();
  const [composing, setComposing] = useState<string | undefined>();
  return {
    boardId,
    setBoardId,
    archivedBoards,
    setArchivedBoards,
    archivedCards,
    setArchivedCards,
    filters,
    setFilters,
    newBoard,
    setNewBoard,
    settings,
    setSettings,
    github,
    setGithub,
    confirm,
    setConfirm,
    selectedCard,
    setSelectedCard,
    composing,
    setComposing,
  };
}

type BoardState = ReturnType<typeof useBoardState>;

/** Runs a write, blocks a second one meanwhile, and keeps its failure for the banner. */
function useRunner() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  /** Called after every write; the drag uses it to put its placeholder away. */
  const settled = useRef<() => void>(undefined);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      return true;
    } catch (cause) {
      setError(failure(cause));
      return false;
    } finally {
      setBusy(false);
      settled.current?.();
    }
  };
  return { busy, error, setError, run, settled };
}

/** Every write the board makes. */
function useBoardMutations() {
  return {
    createBoard: useMutation(api.kanban.createBoard),
    createCard: useMutation(api.kanban.createCard),
    updateCard: useMutation(api.kanban.updateCard),
    move: useMutation(api.kanban.moveCard),
    archiveCard: useMutation(api.kanban.archiveCard),
    deleteCard: useMutation(api.kanban.deleteCard),
    timer: useMutation(api.kanban.timer),
    archiveBoard: useMutation(api.kanban.archiveBoard),
    deleteBoard: useMutation(api.kanban.deleteBoard),
  };
}

/** The boards and cards the viewer may see, and what they may do with them. */
function useBoardData(props: KanbanProps, state: BoardState) {
  const boards = useQuery(api.kanban.listBoards, {});
  const visibleBoards = (boards ?? []).filter((entry) => entry.archived === state.archivedBoards);
  const board = visibleBoards.find((entry) => entry.id === state.boardId) ?? visibleBoards.at(0);
  const cards = useQuery(api.kanban.listCards, board ? { boardId: board.id } : "skip");
  const canManage = hasPermission(props.permissions, Permission.ManageKanban);
  const canEdit =
    hasPermission(props.permissions, Permission.EditKanban) && board?.archived !== true;
  const inView = (cards ?? []).filter((card) => card.archived === state.archivedCards);
  return {
    boards,
    visibleBoards,
    board,
    cards,
    canManage,
    canEdit,
    canArrange: canEdit && !state.archivedCards,
    boardMembers: props.members.filter(
      (member) => board?.private !== true || board.memberIds.includes(member.userId),
    ),
    inView,
    filtered: filterCards(inView, state.filters),
    filtering: isFiltering(state.filters),
  };
}

/** The current time, for timers and due dates. */
function useClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(tick);
    };
  }, []);
  return now;
}

/** Everything the board view and its parts share. */
export function useBoard(props: KanbanProps) {
  const state = useBoardState();
  const data = useBoardData(props, state);
  const runner = useRunner();
  const mutations = useBoardMutations();
  const openMenu = useContextMenu();
  const boardId = data.board?.id;
  const { setFilters, setSelectedCard, setSettings, setArchivedCards, setComposing } = state;
  // A board change starts a new filter and editing context.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the editing context whenever the selected board changes
  useEffect(() => {
    setFilters(NO_FILTERS);
    setSelectedCard(undefined);
    setSettings(false);
    setArchivedCards(false);
    setComposing(undefined);
  }, [boardId]);
  return {
    ...props,
    ...state,
    ...data,
    ...runner,
    mutations,
    openMenu,
    now: useClock(),
    clearFilters: () => {
      setFilters(NO_FILTERS);
    },
  };
}

export type BoardController = ReturnType<typeof useBoard>;
