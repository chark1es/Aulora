import type { ChannelSummary } from "@aulora/core";
import { Heading, Icon, Text } from "@aulora/ui-web";
import { useMutation } from "convex/react";
import { useMemo, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import {
  type CategoryView,
  type MemberView,
  memberDisplayName,
  type OverrideTarget,
  type OverrideView,
  type RoleView,
  roleRef,
} from "../../lib/workspace-admin";
import { OverridesEditor } from "./OverridesEditor";

export interface Scope {
  readonly kind: "category" | "channel";
  readonly id: string;
  readonly name: string;
  readonly key: string;
}

export interface ScopePage {
  readonly kind: "scope";
  readonly scopeKey: string;
}

export interface PermissionsPanelProps {
  readonly roles: readonly RoleView[];
  readonly members: readonly MemberView[];
  readonly categories: readonly CategoryView[];
  readonly channels: readonly ChannelSummary[];
  readonly channelNames?: ReadonlyMap<string, string>;
  readonly page?: ScopePage | null;
  readonly onNavigate?: (page: ScopePage | null) => void;
}

/** Flattens categories then text/announcement channels into override scopes. */
export function buildScopes(
  categories: readonly CategoryView[],
  channels: readonly ChannelSummary[],
  channelNames?: ReadonlyMap<string, string>,
): Scope[] {
  return [
    ...[...categories]
      .sort((a, b) => a.position - b.position)
      .map((category) => ({
        kind: "category" as const,
        id: category.id,
        name: category.name,
        key: `category:${category.id}`,
      })),
    ...channels
      .filter((channel) => channel.kind === "text" || channel.kind === "announcement")
      .map((channel) => ({
        kind: "channel" as const,
        id: channel.id,
        name: channelNames?.get(channel.id) ?? channel.id,
        key: `channel:${channel.id}`,
      })),
  ];
}

/**
 * Permission overrides host. The root is a scope index (categories then
 * channels); picking one opens its override matrix on its own page so the
 * index never grows an inline editor.
 */
export function PermissionsPanel({
  roles,
  members,
  categories,
  channels,
  channelNames,
  page = null,
  onNavigate,
}: PermissionsPanelProps) {
  const navigate = onNavigate ?? (() => undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setCategoryOverrides = useMutation(api.categories.setOverrides);
  const setChannelOverrides = useMutation(api.channels.setOverrides);

  const scopes = useMemo(
    () => buildScopes(categories, channels, channelNames),
    [categories, channels, channelNames],
  );

  const targets: OverrideTarget[] = useMemo(
    () => [
      ...[...roles]
        .sort((a, b) => b.position - a.position)
        .map((role) => ({
          targetId: roleRef(role),
          targetType: "role" as const,
          label: role.name,
          color: role.color,
        })),
      ...members.map((member) => ({
        targetId: member.userId,
        targetType: "member" as const,
        label: memberDisplayName(member, member.userId),
      })),
    ],
    [roles, members],
  );

  const scope = scopes.find((entry) => entry.key === page?.scopeKey) ?? null;

  if (scope !== null) {
    const currentOverrides: readonly OverrideView[] =
      scope.kind === "category"
        ? (categories.find((category) => category.id === scope.id)?.overrides ?? [])
        : (channels.find((channel) => channel.id === scope.id)?.overrides ?? []);

    return (
      <div className="flex flex-col gap-4" data-testid="permissions-panel">
        <OverridesEditor
          title={scope.name}
          overrides={currentOverrides}
          targets={targets}
          busy={busy}
          error={error}
          testId="admin-overrides"
          onSave={async (next) => {
            setBusy(true);
            setError(null);
            try {
              const payload = next.map((override) => ({
                targetId: override.targetId,
                targetType: override.targetType,
                allow: override.allow,
                deny: override.deny,
              }));
              if (scope.kind === "category") {
                await setCategoryOverrides({ categoryId: scope.id as never, overrides: payload });
              } else {
                await setChannelOverrides({ channelId: scope.id as never, overrides: payload });
              }
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Could not save overrides.");
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
    );
  }

  const categoriesScopes = scopes.filter((entry) => entry.kind === "category");
  const channelScopes = scopes.filter((entry) => entry.kind === "channel");

  return (
    <div className="flex flex-col gap-5" data-testid="permissions-panel">
      <header className="flex flex-col gap-1">
        <Heading level={3}>Permissions</Heading>
        <Text size="sm" tone="muted">
          Choose a category or channel to review its overrides.
        </Text>
      </header>

      {scopes.length === 0 ? (
        <Text size="sm" tone="muted">
          There are no categories or channels to configure yet.
        </Text>
      ) : (
        <div className="flex flex-col gap-5">
          {categoriesScopes.length > 0 && (
            <ScopeGroup
              title="Categories"
              scopes={categoriesScopes}
              onSelect={(entry) => navigate({ kind: "scope", scopeKey: entry.key })}
            />
          )}
          {channelScopes.length > 0 && (
            <ScopeGroup
              title="Channels"
              scopes={channelScopes}
              onSelect={(entry) => navigate({ kind: "scope", scopeKey: entry.key })}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ScopeGroup({
  title,
  scopes,
  onSelect,
}: {
  readonly title: string;
  readonly scopes: readonly Scope[];
  onSelect: (scope: Scope) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <Text as="h4" size="xs" tone="muted" className="font-semibold uppercase tracking-[0.06em]">
        {title}
      </Text>
      <ul className="overflow-hidden rounded-[12px] border border-border bg-surface-2">
        {scopes.map((scope, index) => (
          <li key={scope.key}>
            {index > 0 && <div className="ml-4 h-px bg-border" />}
            <button
              type="button"
              onClick={() => onSelect(scope)}
              className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-border bg-surface-1 text-text-muted group-hover:text-accent">
                <Icon name={scope.kind === "category" ? "sidebar" : "hash"} size={14} />
              </span>
              <Text as="span" size="sm" className="min-w-0 flex-1 truncate font-medium">
                {scope.name}
              </Text>
              <Icon
                name="chevron-right"
                size={14}
                className="shrink-0 text-text-muted/60 transition group-hover:translate-x-0.5 group-hover:text-text"
              />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
