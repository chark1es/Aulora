import { cn, Heading, Icon, Input, Switch, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { canManageRoleUi, type RoleView } from "../../lib/workspace-admin";
import { PermissionsToggles } from "./PermissionsToggles";

export interface RoleEditorViewer {
  readonly userId: string;
  readonly isOwner: boolean;
  readonly roleIds: readonly string[];
  readonly topPosition: number;
}

export type RolePage =
  | { readonly kind: "role"; readonly id: string }
  | { readonly kind: "role-create" };

export interface RoleEditorProps {
  readonly viewer: RoleEditorViewer;
  readonly canManageRoles: boolean;
  readonly page?: RolePage | null;
  readonly onNavigate?: (page: RolePage | null) => void;
}

interface RoleDraft {
  readonly name: string;
  readonly color: string;
  readonly permissions: bigint;
  readonly hoisted: boolean;
  readonly mentionable: boolean;
}

function draftFor(role: RoleView | null): RoleDraft {
  return {
    name: role?.name ?? "",
    color: role?.color ?? "",
    permissions: role?.permissions ?? 0n,
    hoisted: role?.hoisted ?? false,
    mentionable: role?.mentionable ?? false,
  };
}

/** A compact palette that reads well on both themes and next to blobatars. */
const PRESET_COLORS = [
  "#C2410C",
  "#E4571C",
  "#0E9F8E",
  "#248A3D",
  "#7C5CFF",
  "#B24592",
  "#D70015",
  "#8E8E93",
] as const;

type PageMode = "list" | "create" | "edit";

/**
 * Role administration as two pages: a compact, reorderable role index and a
 * focused create/edit page. Every control is gated by the same hierarchy rule
 * the server enforces; any rejection is surfaced inline.
 */
export function RoleEditor({ viewer, canManageRoles, page = null, onNavigate }: RoleEditorProps) {
  const roles = useQuery(api.roles.list, {});
  const createRole = useMutation(api.roles.create);
  const updateRole = useMutation(api.roles.update);
  const removeRole = useMutation(api.roles.remove);
  const reorderRoles = useMutation(api.roles.reorder);

  const [draft, setDraft] = useState<RoleDraft>(draftFor(null));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mode: PageMode = page === null ? "list" : page.kind === "role-create" ? "create" : "edit";

  const sorted = [...(roles ?? [])].sort((a, b) => b.position - a.position);
  const selected =
    mode === "edit" && page !== null && page.kind === "role"
      ? (sorted.find((role) => role.id === page.id) ?? null)
      : null;

  const pageKey = mode === "edit" && selected !== null ? `role:${selected.id}` : mode;

  // Seed the draft only when the page identity changes: a live roles refetch
  // must never clobber what the user is currently typing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed on page change only
  useEffect(() => {
    if (mode === "create") {
      setDraft(draftFor(null));
      setError(null);
      return;
    }
    if (mode === "edit") {
      const role = sorted.find((entry) => entry.id === selected?.id) ?? null;
      if (role !== null || roles !== undefined) {
        setDraft(draftFor(role));
        setError(null);
      }
    }
  }, [pageKey]);

  const navigate = onNavigate ?? (() => undefined);

  if (!canManageRoles) {
    return (
      <Text tone="muted" size="sm" data-testid="role-editor-locked">
        You need the Manage roles permission to edit roles.
      </Text>
    );
  }

  const manageable = sorted.filter((role) => canManageRoleUi(viewer, role));

  async function run(task: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (mode !== "list") {
    if (mode === "edit" && selected === null) {
      return (
        <Text tone="muted" size="sm" data-testid="role-editor">
          Loading role…
        </Text>
      );
    }

    return (
      <div className="flex flex-col gap-4" data-testid="role-editor">
        <form
          className="flex flex-col gap-3"
          data-testid="role-form"
          onSubmit={(event) => {
            event.preventDefault();
            const name = draft.name.trim();
            if (name.length === 0) {
              setError("Role name is required");
              return;
            }
            const colorPatch = draft.color.trim();
            if (mode === "create") {
              void run(async () => {
                await createRole({
                  name,
                  color: colorPatch,
                  permissions: draft.permissions,
                  hoisted: draft.hoisted,
                  mentionable: draft.mentionable,
                });
                navigate(null);
              });
            } else if (selected !== null) {
              void run(async () => {
                await updateRole({
                  roleId: selected.id as never,
                  name,
                  color: colorPatch,
                  permissions: draft.permissions,
                  hoisted: draft.hoisted,
                  mentionable: draft.mentionable,
                });
              });
            }
          }}
        >
          <Input
            label="Role name"
            value={draft.name}
            disabled={selected?.isEveryone ?? false}
            onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
          />
          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-medium text-text-muted">Role color</span>
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative flex h-9 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-[8px] border border-border">
                <span
                  className="absolute inset-0"
                  style={{ backgroundColor: draft.color.length > 0 ? draft.color : "#8E8E93" }}
                />
                <Icon name="image" size={14} className="relative text-white/80" />
                <input
                  type="color"
                  aria-label="Role color"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  value={draft.color.length > 0 ? draft.color : "#8E8E93"}
                  onChange={(event) => setDraft({ ...draft, color: event.currentTarget.value })}
                />
              </label>
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Use color ${color}`}
                  onClick={() => setDraft({ ...draft, color })}
                  className={cn(
                    "h-6 w-6 rounded-full border transition",
                    draft.color === color ? "border-text ring-2 ring-accent/40" : "border-border",
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
              <button
                type="button"
                onClick={() => setDraft({ ...draft, color: "" })}
                className="h-6 rounded-full border border-border px-2 text-[11px] text-text-muted transition hover:text-text"
              >
                None
              </button>
            </div>
          </div>
          <div className="overflow-hidden rounded-[10px] border border-border bg-surface-2">
            <div className="px-3.5 py-1.5">
              <Switch
                checked={draft.hoisted}
                onChange={(hoisted) => setDraft({ ...draft, hoisted })}
                label="Show separately"
                description="Display this role as its own group in the member list."
              />
            </div>
            <div className="h-px bg-border" />
            <div className="px-3.5 py-1.5">
              <Switch
                checked={draft.mentionable}
                onChange={(mentionable) => setDraft({ ...draft, mentionable })}
                label="Mentionable"
                description="Let members @mention this role."
              />
            </div>
          </div>
          <PermissionsToggles
            value={draft.permissions}
            onChange={(next) => setDraft({ ...draft, permissions: next })}
            disabled={busy}
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="h-9 rounded-[8px] bg-accent px-3.5 text-[12px] font-semibold text-on-accent transition hover:brightness-110 disabled:opacity-50"
            >
              {busy ? "Saving…" : mode === "create" ? "Create role" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={() => navigate(null)}
              className="h-9 rounded-[8px] px-3 text-[12px] font-medium text-text-muted transition hover:bg-surface-3 hover:text-text"
            >
              Cancel
            </button>
            {mode === "edit" && selected !== null && canManageRoleUi(viewer, selected) && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (selected.isEveryone) {
                    return;
                  }
                  void run(async () => {
                    await removeRole({ roleId: selected.id as never });
                    navigate(null);
                  });
                }}
                className="ml-auto h-9 rounded-[8px] border border-danger/30 px-3 text-[12px] font-medium text-danger transition hover:bg-danger/10 disabled:opacity-50"
              >
                Delete role
              </button>
            )}
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="role-editor">
      <div className="flex items-center justify-between">
        <div>
          <Heading level={3}>Roles</Heading>
          <p className="text-[12px] text-text-muted">
            Higher roles sit above lower ones in the member list and hierarchy.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate({ kind: "role-create" })}
          disabled={busy}
          className="flex h-8 items-center gap-1.5 rounded-[8px] bg-accent px-3 text-[12px] font-semibold text-on-accent transition hover:brightness-110 disabled:opacity-50"
        >
          <Icon name="plus" size={14} />
          New role
        </button>
      </div>

      {error !== null && (
        <Text tone="danger" size="sm" role="alert">
          {error}
        </Text>
      )}

      <ul className="stagger flex flex-col gap-1.5" data-testid="role-list">
        {sorted.map((role, index) => {
          const editable = canManageRoleUi(viewer, role);
          const canMoveUp =
            editable && index > 0 && canManageRoleUi(viewer, sorted[index - 1] as RoleView);
          const canMoveDown = editable && index < sorted.length - 1;
          return (
            <li
              key={role.id}
              className="flex items-center gap-2.5 rounded-[10px] border border-border bg-surface-2 px-3 py-2 transition hover:border-text-muted/30"
              data-testid={`role-row-${role.name}`}
            >
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] border border-border"
                style={{ backgroundColor: role.color ?? "transparent" }}
              >
                {role.color === null && (
                  <Icon name="shield" size={12} className="text-text-muted" />
                )}
              </span>
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => navigate({ kind: "role", id: role.id })}
              >
                <span className="flex items-center gap-1.5">
                  <Text as="span" size="sm" className="font-medium">
                    {role.name}
                  </Text>
                  {role.isEveryone && (
                    <span className="rounded-[4px] border border-border px-1 text-[10px] text-text-muted">
                      default
                    </span>
                  )}
                  {role.hoisted && (
                    <span className="rounded-[4px] bg-surface-3 px-1 text-[10px] text-text-muted">
                      shown
                    </span>
                  )}
                  {role.mentionable && (
                    <span className="rounded-[4px] bg-surface-3 px-1 text-[10px] text-text-muted">
                      mentionable
                    </span>
                  )}
                </span>
                <Text as="span" size="xs" tone="muted" className="block">
                  {role.permissions === 0n
                    ? "No permissions"
                    : `${role.permissions.toString(2).split("1").length - 1} permissions`}
                </Text>
              </button>
              <Icon
                name="chevron-right"
                size={14}
                className="shrink-0 text-text-muted/50"
                aria-hidden="true"
              />
              {editable && (
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    aria-label={`Move ${role.name} up`}
                    disabled={!canMoveUp || busy}
                    onClick={() =>
                      void run(() =>
                        swapRoles(sorted, index, index - 1, (positions) =>
                          reorderRoles({ positions: positions as never }),
                        ),
                      )
                    }
                    className="flex h-7 w-7 items-center justify-center rounded-[7px] text-text-muted transition hover:bg-surface-3 hover:text-text disabled:opacity-30"
                  >
                    <Icon name="chevron-down" size={14} className="rotate-180" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${role.name} down`}
                    disabled={!canMoveDown || busy}
                    onClick={() =>
                      void run(() =>
                        swapRoles(sorted, index, index + 1, (positions) =>
                          reorderRoles({ positions: positions as never }),
                        ),
                      )
                    }
                    className="flex h-7 w-7 items-center justify-center rounded-[7px] text-text-muted transition hover:bg-surface-3 hover:text-text disabled:opacity-30"
                  >
                    <Icon name="chevron-down" size={14} />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {manageable.length === 0 && (
        <Text tone="muted" size="sm">
          No roles are below your highest role.
        </Text>
      )}
    </div>
  );
}

/** Swaps the positions of two adjacent roles and persists both. */
async function swapRoles(
  sorted: readonly RoleView[],
  index: number,
  otherIndex: number,
  apply: (positions: { roleId: string; position: number }[]) => Promise<unknown>,
): Promise<void> {
  const a = sorted[index];
  const b = sorted[otherIndex];
  if (a === undefined || b === undefined || b.isEveryone) {
    return;
  }
  await apply([
    { roleId: a.id, position: b.position },
    { roleId: b.id, position: a.position },
  ]);
}
