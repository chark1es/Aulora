/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, Text } from "@aulora/ui-web";
import { useState } from "react";
import { type EnvVariable, envFieldMeta, envValueError } from "../../../lib/instance-env";
import { EnvValueEditor } from "./EnvValueEditor";

export interface EnvOverrideFormProps {
  readonly variable: EnvVariable;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onSave: (value: string) => Promise<unknown>;
}

/**
 * Inline editor for one override. The control matches the variable's type, the
 * description and bounds sit above it, and a single footer puts Cancel (ghost)
 * left of the primary Save. Escape cancels; the control reports its own
 * validation error as the value changes.
 */
export function EnvOverrideForm(props: EnvOverrideFormProps) {
  const { variable, busy, onCancel, onSave } = props;
  const keepBlank = variable.secret && variable.source === "ui";
  const [value, setValue] = useState(variable.secret ? "" : (variable.value ?? ""));
  const [error, setError] = useState<string | null>(null);

  function submit(): void {
    if (value.trim().length === 0 && !keepBlank) {
      setError("Enter a value");
      return;
    }
    // An already-saved secret left blank means "keep the current value", so close
    // without a mutation rather than sending an empty value the server rejects.
    if (keepBlank && value.trim().length === 0) {
      onCancel();
      return;
    }
    setError(null);
    if (envValueError(variable, value) !== null) {
      return;
    }
    void onSave(value.trim());
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-input border border-border bg-surface-1 p-3"
      data-testid={`env-form-${variable.key}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <EnvOverrideHelper variable={variable} />
      <EnvValueEditor
        variable={variable}
        value={value}
        onChange={(next) => {
          setValue(next);
          setError(null);
        }}
      />
      {error !== null && (
        <Text tone="danger" size="xs" role="alert">
          {error}
        </Text>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          loading={busy}
          disabled={busy}
          data-testid={`env-save-${variable.key}`}
        >
          Save override
        </Button>
      </div>
    </form>
  );
}

function EnvOverrideHelper({ variable }: { readonly variable: EnvVariable }) {
  const meta = envFieldMeta(variable);
  return (
    <div className="flex flex-col gap-0.5">
      <Text size="xs" tone="muted">
        {variable.description}
      </Text>
      {meta.defaultValue !== null && (
        <Text size="xs" tone="muted">
          Default: <span className="font-mono">{meta.defaultValue}</span>
        </Text>
      )}
      <Text size="xs" tone="muted">
        Saved in the workspace database, encrypted with the server key — less secure than a
        deploy-time variable.
      </Text>
    </div>
  );
}
