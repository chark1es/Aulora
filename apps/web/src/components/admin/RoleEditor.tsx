import { ALL_PERMISSIONS } from "@aulora/core";
import { Button, Input, Switch, Text } from "@aulora/ui-web";
import { useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { canManageRoleUi, type RoleView } from "../../lib/workspace-admin";
import { AdminPageHeader } from "./AdminPageHeader";
import type { Callback } from "./callbacks";
import { PermissionsToggles } from "./PermissionsToggles";
import { RoleColorPicker } from "./RoleColorPicker";
import { RoleList } from "./RoleList";
import { SettingsGroup, SettingsGroupRow } from "./SettingsGroup";
import { SettingsSection } from "./SettingsSection";

export interface RoleEditorViewer {
  readonly userId: string;
  readonly isOwner: boolean;
  readonly roleIds: readonly string[];
  readonly permissions: bigint;
  readonly topPosition: number;
}

export type RolePage =
  | { readonly kind: "role"; readonly id: string }
  | { readonly kind: "role-create" };

export interface RoleEditorProps {
  readonly viewer: RoleEditorViewer;
  /** The workspace roles from the shared admin query, sorted by the editor. */
  readonly roles: readonly RoleView[];
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
export function RoleEditor({
  viewer,
  roles,
  canManageRoles,
  page = null,
  onNavigate,
}: RoleEditorProps) {
  const createRole = useMutation(api.roles.create);
  const updateRole = useMutation(api.roles.update);
  const removeRole = useMutation(api.roles.remove);
  const reorderRoles = useMutation(api.roles.reorder);

  const [draft, setDraft] = useState<RoleDraft>(draftFor(null));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mode: PageMode = page === null ? "list" : page.kind === "role-create" ? "create" : "edit";

  const sorted = [...roles].sort((a, b) => b.position - a.position);
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
      if (role !== null) {
        setDraft(draftFor(role));
        setError(null);
      }
    }
  }, [pageKey]);

  const navigate = onNavigate ?? (() => undefined);

  if (!canManageRoles) {
    return (
      <div className="flex flex-col gap-8" data-testid="role-editor">
        <AdminPageHeader
          title="Roles"
          description="Higher roles sit above lower ones in the member list and hierarchy."
        />
        <Text tone="muted" size="sm" data-testid="role-editor-locked">
          You need the Manage roles permission to edit roles.
        </Text>
      </div>
    );
  }

  const manageable = sorted.filter((role) => canManageRoleUi(viewer, role));
  // The default role is a special case: only the owner may change it, and it
  // can never be deleted or rendered as its own member-list section.
  const everyoneSelected = selected?.isEveryone === true;
  const editableSelected =
    selected !== null && (everyoneSelected ? viewer.isOwner : canManageRoleUi(viewer, selected));
  const readOnly = mode === "edit" && !editableSelected;
  const readOnlyNote =
    everyoneSelected && !viewer.isOwner
      ? "Only the workspace owner can change the default role."
      : "Only roles below your highest role can be edited or assigned.";
  const grantable = viewer.isOwner ? ALL_PERMISSIONS : viewer.permissions;

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
      <div className="flex flex-col gap-8" data-testid="role-editor">
        <AdminPageHeader
          title={mode === "create" ? "New role" : (selected?.name ?? "Role")}
          description={
            readOnly
              ? "Role details and permissions."
              : mode === "create"
                ? "Name the role, pick a colour and grant only what it needs."
                : "Change what this role can do. Members keep it until you remove it."
          }
          back={{
            label: "Roles",
            onClick: () => {
              navigate(null);
            },
          }}
        />

        {readOnly && (
          <p className="-mt-4 text-[12px] text-text-muted" data-testid="role-readonly-note">
            {readOnlyNote}
          </p>
        )}

        <form
          className="flex flex-col gap-8"
          data-testid="role-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (readOnly) {
              return;
            }
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
          <SettingsSection title="Details">
            <div className="flex flex-col gap-4 border-y border-border/60 py-4">
              <Input
                label="Role name"
                value={draft.name}
                disabled={(selected?.isEveryone ?? false) || readOnly}
                onChange={(event) => {
                  setDraft({ ...draft, name: event.currentTarget.value });
                }}
              />
              <RoleColorPicker
                value={draft.color}
                disabled={readOnly}
                onChange={(color) => {
                  setDraft({ ...draft, color });
                }}
              />
            </div>
          </SettingsSection>

          {!(selected?.isEveryone ?? false) && (
            <SettingsSection title="Display">
              <SettingsGroup>
                <SettingsGroupRow
                  label="Show members separately"
                  description="List this role as its own section in the member panel."
                >
                  <Switch
                    bare
                    checked={draft.hoisted}
                    label="Display role members separately"
                    disabled={readOnly}
                    onChange={(hoisted) => {
                      setDraft({ ...draft, hoisted });
                    }}
                  />
                </SettingsGroupRow>
                <SettingsGroupRow label="Mentionable" description="Let members @mention this role.">
                  <Switch
                    bare
                    checked={draft.mentionable}
                    label="Mentionable"
                    disabled={readOnly}
                    onChange={(mentionable) => {
                      setDraft({ ...draft, mentionable });
                    }}
                  />
                </SettingsGroupRow>
              </SettingsGroup>
            </SettingsSection>
          )}

          <PermissionsToggles
            value={draft.permissions}
            onChange={(next) => {
              setDraft({ ...draft, permissions: next });
            }}
            disabled={busy || readOnly}
            grantable={grantable}
          />

          <div className="flex items-center gap-2 border-t border-border/60 pt-4">
            {!readOnly &&
              mode === "edit" &&
              selected !== null &&
              canManageRoleUi(viewer, selected) && (
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
              {readOnly ? "Close" : "Cancel"}
            </Button>
            {!readOnly && (
              <Button type="submit" loading={busy}>
                {mode === "create" ? "Create role" : "Save changes"}
              </Button>
            )}
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
