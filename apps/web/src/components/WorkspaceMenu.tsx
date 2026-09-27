import { Avatar } from "@aulora/avatars";
import { cn, Icon } from "@aulora/ui-web";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useProfiles } from "../providers/ProfileProvider";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The workspace menu: shows every joined server, switches the active one, and
 * adds a new server. It lives in the sidebar header so a person with a single
 * workspace never sees a rail built for many. Also carries the theme control.
 */
export function WorkspaceMenu() {
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
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const multiple = profiles.length > 1;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Workspace menu"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-[7px] text-text-muted transition hover:bg-surface-3 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        )}
      >
        <Icon name="more-vertical" size={17} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Workspaces"
          className="absolute right-0 top-[calc(100%+6px)] z-40 w-[260px] animate-pop-in overflow-hidden rounded-[10px] border border-border bg-surface-2 p-1 shadow-2xl shadow-black/25"
        >
          <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            {multiple ? "Workspaces" : "Workspace"}
          </p>
          {profiles.map((profile) => {
            const active = activeProfile?.id === profile.id;
            return (
              <button
                key={profile.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setOpen(false);
                  void setActive(profile.id);
                  void navigate({ to: "/" });
                }}
                className="flex w-full items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left transition hover:bg-surface-3"
              >
                <Avatar seed={profile.iconSeed} size={26} shape="squircle" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-text">
                    {profile.name}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-text-muted">
                    {new URL(profile.baseUrl).host}
                  </span>
                </span>
                {active && <Icon name="check" size={14} className="text-accent" />}
              </button>
            );
          })}

          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void navigate({ to: "/connect" });
            }}
            className="flex w-full items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left text-[13px] text-text transition hover:bg-surface-3"
          >
            <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[8px] border border-dashed border-border text-text-muted">
              <Icon name="plus" size={14} />
            </span>
            Add a workspace
          </button>

          <div className="my-1 h-px bg-border" />
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
            <span className="text-[13px] text-text">Appearance</span>
            <ThemeToggle variant="inline" />
          </div>
        </div>
      )}
    </div>
  );
}
