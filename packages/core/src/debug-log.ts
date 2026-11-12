/** Local, session-only diagnostics. Never sends reports to a server. */
export const DEBUG_LOG_MAX_ENTRIES = 200;
export const DEBUG_LOG_MAX_BYTES = 256 * 1024;
const MAX_TEXT = 8_000;

export interface DebugLogEntry {
  readonly timestamp: string;
  readonly source: string;
  readonly detail: string;
}

/** Best-effort scrubbing; arbitrary error prose still needs review before sharing. */
export function redactDebugText(text: string): string {
  return (
    text
      .replace(/(?:https?|aulora):\/\/[^\s<>"')]+/gi, (url) => url.split(/[?#]/)[0] ?? "[URL]")
      .replace(/((?:https?|aulora):\/\/)[^/@\s]+@/gi, "$1[REDACTED]@")
      // Headers can contain spaces and semicolons. Discard their entire line.
      .replace(
        /\b(?:authorization|proxy-authorization|cookie|set-cookie)["']?\s*[:=]\s*[^\r\n]*/gi,
        "[REDACTED HEADER]",
      )
      .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [REDACTED]")
      .replace(
        /\b([a-z0-9_-]*(?:token|password|secret|cookie|authorization|api[_-]?key|private[_-]?key)[a-z0-9_-]*)\b["']?\s*[:=]\s*(?:"(?:\\.|[^"\\])*(?:"|\\?$)|'(?:\\.|[^'\\])*(?:'|\\?$)|[^\s,;}]+)/gi,
        "$1=[REDACTED]",
      )
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED JWT]")
  );
}

function describe(value: unknown): string {
  try {
    if (value instanceof Error) {
      return `${value.name}: ${value.message}\n${value.stack ?? ""}`.slice(0, MAX_TEXT);
    }
    if (typeof value === "string") return value.slice(0, MAX_TEXT);
    // Do not serialize arbitrary objects: they can contain messages, credentials,
    // circular references or getters. Callers should pass an Error or safe text.
    if (value === null || typeof value !== "object") return String(value).slice(0, MAX_TEXT);
    return "[Object omitted]";
  } catch {
    return "[Unreadable error]";
  }
}

export function createDebugLog() {
  let entries: DebugLogEntry[] = [];
  let bytes = 0;
  let dropped = 0;
  let recording = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* Diagnostics must never break the app. */
      }
    }
  };
  // Three bytes per UTF-16 code unit is a conservative UTF-8 upper bound.
  const size = (entry: DebugLogEntry) => JSON.stringify(entry).length * 3;
  return {
    record(source: string, ...values: unknown[]) {
      if (recording) return;
      recording = true;
      try {
        const entry = {
          timestamp: new Date().toISOString(),
          source: redactDebugText(source.slice(0, 120)),
          detail: redactDebugText(values.slice(0, 10).map(describe).join("\n")).slice(0, MAX_TEXT),
        };
        entries = [...entries, entry];
        bytes += size(entry);
        while (entries.length > DEBUG_LOG_MAX_ENTRIES || bytes > DEBUG_LOG_MAX_BYTES) {
          const first = entries.shift();
          if (first) bytes -= size(first);
          dropped += 1;
        }
        notify();
      } finally {
        recording = false;
      }
    },
    snapshot: (): readonly DebugLogEntry[] => entries,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear() {
      entries = [];
      bytes = 0;
      dropped = 0;
      notify();
    },
    report(client: string, reproduction: string) {
      return JSON.stringify(
        {
          format: 1,
          client: redactDebugText(client.slice(0, 200)),
          exportedAt: new Date().toISOString(),
          reproduction: redactDebugText(reproduction.slice(0, MAX_TEXT)),
          limits: { entries: DEBUG_LOG_MAX_ENTRIES, bytes: DEBUG_LOG_MAX_BYTES },
          dropped,
          entries,
        },
        null,
        2,
      );
    },
  };
}

export const debugLog = createDebugLog();

/** Install once per JS runtime, preserving the existing console behavior. */
let consoleInstalled = false;
export function installDebugConsole(): void {
  if (consoleInstalled) return;
  consoleInstalled = true;
  const capture =
    (source: string, original: typeof console.error) =>
    (...values: unknown[]) => {
      debugLog.record(source, ...values);
      original.apply(console, values);
    };
  console.error = capture("console.error", console.error);
  console.warn = capture("console.warn", console.warn);
}
