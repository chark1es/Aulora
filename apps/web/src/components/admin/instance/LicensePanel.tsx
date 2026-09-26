import { Button, Heading, Input, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import { LicenseStatusCard } from "./LicenseStatusCard";

export interface LicensePanelProps {
  readonly canManage: boolean;
}

/**
 * License status screen. Shows the parsed state, tier and licensee, and lets the
 * operator paste or clear a key. Enforcement is by the license terms; this
 * screen only reports and nags.
 */
export function LicensePanel({ canManage }: LicensePanelProps) {
  const status = useQuery(api.license.status, canManage ? {} : "skip");
  const saveLicenseKey = useMutation(api.license.setKey);

  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status !== undefined) {
      setKey("");
      setError(null);
    }
  }, [status]);

  if (!canManage) {
    return (
      <Text tone="muted" size="sm" data-testid="license-locked">
        Only the instance administrator can manage the license.
      </Text>
    );
  }

  if (status === undefined) {
    return (
      <Text tone="muted" size="sm">
        Loading license…
      </Text>
    );
  }

  async function submit(next: string | null): Promise<void> {
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await saveLicenseKey({ key: next });
      setKey("");
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the license key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="license-panel">
      <LicenseStatusCard
        state={status.state}
        tier={status.tier}
        licensee={status.licensee}
        maskedKey={status.maskedKey}
        note={status.note}
      />

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(key.trim().length > 0 ? key.trim() : null);
        }}
      >
        <Heading level={3}>Set a license key</Heading>
        <Text tone="muted" size="sm">
          Personal and noncommercial use is free. A company running Aulora for work needs a
          commercial license (see COMMERCIAL.md).
        </Text>
        <Input
          label="License key"
          hint="AULORA1.… Paste the full key; it stays on your server."
          value={key}
          onChange={(event) => setKey(event.currentTarget.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {error !== null && (
          <Text tone="danger" size="sm" role="alert">
            {error}
          </Text>
        )}
        {saved && (
          <Text tone="secondary" size="sm" role="status">
            License saved.
          </Text>
        )}
        <div className="flex gap-2">
          <Button type="submit" loading={busy} disabled={busy}>
            Save license
          </Button>
          <Button
            variant="secondary"
            disabled={busy || status.maskedKey === null}
            onClick={() => void submit(null)}
          >
            Clear
          </Button>
        </div>
      </form>
    </div>
  );
}
