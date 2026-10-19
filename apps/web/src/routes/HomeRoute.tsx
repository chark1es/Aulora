import { Spinner } from "@aulora/ui-web";
import { lazy, Suspense } from "react";
import { ConnectScreen } from "../components/ConnectScreen";
import { useProfiles } from "../providers/ProfileProvider";

// The better-auth + Convex provider wiring (and its ~80 kB of client deps) is
// only needed once a server profile is active, so keep it off the connect path.
const ProfileSession = lazy(() =>
  import("../components/ProfileSession").then((module) => ({ default: module.ProfileSession })),
);

/** Index: connect when no server is active, otherwise the server session. */
export function HomeRoute() {
  const { activeProfile, store, ready, refresh } = useProfiles();

  if (!ready) {
    return (
      <div className="pane flex flex-1 items-center justify-center">
        <Spinner size={28} label="Loading servers" />
      </div>
    );
  }

  if (activeProfile === undefined) {
    return (
      <ConnectScreen
        store={store}
        onConnected={() => {
          void refresh();
        }}
      />
    );
  }

  return (
    <Suspense
      fallback={
        <div className="pane flex flex-1 items-center justify-center">
          <Spinner size={28} label="Loading server" />
        </div>
      }
    >
      <ProfileSession profile={activeProfile} />
    </Suspense>
  );
}
