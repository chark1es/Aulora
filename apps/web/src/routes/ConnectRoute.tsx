import { useNavigate } from "@tanstack/react-router";
import { ConnectScreen } from "../components/ConnectScreen";
import { useProfiles } from "../providers/ProfileProvider";

/** The explicit "add a server" route used by the rail. */
export function ConnectRoute() {
  const { store, refresh } = useProfiles();
  const navigate = useNavigate();

  return (
    <ConnectScreen
      store={store}
      onConnected={() => {
        void refresh();
        void navigate({ to: "/" });
      }}
    />
  );
}
