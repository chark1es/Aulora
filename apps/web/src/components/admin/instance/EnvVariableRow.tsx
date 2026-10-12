import { Button, Text } from "@aulora/ui-web";
import { useState } from "react";
import {
  type EnvVariable,
  envManagedReason,
  envSourceLabel,
  envSourceTone,
  envValueLabel,
} from "../../../lib/instance-env";
import { EnvOverrideForm } from "./EnvOverrideForm";

export interface EnvVariableRowProps {
  readonly variable: EnvVariable;
  readonly locked: boolean;
  readonly encryptionReady: boolean;
  readonly onSave: (value: string) => Promise<unknown>;
  readonly onReset: () => Promise<unknown>;
}

/** Busy/error/status bookkeeping shared by a row's save and reset actions. */
function useOverrideTask() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  async function run(task: () => Promise<unknown>, done: string): Promise<void> {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await task();
      setStatus(done);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }
  function clear(): void {
    setError(null);
    setStatus(null);
  }
  return { busy, error, status, run, clear };
}

/** One catalog row: provenance badges, the read-only explanation, and actions. */
export function EnvVariableRow(props: EnvVariableRowProps) {
  const { variable, locked, encryptionReady, onSave, onReset } = props;
  const [editing, setEditing] = useState(false);
  const { busy, error, status, run, clear } = useOverrideTask();
  const editable = variable.overridable && !locked && encryptionReady;

  return (
    <li
      className="flex flex-col gap-2 rounded-input border border-border bg-surface-2 px-3 py-2"
      data-testid={`env-var-${variable.key}`}
    >
      <EnvRowDetails variable={variable} status={status} error={error} />
      {variable.overridable && !editing && (
        <EnvRowActions
          variable={variable}
          editable={editable}
          locked={locked}
          busy={busy}
          onOverride={() => {
            clear();
            setEditing(true);
          }}
          onReset={() => {
            void run(onReset, "Reset to the environment value.");
          }}
        />
      )}
      {editing && (
        <EnvOverrideForm
          variable={variable}
          busy={busy}
          onCancel={() => {
            setEditing(false);
          }}
          onSave={(value) =>
            run(async () => {
              await onSave(value);
              setEditing(false);
            }, "Override saved.")
          }
        />
      )}
    </li>
  );
}

function EnvRowDetails({
  variable,
  status,
  error,
}: {
  readonly variable: EnvVariable;
  readonly status: string | null;
  readonly error: string | null;
}) {
  const managedReason = envManagedReason(variable);
  return (
    <>
      <EnvRowHeader variable={variable} />
      <Text size="xs" tone="muted">
        {variable.description}
      </Text>
      <Text size="xs" tone="muted" data-testid={`env-value-${variable.key}`}>
        {envValueLabel(variable)}
      </Text>
      {managedReason !== null && (
        <Text size="xs" tone="muted">
          {managedReason}
        </Text>
      )}
      {status !== null && (
        <Text tone="secondary" size="xs" role="status">
          {status}
        </Text>
      )}
      {error !== null && (
        <Text tone="danger" size="xs" role="alert">
          {error}
        </Text>
      )}
    </>
  );
}

function EnvRowHeader({ variable }: { readonly variable: EnvVariable }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-col">
        <Text size="sm">{variable.label}</Text>
        <Text size="xs" tone="muted" mono>
          {variable.key}
        </Text>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Text
          size="xs"
          tone={envSourceTone(variable.source)}
          data-testid={`env-source-${variable.key}`}
        >
          {envSourceLabel(variable.source)}
        </Text>
        {variable.secret && (
          <Text size="xs" tone="muted">
            Secret
          </Text>
        )}
      </div>
    </div>
  );
}

function EnvRowActions({
  variable,
  editable,
  locked,
  busy,
  onOverride,
  onReset,
}: {
  readonly variable: EnvVariable;
  readonly editable: boolean;
  readonly locked: boolean;
  readonly busy: boolean;
  readonly onOverride: () => void;
  readonly onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={!editable || busy}
        title={
          editable
            ? undefined
            : locked
              ? "Overrides are disabled by the deployment"
              : "Server-side encryption is not configured"
        }
        onClick={onOverride}
      >
        {variable.source === "ui" ? "Replace" : "Override"}
      </Button>
      {variable.source === "ui" && (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || locked}
          onClick={onReset}
          data-testid={`env-reset-${variable.key}`}
        >
          Reset to environment
        </Button>
      )}
    </div>
  );
}
