// Bot output capture: split streamed chunks into lines, clip them, and post
// them to the runner API in batches.
//
// Batches are capped (default 200 lines) and flushed on a timer (default 1 s)
// so a chatty bot cannot grow an unbounded request body or a memory buffer.

const DEFAULT_MAX_LINE_BYTES = 4096;

/** Clips a line to `maxBytes` UTF-8 bytes. */
export function clipLine(text, maxBytes = DEFAULT_MAX_LINE_BYTES) {
  const value = typeof text === "string" ? text : String(text);
  const buffer = Buffer.from(value, "utf8");
  return buffer.length <= maxBytes ? value : buffer.subarray(0, maxBytes).toString("utf8");
}

/**
 * Splits streamed chunks into complete lines. A partial line is buffered until
 * its newline arrives; a runaway line with no newline is emitted in chunks so
 * the buffer stays bounded.
 */
export function createLineBuffer(onLine, maxLineBytes = DEFAULT_MAX_LINE_BYTES) {
  const maxBuffered = maxLineBytes * 4;
  let partial = "";

  function drain() {
    let index = partial.indexOf("\n");
    while (index >= 0) {
      onLine(partial.slice(0, index).replace(/\r$/, ""));
      partial = partial.slice(index + 1);
      index = partial.indexOf("\n");
    }
  }

  return {
    push(chunk) {
      partial += chunk.toString("utf8");
      drain();
      while (partial.length > maxBuffered) {
        onLine(partial.slice(0, maxBuffered));
        partial = partial.slice(maxBuffered);
      }
    },
    flush() {
      if (partial.length > 0) {
        onLine(partial.replace(/\r$/, ""));
      }
      partial = "";
    },
  };
}

/**
 * Batches log lines per bot and posts them. `post(botId, lines)` must return a
 * promise; delivery failures are swallowed (the next batch retries implicitly
 * rather than crashing the supervisor).
 */
export function createLogShipper({
  post,
  now = Date.now,
  flushIntervalMs = 1000,
  maxBatchLines = 200,
  maxLineBytes = DEFAULT_MAX_LINE_BYTES,
}) {
  const pending = new Map();
  let timer = null;

  function flush() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.size === 0) return;
    const batches = [...pending.entries()];
    pending.clear();
    for (const [botId, lines] of batches) {
      Promise.resolve()
        .then(() => post(botId, lines))
        .catch(() => undefined);
    }
  }

  function schedule() {
    if (timer === null) timer = setTimeout(flush, flushIntervalMs);
  }

  function add(botId, stream, text) {
    const lines = pending.get(botId) ?? [];
    lines.push({ stream, text: clipLine(text, maxLineBytes), at: now() });
    pending.set(botId, lines);
    if (lines.length >= maxBatchLines) {
      flush();
      return;
    }
    schedule();
  }

  return {
    add,
    flush,
    stop() {
      flush();
    },
    pendingCount() {
      return pending.size;
    },
  };
}
