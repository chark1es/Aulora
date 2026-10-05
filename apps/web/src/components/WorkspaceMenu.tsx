import { Avatar } from "@aulora/avatars";
import type { ServerProfile } from "@aulora/core";
import { cn, Icon } from "@aulora/ui-web";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useProfiles } from "../providers/ProfileProvider";
import { ThemeToggle } from "./ThemeToggle";

/** A value that may be unset, without spelling out a union at each use. */
type Maybe<T> = T | undefined;

export interface WorkspaceMenuProps {
  /** Live member count for the header trigger's "N online" line. */
  readonly onlineCount?: number;
  /** `header` (identity trigger) or `compact` (name-only, pre-session). */
  readonly variant?: "header" | "compact";
  /** Which edge the dropdown aligns to; defaults to the trigger's own edge. */
  readonly align?: "left" | "right";
}

/**
 * The workspace switcher: the workspace name itself is the trigger, opening a
 * menu of every joined server with the active one checked, an "Add a workspace"
 * action, and the appearance control. Rendered in the sidebar header
 * (`variant="header"`) and on the pre-session screens (`variant="compact"`).
 */
export function WorkspaceMenu({ onlineCount, variant = "header", align }: WorkspaceMenuProps) {
  const { profiles, activeProfile, setActive } = useProfiles();
  const navigate = useNavigate();
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
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const resolvedAlign = align ?? (variant === "header" ? "left" : "right");
  const multiple = profiles.length > 1;
  const name = activeProfile?.name ?? "Choose a workspace";
  const toggle = () => {
    setOpen((value) => !value);
  };
  const pick = (profileId: string) => {
    setOpen(false);
    void setActive(profileId);
    void navigate({ to: "/" });
  };
  const addWorkspace = () => {
    setOpen(false);
    void navigate({ to: "/connect" });
  };

  return (
    <div ref={ref} className="relative min-w-0">
      {variant === "header" ? (
        <WorkspaceHeaderTrigger
          activeProfile={activeProfile}
          name={name}
          onlineCount={onlineCount}
          open={open}
          onToggle={toggle}
        />
      ) : (
        <WorkspaceCompactTrigger
          activeProfile={activeProfile}
          name={name}
          open={open}
          onToggle={toggle}
        />
      )}

      {open && (
        <WorkspaceMenuPanel
          profiles={profiles}
          activeProfile={activeProfile}
          multiple={multiple}
          align={resolvedAlign}
          onPick={pick}
          onAddWorkspace={addWorkspace}
        />
      )}
    </div>
  );
}

function WorkspaceHeaderTrigger({
  activeProfile,
  name,
  onlineCount,
  open,
  onToggle,
}: {
  readonly activeProfile: Maybe<ServerProfile>;
  readonly name: string;
  readonly onlineCount: number | undefined;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label="Workspace menu"
      onClick={onToggle}
      className="flex w-full min-w-0 items-center gap-2.5 rounded-[8px] px-1 py-1.5 text-left transition hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {activeProfile !== undefined ? (
        <Avatar seed={activeProfile.iconSeed} size={32} shape="squircle" />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-dashed border-border text-text-muted">
          <Icon name="plus" size={16} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold tracking-[-0.01em] text-text">
          {name}
        </span>
        {activeProfile !== undefined && (
          <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-secondary" aria-hidden="true" />
            {onlineCount ?? 0} online
          </span>
        )}
      </span>
      <Icon name="chevron-down" size={16} className="shrink-0 text-text-muted" />
    </button>
  );
}

function WorkspaceCompactTrigger({
  activeProfile,
  name,
  open,
  onToggle,
}: {
  readonly activeProfile: Maybe<ServerProfile>;
  readonly name: string;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label="Workspace menu"
      onClick={onToggle}
      className="flex max-w-[240px] min-w-0 items-center gap-2 rounded-[9px] border border-border bg-surface-2/90 px-2 py-1.5 text-left shadow-sm backdrop-blur transition hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {activeProfile !== undefined ? (
        <Avatar seed={activeProfile.iconSeed} size={22} shape="squircle" />
      ) : (
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] border border-dashed border-border text-text-muted">
          <Icon name="plus" size={13} />
        </span>
      )}
      <span className="truncate text-[13px] font-semibold text-text">{name}</span>
      <Icon name="chevron-down" size={15} className="shrink-0 text-text-muted" />
    </button>
  );
}

function WorkspaceMenuPanel({
  profiles,
  activeProfile,
  multiple,
  align,
  onPick,
  onAddWorkspace,
}: {
  readonly profiles: readonly ServerProfile[];
  readonly activeProfile: Maybe<ServerProfile>;
  readonly multiple: boolean;
  readonly align: "left" | "right";
  readonly onPick: (profileId: string) => void;
  readonly onAddWorkspace: () => void;
}) {
  return (
    <div
      role="menu"
      aria-label="Workspaces"
      className={cn(
        "absolute top-[calc(100%+6px)] z-40 w-[260px] animate-pop-in overflow-hidden rounded-[10px] border border-border bg-surface-2 p-1 shadow-2xl shadow-black/25",
        align === "right" ? "right-0" : "left-0",
      )}
    >
      <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
        {multiple ? "Workspaces" : "Workspace"}
      </p>
      {profiles.map((profile) => (
        <WorkspaceMenuItem
          key={profile.id}
          profile={profile}
          active={activeProfile?.id === profile.id}
          onPick={onPick}
        />
      ))}
      <div className="my-1 h-px bg-border" />
      <WorkspaceAddButton onAddWorkspace={onAddWorkspace} />
      <div className="my-1 h-px bg-border" />
      <WorkspaceAppearanceRow />
    </div>
  );
}

function WorkspaceMenuItem({
  profile,
  active,
  onPick,
}: {
  readonly profile: ServerProfile;
  readonly active: boolean;
  readonly onPick: (profileId: string) => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      onClick={() => onPick(profile.id)}
      className="flex w-full items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left transition hover:bg-surface-3"
    >
      <Avatar seed={profile.iconSeed} size={26} shape="squircle" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-text">{profile.name}</span>
        <span className="block truncate font-mono text-[10px] text-text-muted">
          {new URL(profile.baseUrl).host}
        </span>
      </span>
      {active && <Icon name="check" size={14} className="text-accent" />}
    </button>
  );
}

function WorkspaceAddButton({ onAddWorkspace }: { readonly onAddWorkspace: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onAddWorkspace}
      className="flex w-full items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left text-[13px] text-text transition hover:bg-surface-3"
    >
      <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[8px] border border-dashed border-border text-text-muted">
        <Icon name="plus" size={14} />
      </span>
      Add a workspace
    </button>
  );
}

function WorkspaceAppearanceRow() {
  return (
    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
      <span className="text-[13px] text-text">Appearance</span>
      <ThemeToggle variant="inline" />
    </div>
  );
}
