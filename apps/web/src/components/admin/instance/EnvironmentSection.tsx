/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, Card, cn, Text } from "@aulora/ui-web";
import { type ReactNode, useState } from "react";
import {
  type EnvFilter,
  type EnvGroupBlock,
  type EnvVariable,
  type EnvVariablesModel,
  envGroupSummaries,
  firstEnvGroup,
  selectEnvBlocks,
  useEnvOverrides,
} from "../../../lib/instance-env";
import { SettingsSectionHeader } from "../SettingsSection";
import { EnvGroupNav } from "./EnvGroupNav";
import { EnvToolbar } from "./EnvToolbar";
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

/** The navigation, search and filter state, and the variables they select. */
function useEnvView(data: EnvironmentSectionModel["data"]) {
  const summaries = envGroupSummaries(data.groups, data.variables);
  const [activeGroup, setActiveGroup] = useState(() => firstEnvGroup(summaries));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<EnvFilter>("all");
  const blocks = selectEnvBlocks({
    groups: data.groups,
    variables: data.variables,
    activeGroup,
    query,
    filter,
  });
  const resultCount = blocks.reduce((total, block) => total + block.variables.length, 0);
  const searchActive = query.trim().length > 0 || filter !== "all";
  return {
    summaries,
    activeGroup,
    setActiveGroup,
    query,
    setQuery,
    filter,
    setFilter,
    blocks,
    resultCount,
    searchActive,
  };
}

export function EnvironmentSectionView({ model }: { readonly model: EnvironmentSectionModel }) {
  const { data } = model;
  const view = useEnvView(data);
  const { summaries, activeGroup, query, filter, blocks, searchActive } = view;

  return (
    <div className="flex flex-col gap-4" data-testid="instance-environment">
      <SettingsSectionHeader
        icon="code"
        title="Environment"
        description="Every environment variable the app reads, and where each value comes from. Deployment values are never shown here."
      />
      <EnvSecurityNote />
      <EnvWarnings data={data} />
      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
        <EnvGroupNav
          groups={summaries}
          activeGroup={activeGroup}
          onSelect={(groupId) => {
            view.setActiveGroup(groupId);
            view.setQuery("");
            view.setFilter("all");
          }}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <EnvToolbar
            query={query}
            onQueryChange={view.setQuery}
            filter={filter}
            onFilterChange={view.setFilter}
            resultCount={view.resultCount}
          />
          {blocks.length === 0 ? (
            <Text tone="muted" size="sm" data-testid="env-empty">
              No variables match your filters.
            </Text>
          ) : (
            blocks.map((block) => (
              <EnvGroup key={block.id} block={block} model={model} showOidc={!searchActive} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function EnvWarnings({ data }: { readonly data: EnvironmentSectionModel["data"] }) {
  return (
    <>
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
    </>
  );
}

function EnvSecurityNote() {
  return (
    <Card className="flex flex-col gap-1">
      <Text size="sm" tone="accent">
        Less secure than deploy-time variables
      </Text>
      <Text size="xs" tone="muted">
        Overrides you save here live in the workspace database, encrypted with the server key.
        Anyone with owner access can change them, and a later restore or database copy carries them
        with it. Prefer the deployment environment for credentials that never change.
      </Text>
    </Card>
  );
}

function EnvGroup({
  block,
  model,
  showOidc,
}: {
  readonly block: EnvGroupBlock;
  readonly model: EnvironmentSectionModel;
  readonly showOidc: boolean;
}) {
  return (
    <section className="flex flex-col gap-2" data-testid={`env-group-${block.id}`}>
      <div className="flex items-center justify-between gap-2">
        <Text size="sm" className="font-medium" data-testid={`env-group-label-${block.id}`}>
          {block.label}
        </Text>
        <Text size="xs" tone="muted">
          {block.variables.length === 1 ? "1 variable" : `${block.variables.length} variables`}
        </Text>
      </div>
      {showOidc && block.id === "oidc" && (
        <OidcGroupEditor model={model} variables={block.variables} />
      )}
      <div className="overflow-x-auto rounded-card border border-border bg-surface-2">
        <table className="w-full min-w-[640px] table-fixed text-left">
          <thead>
            <tr className="border-b border-border">
              <EnvHeaderCell className="w-[46%]">Variable</EnvHeaderCell>
              <EnvHeaderCell className="w-28">Source</EnvHeaderCell>
              <EnvHeaderCell>Value</EnvHeaderCell>
              <EnvHeaderCell className="w-24 text-right">
                <span className="sr-only">Actions</span>
              </EnvHeaderCell>
            </tr>
          </thead>
          <tbody>
            {block.variables.map((variable) => (
              <EnvVariableRow
                key={variable.key}
                variable={variable}
                locked={model.data.locked}
                encryptionReady={model.data.encryptionConfigured}
                onSave={(value) => model.save(variable.key, value)}
                onReset={() => model.reset(variable.key)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EnvHeaderCell({
  className,
  children,
}: {
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <th scope="col" className={cn("px-3 py-2", className)}>
      <Text size="xs" tone="muted" className="font-medium uppercase tracking-wide">
        {children}
      </Text>
    </th>
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
      <div>
        <Button
          size="sm"
          variant="secondary"
          disabled={!ready}
          onClick={() => {
            setOpen(true);
          }}
          data-testid="env-add-oidc"
        >
          Add custom OIDC provider
        </Button>
      </div>
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
