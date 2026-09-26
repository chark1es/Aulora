import { Heading, Text } from "@aulora/ui-web";
import {
  type LicenseState,
  licenseStateLabel,
  licenseStateTone,
} from "../../../lib/instance-admin";

export interface LicenseStatusCardProps {
  readonly state: LicenseState;
  readonly tier: "commercial" | "noncommercial" | null;
  readonly licensee: string | null;
  readonly maskedKey: string | null;
  readonly note: string;
}

/** Presentational license status badge, reused by the panel and tests. */
export function LicenseStatusCard({
  state,
  tier,
  licensee,
  maskedKey,
  note,
}: LicenseStatusCardProps) {
  const tone = licenseStateTone(state);
  return (
    <div
      data-testid="license-status"
      className="flex flex-col gap-2 rounded-card border border-border bg-surface-2 p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <Heading level={3}>License</Heading>
        <Text
          size="xs"
          tone={tone}
          mono
          data-testid="license-state"
          className="rounded-pill border border-border px-2 py-0.5 uppercase tracking-wide"
        >
          {licenseStateLabel(state)}
        </Text>
      </div>
      <Text size="sm">{note}</Text>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text-muted">
        <dt>Tier</dt>
        <dd>{tier ?? "—"}</dd>
        <dt>Licensee</dt>
        <dd>{licensee ?? "—"}</dd>
        <dt>Key</dt>
        <dd className="font-mono">{maskedKey ?? "—"}</dd>
      </dl>
    </div>
  );
}
