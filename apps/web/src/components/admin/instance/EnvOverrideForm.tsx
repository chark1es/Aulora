/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, Input, Text } from "@aulora/ui-web";
import { useState } from "react";
import type { EnvVariable } from "../../../lib/instance-env";

/**
 * Two-step editor for a single environment override: edit the value, then
 * confirm. Secrets are write-only, so the field starts empty even when a value
 * is already saved; non-secret UI values are prefilled for editing.
 */
export interface EnvOverrideFormProps {
  readonly variable: EnvVariable;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onSave: (value: string) => Promise<unknown>;
}

export function EnvOverrideForm(props: EnvOverrideFormProps) {
  const { variable, busy, onCancel, onSave } = props;
  const [value, setValue] = useState(variable.secret ? "" : (variable.value ?? ""));
  const [step, setStep] = useState<"edit" | "confirm">("edit");
  const [error, setError] = useState<string | null>(null);

  function submit(): void {
    if (step === "confirm") {
      void onSave(value);
      return;
    }
    if (value.trim().length === 0) {
      setError("Enter a value");
      return;
    }
    setError(null);
    setStep("confirm");
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-input border border-border bg-surface-1 p-3"
      data-testid={`env-form-${variable.key}`}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {step === "edit" ? (
        <EnvValueField variable={variable} value={value} onChange={setValue} />
      ) : (
        <ConfirmStep variable={variable} />
      )}
      {error !== null && (
        <Text tone="danger" size="xs" role="alert">
          {error}
        </Text>
      )}
      <FormActions
        variable={variable}
        step={step}
        busy={busy}
        onBack={() => {
          setStep("edit");
        }}
        onCancel={onCancel}
      />
    </form>
  );
}

function ConfirmStep({ variable }: { readonly variable: EnvVariable }) {
  return (
    <div className="flex flex-col gap-1">
      <Text size="sm">
        Override <span className="font-mono">{variable.key}</span> for everyone on this instance?
      </Text>
      <Text size="xs" tone="muted">
        The deployment value stops being used and cannot be shown again from here. Values saved here
        live in the workspace database, encrypted with the server key — less secure than an
        environment variable.
      </Text>
    </div>
  );
}

function FormActions({
  variable,
  step,
  busy,
  onBack,
  onCancel,
}: {
  readonly variable: EnvVariable;
  readonly step: "edit" | "confirm";
  readonly busy: boolean;
  readonly onBack: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {step === "confirm" ? (
        <Button
          type="submit"
          size="sm"
          variant="danger"
          loading={busy}
          disabled={busy}
          data-testid={`env-confirm-${variable.key}`}
        >
          Save override
        </Button>
      ) : (
        <Button type="submit" size="sm" disabled={busy} data-testid={`env-review-${variable.key}`}>
          Review
        </Button>
      )}
      {step === "confirm" && (
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onBack}>
          Back
        </Button>
      )}
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

function EnvValueField({
  variable,
  value,
  onChange,
}: {
  readonly variable: EnvVariable;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  if (variable.type === "boolean" || variable.type === "enum") {
    return <ChoiceField variable={variable} value={value} onChange={onChange} />;
  }
  return (
    <Input
      label={variable.label}
      type={variable.type === "number" ? "number" : variable.secret ? "password" : "text"}
      value={value}
      placeholder={variable.secret ? "Set — enter a new value to replace" : undefined}
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
      autoComplete="off"
      spellCheck={false}
    />
  );
}

function ChoiceField({
  variable,
  value,
  onChange,
}: {
  readonly variable: EnvVariable;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const options =
    variable.type === "boolean"
      ? [
          { value: "true", label: "Enabled" },
          { value: "false", label: "Disabled" },
        ]
      : (variable.enumValues ?? []).map((option) => ({ value: option, label: option }));
  return (
    <label className="flex flex-col gap-1.5 text-[13px] font-medium text-text">
      {variable.label}
      <select
        className="h-10 rounded-[8px] border border-border bg-surface-2 px-3 text-text"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        <option value="">Choose…</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
