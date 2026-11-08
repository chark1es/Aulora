// Fixture sources are inline strings; directory tests use a mkdtemp tree that
// this test creates and removes.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allowlistFrom, analyzeSource, RULES, runGuard } from "./convex-query-guard.mjs";

const fixtures = [];
afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const wrap = (body, wrapper = "query") => `
import { ${wrapper} } from "./_generated/server";
export const list = ${wrapper}({
  args: {},
  handler: async (ctx, args) => {
${body}
  },
});
`;

function analyze(body, options) {
  return analyzeSource(wrap(body), options);
}

test("collect() directly on ctx.db.query is a violation", () => {
  const [violation, ...rest] = analyze('return await ctx.db.query("messages").collect();');
  expect(rest).toEqual([]);
  expect(violation.rule).toBe(RULES.collect);
  expect(violation.functionName).toBe("list");
  expect(violation.key).toBe("<memory>#list#collect");
  expect(violation.detail).toContain('"messages"');
});

test("collect() after withIndex still counts as an unbounded read", () => {
  const violations = analyze(
    'return await ctx.db.query("messages").withIndex("by_channel", (q) => q.eq("channelId", args.id)).collect();',
  );
  expect(violations.map((violation) => violation.rule)).toEqual([RULES.collect]);
});

test("bounded terminals are not collect violations", () => {
  const violations = analyze(`
    await ctx.db.query("messages").withIndex("by_channel", (q) => q.eq("channelId", args.id)).take(20);
    await ctx.db.query("messages").withIndex("by_channel", (q) => q.eq("channelId", args.id)).first();
  `);
  expect(violations).toEqual([]);
});

test("filter() without withIndex is a violation but withIndex is fine", () => {
  const bad = analyze(
    'return await ctx.db.query("messages").filter((q) => q.eq(q.field("channelId"), args.id)).collect();',
  );
  expect(bad.map((violation) => violation.rule).sort()).toEqual([
    RULES.collect,
    RULES.filterWithoutIndex,
  ]);
  const good = analyze(
    'return await ctx.db.query("messages").withIndex("by_channel", (q) => q.eq("channelId", args.id)).filter((q) => q.neq(q.field("deletedAt"), undefined)).collect();',
  );
  expect(good.map((violation) => violation.rule)).toEqual([RULES.collect]);
});

test("filter() on an already collected array is not a db violation", () => {
  const violations = analyze(
    'const rows = await ctx.db.query("messages").withIndex("by_channel", (q) => q.eq("channelId", args.id)).collect();\n' +
      "return rows.filter((row) => row.pinned);",
  );
  expect(violations.map((violation) => violation.rule)).toEqual([RULES.collect]);
});

test("paginate with a literal, a numeric constant or a clamp is bounded", () => {
  const violations = analyze(`
    await ctx.db.query("a").paginate({ numItems: 25, cursor: null });
    const SCAN_PAGE = 100;
    await ctx.db.query("b").paginate({ numItems: SCAN_PAGE, cursor: null });
    await ctx.db.query("c").paginate({ numItems: Math.min(50, args.limit), cursor: null });
    await ctx.db.query("d").paginate({ ...args.paginationOpts, numItems: Math.min(50, args.paginationOpts.numItems) });
  `);
  expect(violations).toEqual([]);
});

test("paginate with a dynamic or missing numItems is a violation", () => {
  const violations = analyze(`
    await ctx.db.query("a").paginate(args.paginationOpts);
    await ctx.db.query("b").paginate({ cursor: null });
    await ctx.db.query("c").paginate({ numItems: args.numItems, cursor: null });
    const PAGE = 50;
    await ctx.db.query("d").paginate({ numItems: PAGE, cursor: null });
  `);
  expect(violations).toHaveLength(3);
  for (const violation of violations) expect(violation.rule).toBe(RULES.paginateUnbounded);
});

test("a local const clamp is resolved as bounded", () => {
  const violations = analyze(`
    const numItems = Math.min(Math.max(Math.floor(args.numItems ?? 25), 1), 100);
    await ctx.db.query("members").paginate({ numItems, cursor: args.cursor ?? null });
  `);
  expect(violations).toEqual([]);
});

test("mutation and internalQuery wrappers are scanned the same way", () => {
  expect(
    analyzeSource(wrap('await ctx.db.query("bots").collect();', "internalMutation"), {
      file: "convex/bots.ts",
    })[0].key,
  ).toBe("convex/bots.ts#list#collect");
  expect(
    analyzeSource(wrap('await ctx.db.query("bots").collect();', "mutation"), { file: "a.ts" })[0]
      .rule,
  ).toBe(RULES.collect);
});

test("nested named helpers are attributed to their own name", () => {
  const violations = analyze(`
    const loadBots = async () => ctx.db.query("bots").collect();
    return loadBots();
  `);
  expect(violations[0].functionName).toBe("loadBots");
  expect(violations[0].key).toBe("<memory>#loadBots#collect");
});

function tempConvex(files) {
  const root = mkdtempSync(join(tmpdir(), "aulora-convex-guard-"));
  fixtures.push(root);
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
}

test("runGuard ignores _generated and test files, and reports new violations", () => {
  const root = tempConvex({
    "ok.ts": wrap('await ctx.db.query("bots").collect();'),
    "_generated/api.ts": wrap('await ctx.db.query("bots").collect();'),
    "ignored.test.ts": wrap('await ctx.db.query("bots").collect();'),
  });
  const result = runGuard({ convexRoot: root, allowlist: { allow: [] } });
  expect(result.violations).toHaveLength(1);
  expect(result.failures).toHaveLength(1);
  expect(result.ok).toBe(false);
});

test("allowlisted violations pass and stale entries only warn", () => {
  const root = tempConvex({ "bots.ts": wrap('await ctx.db.query("bots").collect();') });
  const allow = {
    allow: [
      { key: "bots.ts#list#collect", reason: "Known bounded by the bot count limit." },
      { key: "bots.ts#removed#collect", reason: "Code was deleted." },
    ],
  };
  const result = runGuard({ convexRoot: root, allowlist: allow });
  expect(result.ok).toBe(true);
  expect(result.suppressed).toHaveLength(1);
  expect(result.stale).toEqual(["bots.ts#removed#collect"]);
});

test("allowlistFrom keeps reasons, adds new keys and preserves stale entries", () => {
  const violations = [
    { key: "a.ts#list#collect", rule: RULES.collect, detail: 'collect() on "messages"' },
    {
      key: "a.ts#page#paginate-unbounded",
      rule: RULES.paginateUnbounded,
      detail: "paginate with args.opts",
    },
  ];
  const existing = {
    allow: [
      { key: "a.ts#list#collect", reason: "Reviewed: bounded by workspace size." },
      { key: "gone.ts#old#collect", reason: "Still being cleaned up." },
    ],
  };
  const allowlist = allowlistFrom(violations, existing);
  const byKey = Object.fromEntries(allowlist.allow.map((entry) => [entry.key, entry.reason]));
  expect(byKey["a.ts#list#collect"]).toBe("Reviewed: bounded by workspace size.");
  expect(byKey["a.ts#page#paginate-unbounded"]).toContain("clamp numItems");
  expect(byKey["gone.ts#old#collect"]).toBe("Still being cleaned up.");
  expect(allowlist.allow.map((entry) => entry.key)).toEqual([
    "a.ts#list#collect",
    "a.ts#page#paginate-unbounded",
    "gone.ts#old#collect",
  ]);
});
