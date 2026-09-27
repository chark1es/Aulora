import { Spinner } from "@aulora/ui-web";
import { ConnectScreen } from "../components/ConnectScreen";
import { ProfileSession } from "../components/ProfileSession";
import { useProfiles } from "../providers/ProfileProvider";

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

  return <ProfileSession profile={activeProfile} />;
}
