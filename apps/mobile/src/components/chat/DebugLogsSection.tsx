import { debugLog, generateDebugTestError } from "@aulora/core";
import { Button, Text } from "@aulora/ui-native";
import * as Clipboard from "expo-clipboard";
import { type Dispatch, type SetStateAction, useState, useSyncExternalStore } from "react";
import { ScrollView, TextInput, View } from "react-native";
import { MOBILE_CLIENT_VERSION } from "../../lib/client-version";

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
      <ReproductionSteps steps={steps} setSteps={setSteps} />
      <Text size="sm" tone="muted">
        Reports include error messages and stacks. Common secrets are scrubbed, but review the
        copied text for private information before sharing it.
      </Text>
      <Button disabled={busy} onPress={() => void copy()}>
        Copy debug report
      </Button>
      <Button
        variant="secondary"
        onPress={() => {
          generateDebugTestError();
          setStatus("Test error recorded. Copy a report to check it.");
        }}
      >
        Generate test error
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
      <TextInput
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
