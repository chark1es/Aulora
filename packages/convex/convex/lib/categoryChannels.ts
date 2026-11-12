import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

const PAGE = 200;

/**
 * Every channel in a category, read in bounded pages that never skip channels sharing a
 * `_creationTime` (imported data keeps supplied timestamps). Convex allows one `.paginate()` per
 * query, so this walks the `by_category` index with `>=` and de-duplicates by id; if a whole page
 * is already seen (more than one page of identical timestamps) the window widens until it
 * reaches new rows, so progress is guaranteed.
 */
export async function categoryChannels(
  ctx: Pick<QueryCtx, "db">,
  categoryId: Id<"categories">,
): Promise<Doc<"channels">[]> {
  const seen = new Map<Id<"channels">, Doc<"channels">>();
  let from: number | null = null;
  let window = PAGE;
  while (true) {
    const lower: number | null = from;
    const page: Doc<"channels">[] = await ctx.db
      .query("channels")
      .withIndex("by_category", (q) => {
        const base = q.eq("categoryId", categoryId);
        return lower === null ? base : base.gte("_creationTime", lower);
      })
      .take(window);
    let added = 0;
    for (const channel of page) {
      if (seen.has(channel._id)) continue;
      seen.set(channel._id, channel);
      added += 1;
    }
    if (page.length < window) break;
    window = added === 0 ? window + PAGE : PAGE;
    from = page.at(-1)?._creationTime ?? from;
  }
  return [...seen.values()];
}
