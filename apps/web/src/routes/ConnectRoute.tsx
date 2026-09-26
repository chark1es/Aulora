import { useNavigate, useSearch } from "@tanstack/react-router";
import { ConnectScreen } from "../components/ConnectScreen";
import { useProfiles } from "../providers/ProfileProvider";

/** The explicit "add a server" route used by the rail and by `aulora://connect`. */
export function ConnectRoute() {
  const { store, refresh } = useProfiles();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { readonly server?: string | null };
  const initialHost = search.server ?? undefined;

  return (
    <ConnectScreen
      store={store}
      {...(initialHost !== undefined ? { initialHost } : {})}
      onConnected={() => {
        void refresh();
        void navigate({ to: "/" });
      }}
    />
  );
}
