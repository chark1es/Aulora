import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { categoryChannels } from "../convex/lib/categoryChannels";

/**
 * convex-test hands out strictly increasing creation times, so it can never produce the
 * equal-`_creationTime` rows that imported data can. This fake `ctx.db` models only the
 * `by_category` index window the helper uses: `eq(categoryId)` then optional
 * `gte("_creationTime")`, ordered by `(_creationTime, _id)`, truncated by `take(n)`.
 */
type Row = { _id: string; _creationTime: number; categoryId: string };

function fakeCtx(rows: readonly Row[]) {
  const calls: { lower: number | null; take: number }[] = [];
  const ctx = {
    db: {
      query: (table: string) => {
        expect(table).toBe("channels");
        return {
          withIndex: (
            name: string,
            build: (q: {
              eq: (
                field: string,
                value: string,
              ) => { gte: (field: string, value: number) => unknown };
            }) => unknown,
          ) => {
            expect(name).toBe("by_category");
            let category: string | undefined;
            let lower: number | null = null;
            const range = {
              gte: (field: string, value: number) => {
                expect(field).toBe("_creationTime");
                lower = value;
                return range;
              },
            };
            build({
              eq: (field, value) => {
                expect(field).toBe("categoryId");
                category = value;
                return range;
              },
            });
            return {
              take: (n: number) => {
                calls.push({ lower, take: n });
                if (calls.length > 5_000) throw new Error("categoryChannels did not terminate");
                return Promise.resolve(
                  rows
                    .filter(
                      (row) =>
                        row.categoryId === category &&
                        (lower === null || row._creationTime >= lower),
                    )
                    .sort(
                      (a, b) =>
                        a._creationTime - b._creationTime ||
                        (a._id < b._id ? -1 : a._id > b._id ? 1 : 0),
                    )
                    .slice(0, n),
                );
              },
            };
          },
        };
      },
    },
  };
  return { ctx: ctx as never, calls };
}

const CATEGORY = "cat_target";

function seed(groups: readonly { count: number; at: number }[], other = 5): Row[] {
  const rows: Row[] = [];
  let n = 0;
  for (const group of groups) {
    for (let i = 0; i < group.count; i++) {
      rows.push({
        _id: `ch_${String(n++).padStart(5, "0")}`,
        _creationTime: group.at,
        categoryId: CATEGORY,
      });
    }
  }
  // Rows in another category share the timestamps and must never leak in.
  for (let i = 0; i < other; i++) {
    rows.push({ _id: `other_${i}`, _creationTime: groups[0]?.at ?? 1, categoryId: "cat_other" });
  }
  // Insertion order must not matter: the index is ordered, the table is not.
  return rows.reverse();
}

async function expectEveryChannelOnce(rows: Row[]) {
  const { ctx, calls } = fakeCtx(rows);
  const result = await categoryChannels(ctx, CATEGORY as Id<"categories">);
  const expected = rows
    .filter((row) => row.categoryId === CATEGORY)
    .map((row) => row._id)
    .sort();
  const ids = result.map((channel: Doc<"channels">) => channel._id as string);
  expect(new Set(ids).size).toBe(ids.length);
  expect([...ids].sort()).toEqual(expected);
  return calls;
}

describe("categoryChannels with equal _creationTime", () => {
  for (const count of [0, 1, 199, 200, 201, 600, 1001]) {
    it(`returns each of ${count} identical-timestamp channels exactly once and terminates`, async () => {
      const calls = await expectEveryChannelOnce(seed([{ count, at: 1_700_000_000_000 }]));
      // The window only widens; it never needs more than a handful of reads per page of rows.
      expect(calls.length).toBeLessThan(Math.max(4, Math.ceil(count / 200) * 8));
    });
  }

  it("handles mixed ties: distinct, paired and large equal groups in one category", async () => {
    const rows = seed([
      { count: 150, at: 1_000 },
      { count: 250, at: 2_000 },
      { count: 1, at: 3_000 },
      { count: 2, at: 4_000 },
      { count: 450, at: 5_000 },
      { count: 199, at: 6_000 },
      { count: 201, at: 7_000 },
    ]);
    await expectEveryChannelOnce(rows);
  });

  it("handles a tie group that straddles an exact page boundary", async () => {
    // 199 distinct rows, then 5 rows sharing the 200th timestamp: the page cuts mid-group.
    const rows = seed([
      ...Array.from({ length: 199 }, (_, i) => ({ count: 1, at: 100 + i })),
      { count: 5, at: 10_000 },
      { count: 1, at: 10_001 },
    ]);
    await expectEveryChannelOnce(rows);
  });
});
