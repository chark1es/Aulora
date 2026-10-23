import type { ChannelSummary } from "@aulora/core";
import { EmptyState, Icon, Text } from "@aulora/ui-web";
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
import { AdminPageHeader } from "./AdminPageHeader";
import type { Callback } from "./callbacks";
import { OverridesEditor } from "./OverridesEditor";

export interface Scope {
  readonly kind: "category" | "channel";
  /** Announcement channels draw their own glyph in the scope list. */
  readonly announcement?: boolean;
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
  readonly onNavigate?: Callback<[page: ScopePage | null]>;
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
        announcement: channel.kind === "announcement",
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

  const scopes = useMemo(
    () => buildScopes(categories, channels, channelNames),
    [categories, channels, channelNames],
  );

  const scope = scopes.find((entry) => entry.key === page?.scopeKey) ?? null;

  if (scope !== null) {
    return (
      <div className="flex flex-col gap-8" data-testid="permissions-panel">
        <AdminPageHeader
          title={scope.name}
          description={`Permission overrides for this ${scope.kind === "category" ? "category" : "channel"}. Unset flags inherit from roles.`}
          back={{
            label: "Permissions",
            onClick: () => {
              navigate(null);
            },
          }}
        />
        <ScopeOverridesPage
          scope={scope}
          roles={roles}
          members={members}
          categories={categories}
          channels={channels}
        />
      </div>
    );
  }

  const categoriesScopes = scopes.filter((entry) => entry.kind === "category");
  const channelScopes = scopes.filter((entry) => entry.kind === "channel");

  return (
    <div className="flex flex-col gap-8" data-testid="permissions-panel">
      <AdminPageHeader
        title="Permissions"
        description="Choose a category or channel, then set what each role and member may do there."
      />

      {scopes.length === 0 ? (
        <EmptyState
          size="sm"
          icon="lock"
          title="No channels to configure yet"
          description="Create a category or channel first, then come back to set its overrides."
        />
      ) : (
        <div className="flex flex-col gap-8">
          {categoriesScopes.length > 0 && (
            <ScopeGroup
              title="Categories"
              scopes={categoriesScopes}
              onSelect={(entry) => {
                navigate({ kind: "scope", scopeKey: entry.key });
              }}
            />
          )}
          {channelScopes.length > 0 && (
            <ScopeGroup
              title="Channels"
              scopes={channelScopes}
              onSelect={(entry) => {
                navigate({ kind: "scope", scopeKey: entry.key });
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

interface ScopeOverridesPageProps {
  readonly scope: Scope;
  readonly roles: readonly RoleView[];
  readonly members: readonly MemberView[];
  readonly categories: readonly CategoryView[];
  readonly channels: readonly ChannelSummary[];
}

function ScopeOverridesPage(props: ScopeOverridesPageProps) {
  const { scope, roles, members, categories, channels } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setCategoryOverrides = useMutation(api.categories.setOverrides);
  const setChannelOverrides = useMutation(api.channels.setOverrides);

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

  const currentOverrides: readonly OverrideView[] =
    scope.kind === "category"
      ? (categories.find((category) => category.id === scope.id)?.overrides ?? [])
      : (channels.find((channel) => channel.id === scope.id)?.overrides ?? []);

  return (
    <div className="flex flex-col gap-4">
      <OverridesEditor
        title={scope.name}
        hideTitle
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

function scopeIcon(scope: Scope): "sidebar" | "announce" | "hash" {
  if (scope.kind === "category") {
    return "sidebar";
  }
  return scope.announcement === true ? "announce" : "hash";
}

function ScopeGroup({
  title,
  scopes,
  onSelect,
}: {
  readonly title: string;
  readonly scopes: readonly Scope[];
  onSelect: Callback<[scope: Scope]>;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[14px] font-semibold text-text">{title}</h2>
      <ul className="divide-y divide-border/60 border-y border-border/60">
        {scopes.map((scope) => (
          <li key={scope.key}>
            <button
              type="button"
              onClick={() => {
                onSelect(scope);
              }}
              className="group flex min-h-[44px] w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-surface-3/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-surface-3 text-text-muted group-hover:text-accent">
                <Icon name={scopeIcon(scope)} size={15} />
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
