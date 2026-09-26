import { Button, Heading, Input, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { canManageRoleUi, type RoleView } from "../../lib/workspace-admin";
import { PermissionsToggles } from "./PermissionsToggles";

export interface RoleEditorViewer {
  readonly userId: string;
  readonly isOwner: boolean;
  readonly roleIds: readonly string[];
  readonly topPosition: number;
}

export interface RoleEditorProps {
  readonly viewer: RoleEditorViewer;
  readonly canManageRoles: boolean;
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

/**
 * Role CRUD, reordering and the permission/display toggles. Every control is
 * gated by the same hierarchy rule the server enforces; the server stays the
 * source of truth and any rejection is surfaced inline.
 */
export function RoleEditor({ viewer, canManageRoles }: RoleEditorProps) {
  const roles = useQuery(api.roles.list, {});
  const createRole = useMutation(api.roles.create);
  const updateRole = useMutation(api.roles.update);
  const removeRole = useMutation(api.roles.remove);
  const reorderRoles = useMutation(api.roles.reorder);

  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RoleDraft>(draftFor(null));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canManageRoles) {
    return (
      <Text tone="muted" size="sm" data-testid="role-editor-locked">
        You need the Manage roles permission to edit roles.
      </Text>
    );
  }

  const sorted = [...(roles ?? [])].sort((a, b) => b.position - a.position);
  const selected = sorted.find((role) => role.id === selectedId) ?? null;
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

  function startCreate() {
    setSelectedId(null);
    setDraft(draftFor(null));
    setCreating(true);
    setError(null);
  }

  function startEdit(role: RoleView) {
    setSelectedId(role.id);
    setDraft(draftFor(role));
    setCreating(false);
    setError(null);
  }

  const colorPatch = draft.color.trim().length > 0 ? draft.color.trim() : "";

  return (
    <div className="flex flex-col gap-4" data-testid="role-editor">
      <div className="flex items-center justify-between">
        <Heading level={3}>Roles</Heading>
        <Button size="sm" onClick={startCreate} disabled={busy}>
          New role
        </Button>
      </div>

      {error !== null && (
        <Text tone="danger" size="sm" role="alert">
          {error}
        </Text>
      )}

      <ul className="flex flex-col gap-1" data-testid="role-list">
        {sorted.map((role, index) => {
          const editable = canManageRoleUi(viewer, role);
          const canMoveUp =
            editable && index > 0 && canManageRoleUi(viewer, sorted[index - 1] as RoleView);
          const canMoveDown = editable && index < sorted.length - 1;
          return (
            <li
              key={role.id}
              className="flex items-center gap-2 rounded-input border border-border bg-surface-2 px-3 py-2"
              data-testid={`role-row-${role.name}`}
            >
              <span
                aria-hidden="true"
                className="h-4 w-4 shrink-0 rounded-pill border border-border"
                style={{ backgroundColor: role.color ?? "transparent" }}
              />
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => startEdit(role)}
              >
                <Text as="span" size="sm" className="font-medium">
                  {role.name}
                </Text>
                <Text as="span" size="xs" tone="muted" mono className="ml-2">
                  #{role.position}
                  {role.isEveryone ? " · everyone" : ""}
                  {role.hoisted ? " · hoisted" : ""}
                  {role.mentionable ? " · mentionable" : ""}
                </Text>
              </button>
              {editable && (
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Move ${role.name} up`}
                    disabled={!canMoveUp || busy}
                    onClick={() =>
                      run(() =>
                        swapRoles(sorted, index, index - 1, (positions) =>
                          reorderRoles({ positions: positions as never }),
                        ),
                      )
                    }
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Move ${role.name} down`}
                    disabled={!canMoveDown || busy}
                    onClick={() =>
                      run(() =>
                        swapRoles(sorted, index, index + 1, (positions) =>
                          reorderRoles({ positions: positions as never }),
                        ),
                      )
                    }
                  >
                    ↓
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {(creating || selected !== null) && (
        <form
          className="flex flex-col gap-3 rounded-card border border-border bg-surface-1 p-4"
          data-testid="role-form"
          onSubmit={(event) => {
            event.preventDefault();
            const name = draft.name.trim();
            if (name.length === 0) {
              setError("Role name is required");
              return;
            }
            if (creating) {
              void run(async () => {
                await createRole({
                  name,
                  color: colorPatch,
                  permissions: draft.permissions,
                  hoisted: draft.hoisted,
                  mentionable: draft.mentionable,
                });
                setCreating(false);
                setDraft(draftFor(null));
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
          <Heading level={3}>{creating ? "New role" : `Edit ${selected?.name}`}</Heading>
          <Input
            label="Role name"
            value={draft.name}
            disabled={selected?.isEveryone ?? false}
            onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
          />
          <div className="flex items-end gap-3">
            <label className="flex flex-col gap-1.5 text-sm text-text-muted">
              Role color
              <input
                type="color"
                aria-label="Role color"
                className="h-10 w-16 rounded-input border border-border bg-surface-3"
                value={draft.color.length > 0 ? draft.color : "#F5A45B"}
                onChange={(event) => setDraft({ ...draft, color: event.currentTarget.value })}
              />
            </label>
            <Button size="sm" variant="ghost" onClick={() => setDraft({ ...draft, color: "" })}>
              No color
            </Button>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-accent"
                checked={draft.hoisted}
                onChange={(event) => setDraft({ ...draft, hoisted: event.currentTarget.checked })}
              />
              Show separately (hoisted)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-accent"
                checked={draft.mentionable}
                onChange={(event) =>
                  setDraft({ ...draft, mentionable: event.currentTarget.checked })
                }
              />
              Mentionable
            </label>
          </div>
          <PermissionsToggles
            value={draft.permissions}
            onChange={(next) => setDraft({ ...draft, permissions: next })}
            disabled={busy}
          />
          <div className="flex gap-2">
            <Button type="submit" loading={busy}>
              {creating ? "Create role" : "Save changes"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setCreating(false);
                setSelectedId(null);
              }}
            >
              Cancel
            </Button>
            {!creating && selected !== null && canManageRoleUi(viewer, selected) && (
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => {
                  if (selected.isEveryone) {
                    return;
                  }
                  void run(async () => {
                    await removeRole({ roleId: selected.id as never });
                    setSelectedId(null);
                  });
                }}
              >
                Delete role
              </Button>
            )}
          </div>
        </form>
      )}

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
