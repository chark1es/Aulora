// Reads the JSON result of `convex run setupState:issueSetupToken` on stdin and
// prints one field. Kept as a file because Bun's `node` shim drops arguments
// after `-e`.
//
//   node setup-token.mjs token    -> the printed-once token, or empty
//   node setup-token.mjs expires  -> ISO expiry, or empty
//   node setup-token.mjs status   -> "issued" | "existing" | "unavailable"
//
// The token itself never touches the deployment environment or the database.

import { readFileSync } from "node:fs";

const mode = process.argv[2] ?? "token";

function isJsonObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Returns the parsed value of the last balanced top-level JSON object in
 * `text`, or `null` when the stream has no parseable object.
 *
 * The pinned CLI prints `JSON.stringify(result, null, 2)` when stdout is not a
 * TTY (see `formatValue` in its `run` command), so the result spans several
 * indented lines. It may also print diagnostics before or after the result.
 * This scanner therefore:
 *
 *  - tries the whole trimmed stream first, which covers a clean result;
 *  - otherwise walks the stream, and at every `{` outside a string scans to its
 *    balanced `}` while tracking strings and escapes, so a brace inside a token
 *    or diagnostic cannot end the candidate early;
 *  - keeps the last balanced object that parses as JSON.
 */
function lastJsonObject(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const whole = JSON.parse(trimmed);
    if (isJsonObject(whole)) {
      return whole;
    }
  } catch {
    // The result is surrounded by CLI diagnostics; scan below.
  }

  let last = null;
  let index = 0;
  while (index < text.length) {
    if (text[index] !== "{") {
      index += 1;
      continue;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let cursor = index; cursor < text.length; cursor += 1) {
      const char = text[cursor];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          end = cursor;
          break;
        }
      }
    }
    if (end === -1) {
      // An unterminated brace (for example an unmatched diagnostic character)
      // cannot contain a complete object; stop scanning this candidate.
      index += 1;
      continue;
    }
    try {
      const value = JSON.parse(text.slice(index, end + 1));
      if (isJsonObject(value)) {
        last = value;
      }
    } catch {
      // Not JSON; a later balanced object may still be the result.
    }
    index = end + 1;
  }
  return last;
}

const parsed = lastJsonObject(readFileSync(0, "utf8"));
if (parsed === null) {
  process.stderr.write("setup-token.mjs: could not parse the setup token response\n");
  process.exit(1);
}

const token = typeof parsed.token === "string" && parsed.token.length > 0 ? parsed.token : null;
const expiresAt = typeof parsed.expiresAt === "number" ? parsed.expiresAt : null;

if (mode === "token") {
  process.stdout.write(token ?? "");
} else if (mode === "expires") {
  process.stdout.write(expiresAt === null ? "" : new Date(expiresAt).toISOString());
} else if (mode === "status") {
  process.stdout.write(token !== null ? "issued" : expiresAt !== null ? "existing" : "unavailable");
} else {
  process.stderr.write(`setup-token.mjs: unknown mode ${mode}\n`);
  process.exit(2);
}
