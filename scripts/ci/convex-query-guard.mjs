/* eslint-disable security/detect-non-literal-fs-filename -- Paths are the repository checkout, build output or a temp fixture, joined from fixed names or this script's own arguments, never request data. */
/* eslint-disable xss/no-mixed-html -- Strings containing markup or generics are parsed as text; nothing is rendered or inserted into a page. */
// Regression guard for unbounded Convex data access.
//
// Scans `packages/convex/convex` (excluding `_generated` and tests) for three
// patterns that quietly turn a bounded read into a full-table scan or an
// attacker-controlled page:
//
//   1. `ctx.db.query(...).collect()`            full table or index read
//   2. `.filter(...)` without `.withIndex(...)` predicate evaluated after the read
//   3. `.paginate(...)` with a dynamic, unclamped `numItems`
//
// Pre-existing violations live in `convex-query-allowlist.json`. Their key is
// `<convex path>#<function>#<rule>`, so moving code between lines keeps the
// entry valid. A new violation fails the guard; a stale allowlist entry only
// warns, because entries are removed in separate cleanups.
//
//   node scripts/ci/convex-query-guard.mjs            # check the current tree
//   node scripts/ci/convex-query-guard.mjs --update   # record the baseline
//
// See docs/performance.md for how to justify an exception.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(scriptDir, "..", "..");
export const defaultConvexRoot = resolve(repoRoot, "packages", "convex", "convex");
export const defaultAllowlist = resolve(scriptDir, "convex-query-allowlist.json");

export const RULES = {
  collect: "collect",
  filterWithoutIndex: "filter-without-index",
  paginateUnbounded: "paginate-unbounded",
};

const CONVEX_WRAPPERS = new Set([
  "query",
  "internalQuery",
  "mutation",
  "internalMutation",
  "action",
  "internalAction",
  "httpAction",
]);

const QUERY_TERMINALS = new Set(["collect", "take", "first", "unique", "paginate", "count"]);

const CLAMP_CALLS = new Set(["min", "max"]);

/** Function names that are assumed to clamp their argument. */
const CLAMP_HELPERS = new Set(["clamp", "clampNumber", "clampLimit", "clampPageSize"]);

function unwrap(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAwaitExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(node) {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node))
    return node.text;
  return undefined;
}

function isCallTo(node, names) {
  if (!ts.isCallExpression(node)) return false;
  if (!ts.isIdentifier(node.expression)) return false;
  return names.has(node.expression.text);
}

/**
 * Whether an initializer creates a registered Convex function
 * (`export const list = query({...})`), not an ordinary local constant.
 */
function isConvexWrapperCall(node) {
  return isCallTo(node, CONVEX_WRAPPERS);
}

function isFunctionLike(node) {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isFunctionDeclaration(node)
  );
}

/**
 * Walk a db query chain backwards from its terminal call and report whether it
 * started at `ctx.db.query`, used an index, or already terminated (so a later
 * `.filter` is an in-memory array operation, not a database one).
 */
function inspectChain(expression) {
  const result = { hasQuery: false, hasWithIndex: false, terminated: false, table: undefined };
  const walk = (node) => {
    const current = unwrap(node);
    if (ts.isPropertyAccessExpression(current)) {
      if (current.name.text === "withIndex") result.hasWithIndex = true;
      walk(current.expression);
      return;
    }
    if (!ts.isCallExpression(current)) return;
    const callee = current.expression;
    if (!ts.isPropertyAccessExpression(callee)) return;
    const method = callee.name.text;
    if (method === "withIndex") result.hasWithIndex = true;
    if (QUERY_TERMINALS.has(method)) result.terminated = true;
    if (method === "query") {
      const receiver = unwrap(callee.expression);
      if (ts.isPropertyAccessExpression(receiver) && receiver.name.text === "db") {
        result.hasQuery = true;
        const table = current.arguments[0];
        if (table && ts.isStringLiteralLike(table)) result.table = table.text;
      }
    }
    walk(callee.expression);
  };
  walk(expression);
  return result;
}

/**
 * File-scope constant initializers, used to tell a capped `numItems` constant
 * from a caller-supplied one. A name can appear more than once in a file, so a
 * constant is only "capped" when every initializer is provably bounded.
 */
function collectConstantInitializers(sourceFile) {
  const constants = new Map();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const list = constants.get(node.name.text) ?? [];
      list.push(node.initializer);
      constants.set(node.name.text, list);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return constants;
}

function isBoundedValue(node, constants, depth = 0) {
  const current = unwrap(node);
  if (depth > 8) return false;
  if (ts.isNumericLiteral(current)) return true;
  if (
    ts.isPrefixUnaryExpression(current) &&
    (current.operator === ts.SyntaxKind.MinusToken || current.operator === ts.SyntaxKind.PlusToken)
  ) {
    return ts.isNumericLiteral(current.operand);
  }
  if (ts.isCallExpression(current)) {
    const callee = current.expression;
    if (ts.isPropertyAccessExpression(callee)) {
      const receiver = unwrap(callee.expression);
      if (
        ts.isIdentifier(receiver) &&
        receiver.text === "Math" &&
        CLAMP_CALLS.has(callee.name.text)
      ) {
        return true;
      }
    } else if (ts.isIdentifier(callee) && CLAMP_HELPERS.has(callee.text)) {
      return true;
    }
    const outer = unwrap(current.arguments[0]);
    return outer !== current && isBoundedValue(outer, constants, depth + 1);
  }
  if (ts.isIdentifier(current)) {
    const initializers = constants.get(current.text);
    if (!initializers || initializers.length === 0) return false;
    return initializers.every((initializer) => isBoundedValue(initializer, constants, depth + 1));
  }
  return false;
}

function describePaginateArgument(node) {
  const text = node.getText().replace(/\s+/g, " ");
  return text.length > 72 ? `${text.slice(0, 69)}...` : text;
}

/**
 * The `numItems` of a paginate argument is bounded when it is a numeric
 * literal, a file constant with a numeric literal/clamped initializer, or a
 * clamp call such as `Math.min(...)`.
 */
function paginateIsBounded(argument, constants) {
  if (!argument) return false;
  const current = unwrap(argument);
  if (current !== argument) return paginateIsBounded(current, constants);
  if (ts.isObjectLiteralExpression(current)) {
    let found = false;
    for (const property of current.properties) {
      if (ts.isPropertyAssignment(property)) {
        if (propertyName(property.name) !== "numItems") continue;
        found = true;
        if (!isBoundedValue(property.initializer, constants)) return false;
      } else if (ts.isShorthandPropertyAssignment(property)) {
        if (property.name.text !== "numItems") continue;
        found = true;
        if (!isBoundedValue(property.name, constants)) return false;
      }
    }
    // A spread-only object (or `{...opts}`) has no visible bound.
    return found;
  }
  return isBoundedValue(current, constants);
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function allowKey(file, functionName, rule) {
  return `${file}#${functionName}#${rule}`;
}

/**
 * Analyze one TypeScript source. Returns violations keyed for the allowlist.
 * `file` is the path shown in the key (convex-directory relative, POSIX).
 */
export function analyzeSource(sourceText, { file = "<memory>" } = {}) {
  const sourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const constants = collectConstantInitializers(sourceFile);
  const violations = [];

  const record = (node, functionName, rule, detail) => {
    // Attribute a violation to the innermost registered Convex function when a
    // helper in `lib/` is only called by one, otherwise to its own name.
    violations.push({
      file,
      functionName,
      rule,
      line: lineOf(sourceFile, node),
      detail,
      key: allowKey(file, functionName, rule),
    });
  };

  const visit = (node, functionName) => {
    let name = functionName;
    if (ts.isFunctionDeclaration(node) && node.name) {
      name = node.name.text;
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (isFunctionLike(node.initializer) || isConvexWrapperCall(node.initializer))
    ) {
      name = node.name.text;
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const chain = inspectChain(node.expression.expression);
      if (method === "collect" && chain.hasQuery) {
        record(node, name, RULES.collect, `collect() on "${chain.table ?? "unknown"}"`);
      } else if (
        method === "filter" &&
        chain.hasQuery &&
        !chain.hasWithIndex &&
        !chain.terminated
      ) {
        record(
          node,
          name,
          RULES.filterWithoutIndex,
          `filter() on "${chain.table ?? "unknown"}" without withIndex()`,
        );
      } else if (method === "paginate" && chain.hasQuery) {
        const argument = node.arguments[0];
        if (!paginateIsBounded(argument, constants)) {
          record(
            node,
            name,
            RULES.paginateUnbounded,
            `paginate with ${argument ? describePaginateArgument(argument) : "no options"}`,
          );
        }
      }
    }

    ts.forEachChild(node, (child) => visit(child, name));
  };
  visit(sourceFile, "<module>");
  return violations;
}

function listSourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "_generated") continue;
      found.push(...listSourceFiles(full));
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".d.ts")) continue;
    found.push(full);
  }
  return found;
}

/**
 * Scan every Convex source under `convexRoot` and compare against the
 * allowlist. Stale entries are reported as warnings, never failures.
 */
export function runGuard({ convexRoot = defaultConvexRoot, allowlist = { allow: [] } } = {}) {
  const allowed = new Map((allowlist.allow ?? []).map((entry) => [entry.key, entry]));
  const violations = [];
  const seenKeys = new Set();
  for (const filePath of listSourceFiles(convexRoot)) {
    const file = relative(convexRoot, filePath).split(sep).join("/");
    const sourceText = readFileSync(filePath, "utf8");
    for (const violation of analyzeSource(sourceText, { file })) {
      seenKeys.add(violation.key);
      violations.push({ ...violation, allowed: allowed.has(violation.key) });
    }
  }
  const stale = [...allowed.keys()].filter((key) => !seenKeys.has(key)).sort();
  const failures = violations.filter((violation) => !violation.allowed);
  const suppressed = violations.filter((violation) => violation.allowed);
  return { ok: failures.length === 0, violations, failures, suppressed, stale };
}

function defaultReason(violation) {
  switch (violation.rule) {
    case RULES.collect:
      return `Pre-existing ${violation.detail}; replace it with a bounded index query.`;
    case RULES.filterWithoutIndex:
      return `Pre-existing ${violation.detail}; move the predicate into an index.`;
    case RULES.paginateUnbounded:
      return `Pre-existing ${violation.detail}; clamp numItems or keep the window small.`;
    default:
      return "Pre-existing violation; bound or index the read.";
  }
}

/**
 * A fresh allowlist. Existing entries keep their reason, so `--update` never
 * rewrites review notes, and stale entries survive until a cleanup removes
 * them deliberately.
 */
export function allowlistFrom(violations, existing = { allow: [] }) {
  const reasons = new Map((existing.allow ?? []).map((entry) => [entry.key, entry.reason]));
  const entries = new Map();
  for (const entry of existing.allow ?? []) entries.set(entry.key, entry);
  for (const violation of violations) {
    if (entries.has(violation.key)) continue;
    entries.set(violation.key, {
      key: violation.key,
      reason: reasons.get(violation.key) ?? defaultReason(violation),
    });
  }
  return {
    version: 1,
    note:
      "Pre-existing unbounded Convex reads. The key is <convex file>#<function>#<rule>. " +
      "Entries only suppress existing violations; a new violation fails `bun run check`. " +
      "Remove an entry when the read becomes bounded. See docs/performance.md.",
    allow: [...entries.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
}

function formatReport(result) {
  const lines = [
    `convex-query-guard: ${result.violations.length} violations ` +
      `(${result.suppressed.length} allowlisted, ${result.failures.length} new)`,
  ];
  for (const violation of result.failures) {
    lines.push(
      `  FAIL: ${violation.file}:${violation.line} ${violation.functionName}: ${violation.detail}`,
    );
  }
  for (const key of result.stale) {
    lines.push(`  warn: stale allowlist entry ${key} (no matching violation; remove it)`);
  }
  lines.push(
    result.ok ? "convex-query-guard: no new unbounded reads" : "convex-query-guard: failed",
  );
  return `${lines.join("\n")}\n`;
}

function main(argv) {
  const update = argv.includes("--update");
  const option = (name) => {
    const match = argv.find((argument) => argument.startsWith(`--${name}=`));
    return match ? match.slice(name.length + 3) : undefined;
  };
  const convexRoot = resolve(option("root") ?? defaultConvexRoot);
  const allowlistPath = resolve(option("allowlist") ?? defaultAllowlist);
  const existing = existsSync(allowlistPath)
    ? JSON.parse(readFileSync(allowlistPath, "utf8"))
    : { allow: [] };

  if (!update && !existsSync(allowlistPath)) {
    throw new Error(
      `No allowlist at ${allowlistPath}. Run \`node scripts/ci/convex-query-guard.mjs --update\` ` +
        "to record the baseline.",
    );
  }

  const result = runGuard({ convexRoot, allowlist: existing });
  if (update) {
    const allowlist = allowlistFrom(result.violations, existing);
    writeFileSync(allowlistPath, `${JSON.stringify(allowlist, null, 2)}\n`);
    process.stdout.write(
      `convex-query-guard: wrote ${allowlistPath} (${allowlist.allow.length} entries)\n`,
    );
    return 0;
  }
  process.stdout.write(formatReport(result));
  return result.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `convex-query-guard: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
