/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, ConfirmDialog, Icon, IconButton, Text } from "@aulora/ui-web";
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

/**
 * One catalog row: a compact block with the label, key chip and source badge,
 * a one-line description, the current value and a single fixed trailing action
 * area, so buttons never wander between rows.
 */
export function EnvVariableRow(props: EnvVariableRowProps) {
  const { variable, locked, encryptionReady, onSave, onReset } = props;
  const [editing, setEditing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const { busy, error, status, run, clear } = useOverrideTask();
  const editable = variable.overridable && !locked && encryptionReady;

  return (
    <li className="border-b border-border last:border-b-0" data-testid={`env-var-${variable.key}`}>
      <div className="flex items-start gap-3 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <EnvRowHeader variable={variable} />
          <EnvDescription variable={variable} />
          <Text size="xs" tone="muted" className="mt-1" data-testid={`env-value-${variable.key}`}>
            {envValueLabel(variable)}
          </Text>
          <EnvRowManagedNote variable={variable} />
          {status !== null && (
            <Text tone="secondary" size="xs" className="mt-1" role="status">
              {status}
            </Text>
          )}
          {error !== null && (
            <Text tone="danger" size="xs" className="mt-1" role="alert">
              {error}
            </Text>
          )}
        </div>
        <EnvRowActions
          variable={variable}
          editable={editable}
          locked={locked}
          busy={busy}
          expanded={editing}
          onOverride={() => {
            clear();
            setEditing(true);
          }}
          onReset={() => {
            setConfirmReset(true);
          }}
        />
      </div>
      {editing && (
        <div className="px-3 pb-3">
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
        </div>
      )}
      <ConfirmDialog
        open={confirmReset}
        onClose={() => {
          setConfirmReset(false);
        }}
        title="Reset environment override"
        description={`Remove the override for ${variable.key}? The deployment value becomes effective again.`}
        confirmLabel="Reset to environment"
        variant="danger"
        onConfirm={() => {
          setConfirmReset(false);
          void run(onReset, "Reset to the environment value.");
        }}
      />
    </li>
  );
}

function EnvRowHeader({ variable }: { readonly variable: EnvVariable }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <Text size="sm" className="truncate">
        {variable.label}
      </Text>
      <code className="rounded-[5px] border border-border bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-text-muted">
        {variable.key}
      </code>
      <Text
        size="xs"
        tone={envSourceTone(variable.source)}
        data-testid={`env-source-${variable.key}`}
        className="rounded-pill border border-border px-1.5 py-0.5"
      >
        {envSourceLabel(variable.source)}
      </Text>
      {variable.secret && (
        <Text size="xs" tone="muted" className="rounded-pill border border-border px-1.5 py-0.5">
          Secret
        </Text>
      )}
    </div>
  );
}

function EnvDescription({ variable }: { readonly variable: EnvVariable }) {
  const [expanded, setExpanded] = useState(false);
  if (variable.description.length <= 90) {
    return (
      <Text size="xs" tone="muted" className="mt-0.5">
        {variable.description}
      </Text>
    );
  }
  return (
    <div className="mt-0.5">
      <Text size="xs" tone="muted" className={expanded ? undefined : "line-clamp-1"}>
        {variable.description}
      </Text>
      <button
        type="button"
        aria-expanded={expanded}
        className="text-[11px] font-medium text-accent hover:underline"
        onClick={() => {
          setExpanded((current) => !current);
        }}
      >
        {expanded ? "Less" : "More"}
      </button>
    </div>
  );
}

function EnvRowManagedNote({ variable }: { readonly variable: EnvVariable }) {
  const reason = envManagedReason(variable);
  if (reason === null) {
    return null;
  }
  return (
    <Text size="xs" tone="muted" className="mt-0.5">
      {reason}
    </Text>
  );
}

function EnvRowActions({
  variable,
  editable,
  locked,
  busy,
  expanded,
  onOverride,
  onReset,
}: {
  readonly variable: EnvVariable;
  readonly editable: boolean;
  readonly locked: boolean;
  readonly busy: boolean;
  readonly expanded: boolean;
  readonly onOverride: () => void;
  readonly onReset: () => void;
}) {
  if (!variable.overridable) {
    return (
      <div className="flex w-24 shrink-0 items-start justify-end pt-0.5">
        <span
          role="img"
          aria-label="Managed by the deployment"
          title="Managed by the deployment"
          className="flex h-7 w-7 items-center justify-center text-text-muted"
        >
          <Icon name="lock" size={15} />
        </span>
      </div>
    );
  }
  if (variable.source === "ui") {
    return (
      <div className="flex w-24 shrink-0 items-center justify-end gap-0.5">
        <IconButton
          label="Edit"
          title="Edit override"
          size="sm"
          disabled={busy}
          aria-expanded={expanded}
          onClick={onOverride}
        >
          <Icon name="pencil" size={14} />
        </IconButton>
        <IconButton
          label="Reset"
          title="Reset to the deployment value"
          variant="danger"
          size="sm"
          disabled={busy || locked}
          data-testid={`env-reset-${variable.key}`}
          onClick={onReset}
        >
          <Icon name="history" size={14} />
        </IconButton>
      </div>
    );
  }
  return (
    <div className="flex w-24 shrink-0 items-center justify-end">
      <Button
        size="sm"
        variant="secondary"
        disabled={!editable || busy}
        aria-expanded={expanded}
        title={
          editable
            ? undefined
            : locked
              ? "Overrides are disabled by the deployment"
              : "Server-side encryption is not configured"
        }
        onClick={onOverride}
      >
        Override
      </Button>
    </div>
  );
}
