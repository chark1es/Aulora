import { Badge, Button, EmptyState, Icon, IconButton, Text } from "@aulora/ui-web";
import { canManageRoleUi, type RoleView } from "../../lib/workspace-admin";
import { AdminPageHeader } from "./AdminPageHeader";
import type { Callback } from "./callbacks";
import type { RoleEditorViewer, RolePage } from "./RoleEditor";

export interface RoleListProps {
  readonly sorted: readonly RoleView[];
  readonly viewer: RoleEditorViewer;
  readonly busy: boolean;
  readonly error: string | null;
  readonly manageableCount: number;
  readonly onNavigate: Callback<[page: RolePage | null]>;
  readonly onMove: Callback<[index: number, otherIndex: number]>;
}

/** The role index: hierarchy order, permission counts and reorder controls. */
export function RoleList(props: RoleListProps) {
  const { sorted, viewer, busy, error, manageableCount, onNavigate, onMove } = props;
  return (
    <div className="flex flex-col gap-8" data-testid="role-editor">
      <AdminPageHeader
        title="Roles"
        description="Higher roles sit above lower ones in the member list and hierarchy."
        trailing={
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
        }
      />

      {error !== null && (
        <Text tone="danger" size="sm" role="alert">
          {error}
        </Text>
      )}

      {sorted.length === 0 ? (
        <EmptyState
          size="sm"
          icon="shield"
          title="No roles yet"
          description="Create a role to group permissions for your members."
          action={
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
          }
        />
      ) : (
        <ul
          className="stagger divide-y divide-border/60 border-y border-border/60"
          data-testid="role-list"
        >
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
      )}

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
      className="group flex min-h-[44px] items-center gap-2.5 px-4 py-1.5 transition hover:bg-surface-3/40"
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
        className="min-w-0 flex-1 rounded-[6px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
          {!editable && !role.isEveryone && (
            <span
              role="img"
              aria-label="Not editable: at or above your highest role"
              title="At or above your highest role"
              className="inline-flex items-center text-text-muted"
            >
              <Icon name="lock" size={11} />
            </span>
          )}
        </span>
        <Text as="span" size="xs" tone="muted" className="block text-[12px]">
          {permissionSummary(role.permissions)}
        </Text>
      </button>
      {editable && (
        <div className="opacity-100 transition md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
          <RoleMoveButtons
            roleName={role.name}
            index={index}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            busy={busy}
            onMove={onMove}
          />
        </div>
      )}
      <Icon
        name="chevron-right"
        size={14}
        className="shrink-0 text-text-muted/50 transition group-hover:text-text"
        aria-hidden="true"
      />
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

function permissionSummary(permissions: bigint): string {
  if (permissions === 0n) {
    return "No permissions";
  }
  const count = permissions.toString(2).split("1").length - 1;
  return `${count} ${count === 1 ? "permission" : "permissions"}`;
}
