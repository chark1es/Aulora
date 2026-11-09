import { debugLog, generateDebugTestError } from "@aulora/core";
import { Button, Text } from "@aulora/ui-web";
import { useState, useSyncExternalStore } from "react";
import { CLIENT_VERSION } from "../../lib/client-version";

export function DebugLogsSection() {
  const entries = useSyncExternalStore(debugLog.subscribe, debugLog.snapshot);
  const [steps, setSteps] = useState("");
  const [status, setStatus] = useState("");
  const download = () => {
    try {
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
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
      <label className="flex flex-col gap-2 text-sm text-text">
        Steps to reproduce
        <textarea
          value={steps}
          onChange={(event) => setSteps(event.target.value)}
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
          variant="secondary"
          onClick={() => {
            generateDebugTestError();
            setStatus("Test error recorded. Download a report to check it.");
          }}
        >
          Generate test error
        </Button>
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
