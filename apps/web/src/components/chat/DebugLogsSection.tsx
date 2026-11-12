import { type DebugLogEntry, debugLog } from "@aulora/core";
import { Button, Text } from "@aulora/ui-web";
import { useState, useSyncExternalStore } from "react";
import { CLIENT_VERSION } from "../../lib/client-version";

/** A long session can hold hundreds of entries; the report keeps all of them. */
const DISPLAY_LIMIT = 50;

export function DebugLogsSection() {
  const entries = useSyncExternalStore(debugLog.subscribe, debugLog.snapshot);
  const [steps, setSteps] = useState("");
  const [status, setStatus] = useState("");
  const download = () => {
    try {
      downloadDebugReport(steps);
      setStatus("Debug report downloaded.");
    } catch {
      setStatus("Could not download the report. Please try again.");
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-[14px] font-semibold text-text">Debug logs</h3>
      <Text size="sm" tone="muted">
        Errors and warnings stay on this device for this session. The newest 200 entries are kept,
        up to 256 KiB. Reloading or closing the app clears them.
      </Text>
      <Text size="sm">{entries.length} entries recorded</Text>
      <DebugLogEntries entries={entries} />
      <label className="flex flex-col gap-2 text-sm text-text">
        Steps to reproduce
        <textarea
          value={steps}
          onChange={(event) => {
            setSteps(event.target.value);
          }}
          maxLength={8000}
          rows={4}
          placeholder="What did you do, what happened, and what did you expect?"
          className="rounded-input border border-border bg-surface-3 px-3 py-2 text-text focus-visible:outline focus-visible:outline-accent"
        />
      </label>
      <Text size="sm" tone="muted">
        Reports include error messages and stacks. Common secrets are scrubbed, but review the
        downloaded file for private information before sharing it.
      </Text>
      <div className="flex flex-wrap gap-2">
        <Button onClick={download}>Download debug report</Button>
        <Button
          variant="ghost"
          disabled={entries.length === 0}
          onClick={() => {
            debugLog.clear();
            setStatus("Debug logs cleared.");
          }}
        >
          Clear logs
        </Button>
      </div>
      <Text size="sm" role="status">
        {status}
      </Text>
    </div>
  );
}

export function DebugLogEntries({ entries }: { readonly entries: readonly DebugLogEntry[] }) {
  if (entries.length === 0) {
    return (
      <Text size="sm" tone="muted">
        No errors or warnings have been recorded yet.
      </Text>
    );
  }
  // Newest first: the entry that just appeared is the one people look for.
  const visible = entries.slice(-DISPLAY_LIMIT).reverse();
  const hidden = entries.length - visible.length;
  return (
    <div className="flex flex-col gap-2">
      <Text size="sm" tone="muted">
        {hidden > 0
          ? `Showing the newest ${visible.length} of ${entries.length} entries.`
          : "Newest first."}
      </Text>
      <ul
        aria-label="Recorded errors and warnings"
        className="flex max-h-80 flex-col gap-2 overflow-y-auto rounded-input border border-border bg-surface-3 p-3"
      >
        {visible.map((entry, index) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: entries are append-only but can share a timestamp
            key={`${entry.timestamp}-${index}`}
            className="flex flex-col gap-1 border-b border-border pb-2 last:border-b-0 last:pb-0"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="break-all font-mono text-[12px] font-medium text-text">
                {entry.source}
              </span>
              <span className="shrink-0 text-[12px] text-text-muted">
                {formatEntryTime(entry.timestamp)}
              </span>
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-text-muted">
              {entry.detail}
            </pre>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatEntryTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleTimeString();
}

function downloadDebugReport(steps: string): void {
  const url = URL.createObjectURL(
    new Blob([debugLog.report(`web/desktop ${CLIENT_VERSION}`, steps)], {
      type: "application/json",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "aulora-debug-log.json";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}
