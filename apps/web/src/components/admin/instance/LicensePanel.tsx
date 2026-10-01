import { Button, Heading, Input, Text } from "@aulora/ui-web";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import { LicenseStatusCard } from "./LicenseStatusCard";

export interface LicensePanelProps {
  readonly canManage: boolean;
}

/**
 * Reports server-verified subscription status and lets the instance owner manage a key.
 */
export function LicensePanel({ canManage }: LicensePanelProps) {
  const status = useQuery(api.license.status, canManage ? {} : "skip");
  const usage = useQuery(api.licenseUsage.summary, canManage ? {} : "skip");
  const saveLicenseKey = useMutation(api.license.setKey);
  const verifyLicense = useAction(api.licenseActions.validate);

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

      {(status.billingModel === "monthly-active-users" || !!usage?.length) && (
        <section className="flex flex-col gap-2" aria-label="Monthly licensed activity">
          <Heading level={3}>Monthly active users</Heading>
          <Text size="sm" tone="muted">
            A member counts once per UTC month after logging in, being present, or sending a
            message. Reports contain aggregate counts, not member identities or messages.
          </Text>
          {(usage ?? []).map((month) => (
            <Text size="sm" key={month._id}>
              {month.month}: {month.activeUsers} active users.{" "}
              {month.finalReported
                ? "Final report delivered."
                : month.reportedAt
                  ? "Provisional report delivered; final report follows month-end."
                  : "Awaiting report delivery."}
            </Text>
          ))}
          {!usage?.length && (
            <Text size="sm" tone="muted">
              Counting starts after this license activates.
            </Text>
          )}
        </section>
      )}

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(key.trim().length > 0 ? key.trim() : null);
        }}
      >
        <Heading level={3}>Set a license key</Heading>
        <Text tone="muted" size="sm">
          Personal and noncommercial use is free. A company running Aulora for work needs a monthly
          subscription at $1 per active user. Inactive users cost $0; only partial license months
          are prorated.
        </Text>
        <Input
          label="License key"
          hint="AULORA2_… Your server sends the key to Aulora’s licensing server over HTTPS for validation."
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
            License saved. Server validation runs automatically.
          </Text>
        )}
        <div className="flex gap-2">
          <Button type="submit" loading={busy} disabled={busy}>
            Save license
          </Button>
          <Button
            variant="secondary"
            disabled={busy || status.maskedKey === null}
            onClick={() => {
              setBusy(true);
              setError(null);
              void verifyLicense({})
                .then((result) => {
                  if (!result.verified)
                    setError(
                      result.error ??
                        "The licensing server rejected this key. Check the license status.",
                    );
                })
                .catch((cause) =>
                  setError(cause instanceof Error ? cause.message : "Could not verify license."),
                )
                .finally(() => setBusy(false));
            }}
          >
            Verify now
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
