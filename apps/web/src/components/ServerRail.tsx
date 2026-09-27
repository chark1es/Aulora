import { Avatar } from "@aulora/avatars";
import { type ContextMenuItem, cn, Icon, Logo, useContextMenu } from "@aulora/ui-web";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useProfiles } from "../providers/ProfileProvider";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The server rail. It only appears when a person has joined more than one
 * workspace — with a single workspace there is nothing to switch between, so
 * the {@link WorkspaceMenu} in the sidebar header carries everything instead.
 */
export function ServerRail() {
  const { profiles, activeProfile, setActive } = useProfiles();
  const navigate = useNavigate();
  const openMenu = useContextMenu();

  if (profiles.length <= 1) {
    return null;
  }

  const railMenu = (profileId: string, name: string, event: React.MouseEvent) => {
    event.preventDefault();
    const items: ContextMenuItem[] = [
      {
        id: "open",
        label: "Open workspace",
        icon: <Icon name="message" size={14} />,
        onSelect: () => {
          void setActive(profileId);
          void navigate({ to: "/" });
        },
      },
      {
        id: "reload",
        label: "Reload",
        icon: <Icon name="arrow-down" size={14} />,
        onSelect: () => window.location.reload(),
      },
    ];
    openMenu({
      clientX: event.clientX,
      clientY: event.clientY,
      items,
      label: name,
    });
  };

  return (
    <nav
      aria-label="Servers"
      className="desktop-vibrancy flex w-[64px] shrink-0 flex-col items-center gap-2 bg-rail py-3 text-rail-text"
    >
      <button
        type="button"
        aria-label="Aulora home"
        onClick={() => void navigate({ to: "/" })}
        className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-accent text-on-accent transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-accent/70"
      >
        <Logo
          size={22}
          className="[&_.fill-accent]:fill-on-accent [&_.fill-on-accent]:fill-accent"
        />
      </button>

      <span aria-hidden="true" className="h-px w-7 bg-white/10" />

      <div className="flex w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto py-0.5">
        {profiles.map((profile) => (
          <RailItem
            key={profile.id}
            label={`Open ${profile.name}`}
            tooltip={profile.name}
            active={activeProfile?.id === profile.id}
            onClick={() => {
              void setActive(profile.id);
              void navigate({ to: "/" });
            }}
            onContextMenu={(event) => railMenu(profile.id, profile.name, event)}
          >
            <Avatar seed={profile.iconSeed} size={40} shape="squircle" />
          </RailItem>
        ))}
        <RailItem
          label="Add a server"
          tooltip="Add a server"
          onClick={() => void navigate({ to: "/connect" })}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-dashed border-white/25 text-rail-text transition group-hover:border-accent group-hover:text-accent">
            <Icon name="plus" size={18} />
          </span>
        </RailItem>
      </div>

      <ThemeToggle />
    </nav>
  );
}

function RailItem({
  label,
  tooltip,
  active = false,
  onClick,
  onContextMenu,
  children,
}: {
  readonly label: string;
  readonly tooltip: string;
  readonly active?: boolean;
  readonly onClick: () => void;
  readonly onContextMenu?: (event: React.MouseEvent) => void;
  readonly children: ReactNode;
}) {
  return (
    <div className="group relative flex w-full justify-center">
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-1 top-1/2 w-[3px] -translate-y-1/2 rounded-full bg-accent transition-all",
          active ? "h-5" : "h-0 group-hover:h-2.5",
        )}
      />
      <button
        type="button"
        aria-label={label}
        aria-current={active ? "true" : undefined}
        title={tooltip}
        onClick={onClick}
        onContextMenu={onContextMenu}
        className={cn(
          "rounded-[12px] p-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          active ? "bg-white/10" : "opacity-75 hover:bg-white/5 hover:opacity-100",
        )}
      >
        {children}
      </button>
    </div>
  );
}
