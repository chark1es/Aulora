import { type DebugLogEntry, debugLog } from "@aulora/core";
import { Button, Text, TextField } from "@aulora/ui-native";
import * as Clipboard from "expo-clipboard";
import { type Dispatch, type SetStateAction, useState, useSyncExternalStore } from "react";
import { ScrollView, View } from "react-native";
import { MOBILE_CLIENT_VERSION } from "../../lib/client-version";

/** A long session can hold hundreds of entries; the report keeps all of them. */
const DISPLAY_LIMIT = 50;

export function DebugLogsSection() {
  const entries = useSyncExternalStore(debugLog.subscribe, debugLog.snapshot);
  const [steps, setSteps] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const copy = async () => {
    setBusy(true);
    try {
      await Clipboard.setStringAsync(debugLog.report(`mobile ${MOBILE_CLIENT_VERSION}`, steps));
      setStatus("Debug report copied. Review it before sharing.");
    } catch {
      setStatus("Could not copy the report. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView
      contentContainerStyle={{ gap: 16, paddingBottom: 24 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text size="sm" tone="muted">
        Errors and warnings stay on this device for this session. The newest 200 entries are kept,
        up to 256 KiB. Restarting the app clears them.
      </Text>
      <Text size="sm">{entries.length} entries recorded</Text>
      <DebugLogEntries entries={entries} />
      <ReproductionSteps steps={steps} setSteps={setSteps} />
      <Text size="sm" tone="muted">
        Reports include error messages and stacks. Common secrets are scrubbed, but review the
        copied text for private information before sharing it.
      </Text>
      <Button disabled={busy} onPress={() => void copy()}>
        Copy debug report
      </Button>
      <Button
        variant="ghost"
        disabled={entries.length === 0}
        onPress={() => {
          debugLog.clear();
          setStatus("Debug logs cleared.");
        }}
      >
        Clear logs
      </Button>
      <Text size="sm" accessibilityLiveRegion="polite">
        {status}
      </Text>
    </ScrollView>
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
    <View className="gap-2">
      <Text size="sm" tone="muted">
        {hidden > 0
          ? `Showing the newest ${visible.length} of ${entries.length} entries.`
          : "Newest first."}
      </Text>
      <View
        accessibilityLabel="Recorded errors and warnings"
        className="gap-2 rounded-input border border-border bg-surface-3 p-3"
      >
        {visible.map((entry, index) => (
          <View
            // biome-ignore lint/suspicious/noArrayIndexKey: entries are append-only but can share a timestamp
            key={`${entry.timestamp}-${index}`}
            className="gap-1 border-b border-border pb-2 last:border-b-0 last:pb-0"
          >
            <View className="flex-row flex-wrap items-baseline justify-between gap-2">
              <Text mono size="sm" className="text-text" selectable>
                {entry.source}
              </Text>
              <Text size="sm" tone="muted" selectable>
                {formatEntryTime(entry.timestamp)}
              </Text>
            </View>
            <Text size="sm" tone="muted" mono selectable numberOfLines={6}>
              {entry.detail}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function formatEntryTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleTimeString();
}

function ReproductionSteps({
  steps,
  setSteps,
}: {
  readonly steps: string;
  readonly setSteps: Dispatch<SetStateAction<string>>;
}) {
  return (
    <View className="gap-2">
      <Text size="sm">Steps to reproduce</Text>
      <TextField
        accessibilityLabel="Steps to reproduce"
        multiline
        value={steps}
        onChangeText={setSteps}
        maxLength={8000}
        placeholder="What happened? What did you expect?"
        className="min-h-24 rounded-input border border-border bg-surface-3 p-3 text-text"
        textAlignVertical="top"
      />
    </View>
  );
}
