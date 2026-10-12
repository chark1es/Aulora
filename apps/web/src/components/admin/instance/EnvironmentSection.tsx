import { Button, Card, Heading, Text } from "@aulora/ui-web";
import { useState } from "react";
import {
  type EnvVariable,
  type EnvVariablesModel,
  useEnvOverrides,
} from "../../../lib/instance-env";
import { EnvVariableRow } from "./EnvVariableRow";
import { OidcProviderForm } from "./OidcProviderForm";

/** Data + actions the Environment view needs; the container wires them up. */
export interface EnvironmentSectionModel {
  readonly data: EnvVariablesModel;
  readonly save: (key: string, value: string) => Promise<unknown>;
  readonly saveMany: (entries: { key: string; value: string }[]) => Promise<unknown>;
  readonly reset: (key: string) => Promise<unknown>;
}

/** Instance-admin Environment section; mounts only for the workspace owner. */
export function EnvironmentSection() {
  const { data, setValue, setGroup, resetValue } = useEnvOverrides();
  if (data === undefined) {
    return (
      <Text tone="muted" size="sm">
        Loading environment variables…
      </Text>
    );
  }
  return (
    <EnvironmentSectionView
      model={{
        data,
        save: (key, value) => setValue({ key, value }),
        saveMany: (entries) => setGroup({ entries }),
        reset: (key) => resetValue({ key }),
      }}
    />
  );
}

export function EnvironmentSectionView({ model }: { readonly model: EnvironmentSectionModel }) {
  const { data } = model;
  return (
    <div className="flex flex-col gap-4" data-testid="instance-environment">
      <Heading level={3}>Environment</Heading>
      <Text tone="muted" size="sm">
        Every environment variable the app reads, and where each value comes from. Deployment values
        are never shown here.
      </Text>
      <Card className="flex flex-col gap-1">
        <Text size="sm" tone="accent">
          Less secure than deploy-time variables
        </Text>
        <Text size="xs" tone="muted">
          Overrides you save here live in the workspace database, encrypted with the server key.
          Anyone with owner access can change them, and a later restore or database copy carries
          them with it. Prefer the deployment environment for credentials that never change.
        </Text>
      </Card>
      {data.locked && (
        <Card className="border-danger" data-testid="env-locked">
          <Text size="sm" tone="danger">
            Environment overrides are disabled by the deployment
            (AULORA_ALLOW_UI_ENV_OVERRIDES=false).
          </Text>
        </Card>
      )}
      {!data.encryptionConfigured && (
        <Card className="border-danger" data-testid="env-encryption-missing">
          <Text size="sm" tone="danger">
            Server-side encryption is not configured, so overrides cannot be stored. Set the
            deployment&apos;s encryption key first.
          </Text>
        </Card>
      )}
      {data.groups.map((group) => (
        <EnvGroup key={group.id} groupId={group.id} label={group.label} model={model} />
      ))}
    </div>
  );
}

function EnvGroup({
  groupId,
  label,
  model,
}: {
  readonly groupId: string;
  readonly label: string;
  readonly model: EnvironmentSectionModel;
}) {
  const variables = model.data.variables.filter((variable) => variable.group === groupId);
  if (variables.length === 0) {
    return null;
  }
  return (
    <section className="flex flex-col gap-2" data-testid={`env-group-${groupId}`}>
      <Text size="sm" className="font-medium" data-testid={`env-group-label-${groupId}`}>
        {label}
      </Text>
      {groupId === "oidc" && <OidcGroupEditor model={model} variables={variables} />}
      <ul className="flex flex-col gap-2">
        {variables.map((variable) => (
          <EnvVariableRow
            key={variable.key}
            variable={variable}
            locked={model.data.locked}
            encryptionReady={model.data.encryptionConfigured}
            onSave={(value) => model.save(variable.key, value)}
            onReset={() => model.reset(variable.key)}
          />
        ))}
      </ul>
    </section>
  );
}

function OidcGroupEditor({
  model,
  variables,
}: {
  readonly model: EnvironmentSectionModel;
  readonly variables: readonly EnvVariable[];
}) {
  const [open, setOpen] = useState(false);
  const ready = !model.data.locked && model.data.encryptionConfigured;

  if (!open) {
    return (
      <AddOidcButton
        disabled={!ready}
        onOpen={() => {
          setOpen(true);
        }}
      />
    );
  }
  return (
    <OpenOidcEditor
      model={model}
      variables={variables}
      onClose={() => {
        setOpen(false);
      }}
    />
  );
}

function OpenOidcEditor({
  model,
  variables,
  onClose,
}: {
  readonly model: EnvironmentSectionModel;
  readonly variables: readonly EnvVariable[];
  readonly onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <OidcProviderForm
        variables={variables}
        busy={busy}
        onCancel={() => {
          setError(null);
          onClose();
        }}
        onSave={async (entries) => {
          setBusy(true);
          setError(null);
          try {
            await model.saveMany(entries);
            onClose();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not save the OIDC provider.");
          } finally {
            setBusy(false);
          }
        }}
      />
      {error !== null && (
        <Text tone="danger" size="xs" role="alert">
          {error}
        </Text>
      )}
    </>
  );
}

function AddOidcButton({
  disabled,
  onOpen,
}: {
  readonly disabled: boolean;
  readonly onOpen: () => void;
}) {
  return (
    <div>
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled}
        onClick={onOpen}
        data-testid="env-add-oidc"
      >
        Add custom OIDC provider
      </Button>
    </div>
  );
}
