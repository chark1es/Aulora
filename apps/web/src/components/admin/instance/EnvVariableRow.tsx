/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, ConfirmDialog, Icon, IconButton, Text, Tooltip } from "@aulora/ui-web";
import { useState } from "react";
import {
  type EnvVariable,
  envLockReason,
  envSourceLabel,
  envSourceTone,
  envValueLabel,
} from "../../../lib/instance-env";
import { EnvOverrideForm } from "./EnvOverrideForm";
import { EnvRedirectUrl } from "./EnvRedirectUrl";

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
 * One catalog row of the Environment table: the variable (label, key, a
 * one-line description and, for provider client ids, the redirect URL), where
 * its value comes from, the value, and one fixed action cell. The inline
 * editor opens in a second row spanning the table.
 */
export function EnvVariableRow(props: EnvVariableRowProps) {
  const { variable, locked, encryptionReady, onSave, onReset } = props;
  const [editing, setEditing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const { busy, error, status, run, clear } = useOverrideTask();
  const lockReason = envLockReason(variable, { locked, encryptionReady });

  return (
    <>
      <tr
        className="border-b border-border align-top last:border-b-0"
        data-testid={`env-var-${variable.key}`}
      >
        <td className="min-w-0 px-3 py-2">
          <EnvRowHeader variable={variable} />
          <EnvDescription variable={variable} />
          {variable.redirectUrl !== null && (
            <div className="mt-1">
              <EnvRedirectUrl url={variable.redirectUrl} />
            </div>
          )}
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
        </td>
        <td className="px-3 py-2">
          <Text
            size="xs"
            tone={envSourceTone(variable.source)}
            data-testid={`env-source-${variable.key}`}
            className="inline-block whitespace-nowrap rounded-pill border border-border px-1.5 py-0.5"
          >
            {envSourceLabel(variable.source)}
          </Text>
        </td>
        <td className="min-w-0 px-3 py-2">
          <Text
            size="xs"
            tone="muted"
            className="break-words"
            data-testid={`env-value-${variable.key}`}
          >
            {envValueLabel(variable)}
          </Text>
        </td>
        <td className="w-24 px-3 py-1.5">
          <EnvRowActions
            variable={variable}
            lockReason={lockReason}
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
        </td>
      </tr>
      {editing && (
        <tr className="border-b border-border last:border-b-0">
          <td colSpan={4} className="px-3 pb-3">
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
          </td>
        </tr>
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
    </>
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
      {variable.secret && (
        <Text size="xs" tone="muted" className="rounded-pill border border-border px-1.5 py-0.5">
          Secret
        </Text>
      )}
    </div>
  );
}

/** One truncated line; the full text is on hover so the table stays compact. */
function EnvDescription({ variable }: { readonly variable: EnvVariable }) {
  return (
    <Tooltip label={variable.description} className="mt-0.5 flex max-w-full">
      <Text size="xs" tone="muted" className="truncate">
        {variable.description}
      </Text>
    </Tooltip>
  );
}

function EnvRowActions({
  variable,
  lockReason,
  busy,
  expanded,
  onOverride,
  onReset,
}: {
  readonly variable: EnvVariable;
  readonly lockReason: string | null;
  readonly busy: boolean;
  readonly expanded: boolean;
  readonly onOverride: () => void;
  readonly onReset: () => void;
}) {
  if (lockReason !== null) {
    return (
      <div className="flex justify-end">
        <Tooltip label={lockReason}>
          <button
            type="button"
            aria-label={lockReason}
            data-testid={`env-lock-${variable.key}`}
            className="flex h-7 w-7 items-center justify-center rounded-input text-text-muted cursor-help"
          >
            <Icon name="lock" size={15} />
          </button>
        </Tooltip>
      </div>
    );
  }
  if (variable.source === "ui") {
    return (
      <div className="flex items-center justify-end gap-0.5">
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
          disabled={busy}
          data-testid={`env-reset-${variable.key}`}
          onClick={onReset}
        >
          <Icon name="history" size={14} />
        </IconButton>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-end">
      <Button
        size="sm"
        variant="secondary"
        disabled={busy}
        aria-expanded={expanded}
        onClick={onOverride}
      >
        Override
      </Button>
    </div>
  );
}
