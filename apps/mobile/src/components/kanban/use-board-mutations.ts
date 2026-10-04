import { useMutation } from "convex/react";
import { useMemo } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { applyMove, applyTimer } from "../../lib/kanban";

/** Moves a card at once and lets the server correct it if it disagrees. */
export function useOptimisticMove() {
  const moveCard = useMutation(api.kanban.moveCard);
  return useMemo(
    () =>
      moveCard.withOptimisticUpdate((store, args) => {
        for (const query of store.getAllQueries(api.kanban.listCards)) {
          const cards = query.value;
          if (cards?.some((card) => card._id === args.cardId) === true)
            store.setQuery(api.kanban.listCards, query.args, applyMove(cards, args));
        }
      }),
    [moveCard],
  );
}

/** Starts or stops a timer at once and lets the server correct it if it disagrees. */
export function useOptimisticTimer(ownUserId: string) {
  const toggleTimer = useMutation(api.kanban.timer);
  return useMemo(
    () =>
      toggleTimer.withOptimisticUpdate((store, args) => {
        for (const query of store.getAllQueries(api.kanban.listCards)) {
          const cards = query.value;
          if (cards?.some((card) => card._id === args.cardId) === true)
            store.setQuery(
              api.kanban.listCards,
              query.args,
              applyTimer(cards, args, ownUserId, Date.now()),
            );
        }
      }),
    [toggleTimer, ownUserId],
  );
}

/** Every write the board itself makes. */
export function useBoardMutations(ownUserId: string) {
  return {
    createCard: useMutation(api.kanban.createCard),
    updateCard: useMutation(api.kanban.updateCard),
    archiveCard: useMutation(api.kanban.archiveCard),
    deleteCard: useMutation(api.kanban.deleteCard),
    archiveBoard: useMutation(api.kanban.archiveBoard),
    deleteBoard: useMutation(api.kanban.deleteBoard),
    move: useOptimisticMove(),
    timer: useOptimisticTimer(ownUserId),
  };
}

export type BoardMutations = ReturnType<typeof useBoardMutations>;
