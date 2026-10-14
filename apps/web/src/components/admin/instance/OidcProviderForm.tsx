/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, Input, Text } from "@aulora/ui-web";
import { useState } from "react";
import {
  buildOidcEntries,
  discoveryUrlError,
  type EnvVariable,
  type OidcFormValues,
  oidcFormFromVariables,
} from "../../../lib/instance-env";

/**
 * Sets the whole OIDC_* group at once so a custom identity provider can be
 * added from the UI. The discovery URL shape is checked here; Convex repeats
 * the server-side validation on save. Two steps: edit, then confirm.
 */
export interface OidcProviderFormProps {
  readonly variables: readonly EnvVariable[];
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onSave: (entries: { key: string; value: string }[]) => Promise<unknown>;
}

function validateOidcValues(values: OidcFormValues, hasSavedSecret: boolean): string | null {
  if (values.issuer.trim().length === 0) {
    return "Enter the issuer URL";
  }
  const urlError = discoveryUrlError(values.discoveryUrl);
  if (urlError !== null) {
    return urlError;
  }
  if (values.clientId.trim().length === 0) {
    return "Enter the client id";
  }
  if (!hasSavedSecret && values.clientSecret.length === 0) {
    return "Enter the client secret";
  }
  return null;
}

export function OidcProviderForm(props: OidcProviderFormProps) {
  const { variables, busy, onCancel, onSave } = props;
  const [values, setValues] = useState<OidcFormValues>(() => oidcFormFromVariables(variables));
  const [step, setStep] = useState<"edit" | "confirm">("edit");
  const [error, setError] = useState<string | null>(null);
  const hasSavedSecret = variables.some(
    (variable) => variable.key === "OIDC_CLIENT_SECRET" && variable.source === "ui",
  );
  const update = (patch: Partial<OidcFormValues>) => {
    setValues((current) => ({ ...current, ...patch }));
  };

  return (
    <form
      className="flex flex-col gap-3 rounded-input border border-border bg-surface-1 p-3"
      data-testid="oidc-provider-form"
      onSubmit={(event) => {
        event.preventDefault();
        submitOidcForm({ step, values, hasSavedSecret, setError, setStep, onSave });
      }}
    >
      <OidcFormIntro />
      {step === "edit" ? (
        <>
          <OidcCoreFields values={values} hasSavedSecret={hasSavedSecret} onChange={update} />
          <OidcAdvancedFields values={values} onChange={update} />
        </>
      ) : (
        <OidcConfirmStep values={values} />
      )}
      {error !== null && (
        <Text tone="danger" size="xs" role="alert">
          {error}
        </Text>
      )}
      <OidcFormActions
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

function submitOidcForm(input: {
  readonly step: "edit" | "confirm";
  readonly values: OidcFormValues;
  readonly hasSavedSecret: boolean;
  readonly setError: (error: string | null) => void;
  readonly setStep: (step: "edit" | "confirm") => void;
  readonly onSave: (entries: { key: string; value: string }[]) => Promise<unknown>;
}): void {
  if (input.step === "confirm") {
    void input.onSave(buildOidcEntries(input.values));
    return;
  }
  const problem = validateOidcValues(input.values, input.hasSavedSecret);
  if (problem !== null) {
    input.setError(problem);
    return;
  }
  input.setError(null);
  input.setStep("confirm");
}

function OidcFormIntro() {
  return (
    <>
      <Text size="sm">Add a custom OIDC provider</Text>
      <Text size="xs" tone="muted">
        Saves OIDC_ISSUER, OIDC_DISCOVERY_URL, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET together (plus
        any optional fields). The client secret is write-only.
      </Text>
    </>
  );
}

function OidcConfirmStep({ values }: { readonly values: OidcFormValues }) {
  const entries = buildOidcEntries(values);
  return (
    <div className="flex flex-col gap-1">
      <Text size="sm">Save {entries.length} OIDC variable(s) for everyone on this instance?</Text>
      <Text size="xs" tone="muted">
        {entries.map((entry) => entry.key).join(", ")}
      </Text>
      <Text size="xs" tone="muted">
        The deployment&apos;s OIDC configuration stops being used; its values cannot be shown again
        from here.
      </Text>
    </div>
  );
}

function OidcFormActions({
  step,
  busy,
  onBack,
  onCancel,
}: {
  readonly step: "edit" | "confirm";
  readonly busy: boolean;
  readonly onBack: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {step === "edit" ? (
        <Button type="submit" size="sm" disabled={busy} data-testid="oidc-review">
          Review
        </Button>
      ) : (
        <Button
          type="submit"
          size="sm"
          variant="danger"
          loading={busy}
          disabled={busy}
          data-testid="oidc-save"
        >
          Save OIDC provider
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

function OidcField(props: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly type?: "text" | "password" | "number";
  readonly placeholder?: string;
  readonly autoComplete?: string;
  readonly onValue: (value: string) => void;
}) {
  return (
    <Input
      label={props.label}
      value={props.value}
      {...(props.hint !== undefined ? { hint: props.hint } : {})}
      {...(props.type !== undefined ? { type: props.type } : {})}
      {...(props.placeholder !== undefined ? { placeholder: props.placeholder } : {})}
      {...(props.autoComplete !== undefined ? { autoComplete: props.autoComplete } : {})}
      onChange={(event) => {
        props.onValue(event.currentTarget.value);
      }}
      spellCheck={false}
    />
  );
}

function OidcCoreFields({
  values,
  hasSavedSecret,
  onChange,
}: {
  readonly values: OidcFormValues;
  readonly hasSavedSecret: boolean;
  readonly onChange: (patch: Partial<OidcFormValues>) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <OidcField
        label="Display name"
        hint="Shown on the SSO button; defaults to SSO."
        value={values.displayName}
        onValue={(value) => {
          onChange({ displayName: value });
        }}
      />
      <OidcField
        label="Issuer"
        hint="Issuer identifier of the identity provider."
        value={values.issuer}
        onValue={(value) => {
          onChange({ issuer: value });
        }}
      />
      <OidcField
        label="Discovery URL"
        hint="Must end with /.well-known/openid-configuration."
        value={values.discoveryUrl}
        onValue={(value) => {
          onChange({ discoveryUrl: value });
        }}
      />
      <OidcCredentialFields values={values} hasSavedSecret={hasSavedSecret} onChange={onChange} />
    </div>
  );
}

function OidcCredentialFields({
  values,
  hasSavedSecret,
  onChange,
}: {
  readonly values: OidcFormValues;
  readonly hasSavedSecret: boolean;
  readonly onChange: (patch: Partial<OidcFormValues>) => void;
}) {
  return (
    <>
      <OidcField
        label="Client id"
        value={values.clientId}
        onValue={(value) => {
          onChange({ clientId: value });
        }}
      />
      <OidcField
        label="Client secret"
        type="password"
        placeholder={
          hasSavedSecret ? "Set — enter a new value to replace" : "Enter the client secret"
        }
        autoComplete="new-password"
        value={values.clientSecret}
        onValue={(value) => {
          onChange({ clientSecret: value });
        }}
      />
    </>
  );
}

function OidcAdvancedFields({
  values,
  onChange,
}: {
  readonly values: OidcFormValues;
  readonly onChange: (patch: Partial<OidcFormValues>) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <OidcField
        label="Scopes"
        hint="Space or comma separated."
        value={values.scopes}
        onValue={(value) => {
          onChange({ scopes: value });
        }}
      />
      <OidcField
        label="Group claim"
        hint="Claim carrying IdP groups, e.g. groups."
        value={values.groupClaim}
        onValue={(value) => {
          onChange({ groupClaim: value });
        }}
      />
      <OidcField
        label="Group role map"
        hint='Optional JSON, e.g. {"admins":"Admin"}.'
        value={values.groupRoleMap}
        onValue={(value) => {
          onChange({ groupRoleMap: value });
        }}
      />
    </div>
  );
}
