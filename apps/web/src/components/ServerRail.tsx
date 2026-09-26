import { Avatar } from "@aulora/avatars";
import { IconButton, Logo } from "@aulora/ui-web";
import { useNavigate } from "@tanstack/react-router";
import { useProfiles } from "../providers/ProfileProvider";
import { ThemeToggle } from "./ThemeToggle";

/** Discord-style rail: the Aulora mark, saved servers, add and theme. */
export function ServerRail() {
  const { profiles, activeProfile, setActive } = useProfiles();
  const navigate = useNavigate();

  return (
    <nav
      aria-label="Servers"
      className="sticky top-0 flex h-screen w-16 shrink-0 flex-col items-center gap-2 border-r border-border bg-surface-1 py-3"
    >
      <IconButton label="Aulora home" variant="ghost" onClick={() => void navigate({ to: "/" })}>
        <Logo size={28} />
      </IconButton>
      <div className="flex flex-1 flex-col items-center gap-2 overflow-y-auto py-1">
        {profiles.map((profile) => {
          const active = activeProfile?.id === profile.id;
          return (
            <div key={profile.id} className="relative flex items-center">
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute -left-3 h-6 w-1 rounded-pill bg-accent"
                />
              )}
              <IconButton
                label={`Open ${profile.name}`}
                variant={active ? "secondary" : "ghost"}
                onClick={() => {
                  void setActive(profile.id);
                  void navigate({ to: "/" });
                }}
              >
                <Avatar seed={profile.iconSeed} size={34} />
              </IconButton>
            </div>
          );
        })}
      </div>
      <IconButton
        label="Add a server"
        variant="secondary"
        onClick={() => void navigate({ to: "/connect" })}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none">
          <path
            d="M12 5v14M5 12h14"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </IconButton>
      <ThemeToggle />
    </nav>
  );
}
