/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { ConfirmDialog, cn, Icon } from "@aulora/ui-web";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { ChannelSidebarProps } from "./channel-sidebar-model";
import { PresenceAvatar, type PresenceStatus } from "./PresenceAvatar";
import type { CategoryHeaderDrag } from "./use-category-drag";

export function SectionHeader({
  title,
  collapsed,
  onToggle,
  action,
  testId,
  onContextMenu,
  drag,
}: {
  readonly title: string;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly action: ReactNode;
  readonly testId?: string;
  readonly onContextMenu?: (_event: React.MouseEvent) => void;
  readonly drag?: CategoryHeaderDrag;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between py-1 pl-1.5 pr-1",
        drag?.dragging === true && "opacity-50",
      )}
      {...(drag !== undefined
        ? {
            draggable: true,
            onDragStart: drag.onDragStart,
            onDragEnd: drag.onDragEnd,
            onDragOver: drag.onDragOver,
            onDragLeave: drag.onDragLeave,
            onDrop: drag.onDrop,
          }
        : {})}
    >
      <button
        type="button"
        {...(testId !== undefined ? { "data-testid": testId } : {})}
        {...(onContextMenu !== undefined ? { onContextMenu } : {})}
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="flex items-center gap-1 rounded-[6px] px-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted transition hover:text-text"
      >
        <Icon
          name="chevron-down"
          size={11}
          className={cn("transition-transform", collapsed && "-rotate-90")}
        />
        {title}
      </button>
      {action}
    </div>
  );
}

export function HeaderButton({
  label,
  onClick,
  children,
  small = false,
  hasPopup,
  expanded,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly small?: boolean;
  readonly hasPopup?: React.AriaAttributes["aria-haspopup"];
  readonly expanded?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...(hasPopup === undefined ? {} : { "aria-haspopup": hasPopup })}
      {...(expanded === undefined ? {} : { "aria-expanded": expanded })}
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[7px] text-text-muted transition hover:bg-surface-3 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        small ? "h-6 w-6" : "h-8 w-8",
      )}
    >
      {children}
    </button>
  );
}

export function CreateMenuButton({
  canCreateChannel,
  canManageCategories,
  onCreateChannel,
  onCreateCategory,
}: {
  readonly canCreateChannel: boolean;
  readonly canManageCategories: boolean;
  readonly onCreateChannel: (kind?: "text" | "voice") => void;
  readonly onCreateCategory?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (event: PointerEvent) => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const hasExtras = canManageCategories;
  const label = canManageCategories ? "Create channel or category" : "Create channel";

  return (
    <div ref={ref} className="relative">
      <HeaderButton
        label={label}
        small
        hasPopup="menu"
        expanded={open}
        onClick={() => {
          if (!hasExtras) {
            onCreateChannel("text");
            return;
          }
          setOpen((current) => !current);
        }}
      >
        <Icon name="plus" size={15} />
      </HeaderButton>
      {open && hasExtras && (
        <div
          role="menu"
          aria-label="Create"
          className="absolute right-0 top-full z-20 mt-1 min-w-[184px] animate-pop-in rounded-[10px] border border-border bg-surface-2 p-1 shadow-xl shadow-black/20"
        >
          {canCreateChannel && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onCreateChannel("text");
              }}
              className="flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-left text-[13px] text-text transition hover:bg-surface-3"
            >
              <Icon name="hash" size={14} className="text-text-muted" />
              New text channel
            </button>
          )}
          {canCreateChannel && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onCreateChannel("voice");
              }}
              className="flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-left text-[13px] text-text transition hover:bg-surface-3"
            >
              <Icon name="volume" size={14} className="text-text-muted" />
              New voice channel
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onCreateCategory?.();
            }}
            className="flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-left text-[13px] text-text transition hover:bg-surface-3"
          >
            <Icon name="plus" size={14} className="text-text-muted" />
            New category
          </button>
        </div>
      )}
    </div>
  );
}

export const STATUS_OPTIONS: readonly { value: PresenceStatus; label: string }[] = [
  { value: "online", label: "Online" },
  { value: "idle", label: "Idle" },
  { value: "dnd", label: "Do not disturb" },
  { value: "offline", label: "Invisible" },
];

export function AccountFooter(props: ChannelSidebarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingStatus, setEditingStatus] = useState(false);
  const [statusDraft, setStatusDraft] = useState("");
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const statusInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointer = (event: PointerEvent) => {
      if (menuRef.current !== null && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  // Discard an in-progress custom status whenever the menu closes.
  useEffect(() => {
    if (!menuOpen) {
      setEditingStatus(false);
    }
  }, [menuOpen]);

  useEffect(() => {
    if (editingStatus) {
      statusInputRef.current?.focus();
    }
  }, [editingStatus]);

  const statusLabel =
    STATUS_OPTIONS.find((option) => option.value === props.ownStatus)?.label ?? "Online";
  const customStatusText = props.customStatus ?? "";
  const hasCustomStatus = customStatusText.trim().length > 0;

  const saveCustomStatus = () => {
    setEditingStatus(false);
    props.onSetCustomStatus?.(statusDraft.trim());
  };

  return (
    <div ref={menuRef} className="relative border-t border-border p-2">
      {menuOpen && (
        <div
          role="menu"
          aria-label="Set your status"
          className="absolute bottom-full left-2 right-2 mb-1 animate-pop-in rounded-[10px] border border-border bg-surface-2 p-1 shadow-xl shadow-black/20"
        >
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={props.ownStatus === option.value}
              onClick={() => {
                props.onSetStatus(option.value);
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-left text-[13px] text-text hover:bg-surface-3"
            >
              <StatusDot status={option.value} />
              <span className="flex-1">{option.label}</span>
              {props.ownStatus === option.value && (
                <Icon name="check" size={14} className="text-accent" />
              )}
            </button>
          ))}
          <div className="my-1 h-px bg-border" />
          {editingStatus ? (
            <div className="px-1 py-0.5">
              <input
                ref={statusInputRef}
                aria-label="Custom status"
                value={statusDraft}
                maxLength={80}
                placeholder="Set a custom status…"
                onChange={(event) => {
                  setStatusDraft(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    saveCustomStatus();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setEditingStatus(false);
                  }
                }}
                onBlur={saveCustomStatus}
                className="h-8 w-full rounded-[7px] border border-border bg-surface-3 px-2 text-[13px] text-text transition placeholder:text-text-muted focus:border-accent focus:outline-none"
              />
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setStatusDraft(customStatusText);
                setEditingStatus(true);
              }}
              className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-left text-[13px] text-text transition hover:bg-surface-3"
            >
              <Icon name="pencil" size={14} className="text-text-muted" />
              <span
                className={cn("min-w-0 flex-1 truncate", !hasCustomStatus && "text-text-muted")}
              >
                {hasCustomStatus ? customStatusText : "Set a custom status…"}
              </span>
              {hasCustomStatus && <Icon name="check" size={14} className="shrink-0 text-accent" />}
            </button>
          )}
        </div>
      )}
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Set your status"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => {
            setMenuOpen((open) => !open);
          }}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left transition hover:bg-surface-3"
        >
          <PresenceAvatar userId={props.ownUserId} size={30} status={props.ownStatus} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-text">
              {props.ownName}
            </span>
            <span className="block truncate text-[11px] text-text-muted">{statusLabel}</span>
          </span>
        </button>
        {props.onOpenUserSettings !== undefined && (
          <HeaderButton
            label={props.appUpdateAvailable ? "User settings (update available)" : "User settings"}
            onClick={props.onOpenUserSettings}
          >
            <span className="relative inline-flex">
              <Icon name="settings" size={17} />
              {props.appUpdateAvailable && (
                <span
                  className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent ring-2 ring-surface-1"
                  role="img"
                  aria-label="Update available"
                />
              )}
            </span>
          </HeaderButton>
        )}
        <HeaderButton
          label="Sign out"
          onClick={() => {
            setConfirmSignOut(true);
          }}
        >
          <Icon name="logout" size={17} />
        </HeaderButton>
      </div>

      <ConfirmDialog
        open={confirmSignOut}
        onClose={() => {
          setConfirmSignOut(false);
        }}
        title={`Sign out of ${props.workspaceName}?`}
        description="You can sign back in at any time."
        confirmLabel="Sign out"
        variant="danger"
        onConfirm={() => {
          setConfirmSignOut(false);
          props.onSignOut();
        }}
      />
    </div>
  );
}

export function StatusDot({ status }: { readonly status: PresenceStatus }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "h-2.5 w-2.5 rounded-full",
        status === "online" && "bg-secondary",
        status === "idle" && "bg-idle",
        status === "dnd" && "bg-danger",
        status === "offline" && "border-2 border-text-muted",
      )}
    />
  );
}
