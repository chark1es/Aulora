import { Button, Card, ConfirmDialog, Heading, Input, Text } from "@aulora/ui-web";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import { SettingsSection } from "../SettingsSection";
import { LicenseStatusCard } from "./LicenseStatusCard";

type LicenseUsageRow = NonNullable<FunctionReturnType<typeof api.licenseUsage.summary>>[number];

export interface LicensePanelProps {
  readonly canManage: boolean;
}

/**
 * Reports server-verified subscription status and lets the instance owner manage
 * a key: save/verify in one form, and a destructive clear isolated in its own
 * danger zone behind a confirmation.
 */
export function LicensePanel({ canManage }: LicensePanelProps) {
  const status = useQuery(api.license.status, canManage ? {} : "skip");
  const usage = useQuery(api.licenseUsage.summary, canManage ? {} : "skip");

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

  return (
    <div className="flex flex-col gap-5" data-testid="license-panel">
      <SettingsSection
        title="License"
        description="Personal and noncommercial use is free. A company running Aulora for work needs a monthly subscription at $1 per active user."
      />
      <LicenseStatusCard
        state={status.state}
        tier={status.tier}
        licensee={status.licensee}
        maskedKey={status.maskedKey}
        note={status.note}
      />
      <LicenseUsageSection
        show={status.billingModel === "monthly-active-users" || !!usage?.length}
        usage={usage ?? []}
      />
      <LicenseKeyForm hasKey={status.maskedKey !== null} />
      <LicenseDangerZone hasKey={status.maskedKey !== null} />
    </div>
  );
}

function LicenseUsageSection({
  show,
  usage,
}: {
  readonly show: boolean;
  readonly usage: readonly LicenseUsageRow[];
}) {
  if (!show) {
    return null;
  }
  return (
    <section className="flex flex-col gap-2" aria-label="Monthly licensed activity">
      <Heading level={3}>Monthly active users</Heading>
      <Text size="sm" tone="muted">
        A member counts once per UTC month after logging in, being present, or sending a message.
        Reports contain aggregate counts, not member identities or messages.
      </Text>
      {usage.map((month) => (
        <Text size="sm" key={month._id}>
          {month.month}: {month.activeUsers} active users.{" "}
          {month.finalReported
            ? "Final report delivered."
            : month.reportedAt
              ? "Provisional report delivered; final report follows month-end."
              : "Awaiting report delivery."}
        </Text>
      ))}
      {usage.length === 0 && (
        <Text size="sm" tone="muted">
          Counting starts after this license activates.
        </Text>
      )}
    </section>
  );
}

function LicenseKeyForm({ hasKey }: { readonly hasKey: boolean }) {
  const saveLicenseKey = useMutation(api.license.setKey);
  const verifyLicense = useAction(api.licenseActions.validate);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  function submit(next: string): void {
    setError(null);
    setSaved(false);
    setBusy(true);
    void saveLicenseKey({ key: next })
      .then(() => {
        setKey("");
        setSaved(true);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not save the license key.");
      })
      .finally(() => {
        setBusy(false);
      });
  }

  function verify(): void {
    setBusy(true);
    setError(null);
    void verifyLicense({})
      .then((result) => {
        if (!result.verified) {
          setError(
            result.error ?? "The licensing server rejected this key. Check the license status.",
          );
        }
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not verify license.");
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit(key.trim());
      }}
    >
      <div className="flex flex-col gap-0.5">
        <Text size="sm" className="font-medium">
          Set a license key
        </Text>
        <Text size="xs" tone="muted">
          Your server sends the key to Aulora’s licensing server over HTTPS for validation.
        </Text>
      </div>
      <Input
        label="License key"
        hint="Starts with AULORA2_."
        value={key}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          setKey(event.currentTarget.value);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={busy} disabled={busy || key.trim().length === 0}>
          Save license
        </Button>
        <Button
          variant="secondary"
          type="button"
          disabled={busy || !hasKey}
          onClick={() => {
            verify();
          }}
        >
          Verify now
        </Button>
        {saved && (
          <Text tone="secondary" size="sm" role="status">
            License saved. Server validation runs automatically.
          </Text>
        )}
        {error !== null && (
          <Text tone="danger" size="sm" role="alert">
            {error}
          </Text>
        )}
      </div>
    </form>
  );
}

function LicenseDangerZone({ hasKey }: { readonly hasKey: boolean }) {
  const saveLicenseKey = useMutation(api.license.setKey);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function clear(): void {
    setBusy(true);
    setError(null);
    void saveLicenseKey({ key: null })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not clear the license key.");
      })
      .finally(() => {
        setBusy(false);
        setConfirming(false);
      });
  }

  return (
    <Card className="flex flex-col gap-2 border-danger/40" data-testid="license-danger-zone">
      <Text size="sm" tone="danger" className="font-medium">
        Danger zone
      </Text>
      <Text size="xs" tone="muted">
        Clearing the license key removes server-side validation and stops usage reporting.
      </Text>
      <div>
        <Button
          variant="danger"
          disabled={busy || !hasKey}
          onClick={() => {
            setConfirming(true);
          }}
        >
          Clear license key
        </Button>
      </div>
      {error !== null && (
        <Text tone="danger" size="xs" role="alert">
          {error}
        </Text>
      )}
      <ConfirmDialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
        }}
        title="Clear license key"
        description="Remove the saved license key from this instance?"
        confirmLabel="Clear license key"
        variant="danger"
        onConfirm={clear}
      />
    </Card>
  );
}
