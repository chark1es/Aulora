import { Badge, Button, Heading, Icon, IconButton, Input, Switch, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { canManageRoleUi, type RoleView } from "../../lib/workspace-admin";
import type { Callback } from "./callbacks";
import { PermissionsToggles } from "./PermissionsToggles";
import { RoleColorPicker } from "./RoleColorPicker";

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
  readonly onNavigate?: Callback<[page: RolePage | null]>;
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
            onChange={(event) => {
              setDraft({ ...draft, name: event.currentTarget.value });
            }}
          />
          <RoleColorPicker
            value={draft.color}
            onChange={(color) => {
              setDraft({ ...draft, color });
            }}
          />
          <div className="overflow-hidden rounded-[10px] border border-border bg-surface-2">
            <div className="px-3.5 py-1.5">
              <Switch
                checked={draft.hoisted}
                onChange={(hoisted) => {
                  setDraft({ ...draft, hoisted });
                }}
                label="Display role members separately from online members"
                description="Show this role as its own section at the top of the member list."
              />
            </div>
            <div className="h-px bg-border" />
            <div className="px-3.5 py-1.5">
              <Switch
                checked={draft.mentionable}
                onChange={(mentionable) => {
                  setDraft({ ...draft, mentionable });
                }}
                label="Mentionable"
                description="Let members @mention this role."
              />
            </div>
          </div>
          <PermissionsToggles
            value={draft.permissions}
            onChange={(next) => {
              setDraft({ ...draft, permissions: next });
            }}
            disabled={busy}
          />
          <div className="flex items-center gap-2">
            {mode === "edit" && selected !== null && canManageRoleUi(viewer, selected) && (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto text-danger hover:bg-danger/10 hover:text-danger"
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
              >
                Delete role
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                navigate(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              {mode === "create" ? "Create role" : "Save changes"}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <RoleList
      sorted={sorted}
      viewer={viewer}
      busy={busy}
      error={error}
      manageableCount={manageable.length}
      onNavigate={navigate}
      onMove={(index, otherIndex) => {
        void run(() =>
          swapRoles(sorted, index, otherIndex, (positions) =>
            reorderRoles({ positions: positions as never }),
          ),
        );
      }}
    />
  );
}

interface RoleListProps {
  readonly sorted: readonly RoleView[];
  readonly viewer: RoleEditorViewer;
  readonly busy: boolean;
  readonly error: string | null;
  readonly manageableCount: number;
  readonly onNavigate: Callback<[page: RolePage | null]>;
  readonly onMove: Callback<[index: number, otherIndex: number]>;
}

function RoleList(props: RoleListProps) {
  const { sorted, viewer, busy, error, manageableCount, onNavigate, onMove } = props;
  return (
    <div className="flex flex-col gap-4" data-testid="role-editor">
      <div className="flex items-center justify-between">
        <div>
          <Heading level={3}>Roles</Heading>
          <p className="text-[12px] text-text-muted">
            Higher roles sit above lower ones in the member list and hierarchy.
          </p>
        </div>
        <Button
          size="sm"
          disabled={busy}
          leading={<Icon name="plus" size={14} />}
          onClick={() => {
            onNavigate({ kind: "role-create" });
          }}
        >
          New role
        </Button>
      </div>

      {error !== null && (
        <Text tone="danger" size="sm" role="alert">
          {error}
        </Text>
      )}

      <ul className="stagger flex flex-col gap-1.5" data-testid="role-list">
        {sorted.map((role, index) => (
          <RoleRow
            key={role.id}
            role={role}
            index={index}
            count={sorted.length}
            previous={sorted.at(index - 1)}
            viewer={viewer}
            busy={busy}
            onNavigate={onNavigate}
            onMove={onMove}
          />
        ))}
      </ul>

      {manageableCount === 0 && (
        <Text tone="muted" size="sm">
          No roles are below your highest role.
        </Text>
      )}
    </div>
  );
}

interface RoleRowProps {
  readonly role: RoleView;
  readonly index: number;
  readonly count: number;
  readonly previous: RoleView | undefined;
  readonly viewer: RoleEditorViewer;
  readonly busy: boolean;
  readonly onNavigate: Callback<[page: RolePage | null]>;
  readonly onMove: Callback<[index: number, otherIndex: number]>;
}

function RoleRow(props: RoleRowProps) {
  const { role, index, count, previous, viewer, busy, onNavigate, onMove } = props;
  const editable = canManageRoleUi(viewer, role);
  const canMoveUp =
    editable && index > 0 && previous !== undefined && canManageRoleUi(viewer, previous);
  const canMoveDown = editable && index < count - 1;
  return (
    <li
      className="flex items-center gap-2.5 rounded-[10px] border border-border bg-surface-2 px-3 py-2 transition hover:border-text-muted/30"
      data-testid={`role-row-${role.name}`}
    >
      <span
        aria-hidden="true"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] border border-border"
        style={{ backgroundColor: role.color ?? "transparent" }}
      >
        {role.color === null && <Icon name="shield" size={12} className="text-text-muted" />}
      </span>
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => {
          onNavigate({ kind: "role", id: role.id });
        }}
      >
        <span className="flex items-center gap-1.5">
          <Text as="span" size="sm" className="font-medium">
            {role.name}
          </Text>
          {role.isEveryone && (
            <Badge size="sm" tone="outline">
              default
            </Badge>
          )}
          {role.hoisted && (
            <Badge size="sm" tone="neutral">
              shown
            </Badge>
          )}
          {role.mentionable && (
            <Badge size="sm" tone="neutral">
              mentionable
            </Badge>
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
        <RoleMoveButtons
          roleName={role.name}
          index={index}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          busy={busy}
          onMove={onMove}
        />
      )}
    </li>
  );
}

function RoleMoveButtons({
  roleName,
  index,
  canMoveUp,
  canMoveDown,
  busy,
  onMove,
}: {
  readonly roleName: string;
  readonly index: number;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly busy: boolean;
  readonly onMove: Callback<[index: number, otherIndex: number]>;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <IconButton
        label={`Move ${roleName} up`}
        size="sm"
        disabled={!canMoveUp || busy}
        onClick={() => {
          onMove(index, index - 1);
        }}
      >
        <Icon name="chevron-down" size={14} className="rotate-180" />
      </IconButton>
      <IconButton
        label={`Move ${roleName} down`}
        size="sm"
        disabled={!canMoveDown || busy}
        onClick={() => {
          onMove(index, index + 1);
        }}
      >
        <Icon name="chevron-down" size={14} />
      </IconButton>
    </div>
  );
}

/** Swaps the positions of two adjacent roles and persists both. */
async function swapRoles(
  sorted: readonly RoleView[],
  index: number,
  otherIndex: number,
  apply: Callback<[positions: { roleId: string; position: number }[]], Promise<unknown>>,
): Promise<void> {
  const a = sorted.at(index);
  const b = sorted.at(otherIndex);
  if (a === undefined || b === undefined || b.isEveryone) {
    return;
  }
  await apply([
    { roleId: a.id, position: b.position },
    { roleId: b.id, position: a.position },
  ]);
}
