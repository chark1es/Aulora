import { type ChannelSummary, dmPartnerId } from "@aulora/core";

/**
 * Client-side ceiling on the ids sent to `presence.getMany`. It matches the
 * server's own 300-id cap (see `packages/convex/convex/presence.ts`) so the
 * client never asks for more than the server will answer; ids past the cap are
 * simply left out and read as offline until they enter a rendered view.
 */
export const PRESENCE_SCOPE_MAX = 300;

export interface PresenceScopeInput {
  /** The signed-in user, whose own status the header always shows. */
  readonly ownUserId: string;
  /** Authors of the messages currently loaded in the open timeline. */
  readonly timelineAuthorIds: readonly string[];
  /**
   * Members currently rendered by the members pane or an open picker. The pane
   * is bounded (and only counted while it is on screen), so this stays small.
   */
  readonly displayedMemberIds: readonly string[];
  /** Channels the list renders; each 1:1 DM's partner status is shown. */
  readonly channels: readonly Pick<ChannelSummary, "kind" | "memberIds">[];
  /**
   * Any other ids on screen, e.g. an open picker's filtered results. Appended
   * last so the core timeline/member set wins the cap.
   */
  readonly extraUserIds?: readonly string[];
}

/**
 * Builds the de-duplicated, capped set of user ids whose presence the client
 * should subscribe to: exactly the people the UI is rendering right now (the
 * open timeline, the displayed members pane, the DM partners in the list and any
 * open picker), never the whole workspace.
 *
 * Order is a render priority, so when a workspace has more than
 * {@link PRESENCE_SCOPE_MAX} relevant users the ones the reader is most likely
 * looking at keep their live status; the tail reads as offline. The result is
 * referentially stable for a given set (same insertion order), so it is safe to
 * use as an effect dependency.
 */
export function buildPresenceScope(input: PresenceScopeInput): readonly string[] {
  const ids = new Set<string>();
  const add = (id: string | undefined) => {
    if (id !== undefined && id.length > 0) {
      ids.add(id);
    }
  };
  add(input.ownUserId);
  for (const id of input.timelineAuthorIds) {
    add(id);
  }
  for (const id of input.displayedMemberIds) {
    add(id);
  }
  for (const channel of input.channels) {
    add(dmPartnerId(channel, input.ownUserId));
  }
  for (const id of input.extraUserIds ?? []) {
    add(id);
  }
  const all = [...ids];
  return all.length <= PRESENCE_SCOPE_MAX ? all : all.slice(0, PRESENCE_SCOPE_MAX);
}
