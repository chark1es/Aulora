import { Button, Spinner } from "@aulora/ui-web";
import { useState } from "react";
import { GuestCallPage } from "../components/guest/GuestCallPage";
import { GuestMessageScreen } from "../components/guest/GuestMessageScreen";
import { useGuestConnection } from "../components/guest/use-guest-connection";
import { useGuestPageMeta } from "../components/guest/use-guest-page-meta";
import { peekGuestLinkToken } from "../lib/guest/early-fragment";

/**
 * `/call/guest#<token>`: the page a guest opens from an invite link. It is
 * unauthenticated and outside the signed-in shell: no profile, no session, no
 * Better Auth. The token was lifted out of the address bar before the router
 * started (see `early-fragment`), so it is not in the URL, the history or any
 * `Referer`.
 */
export function GuestCallRoute() {
  useGuestPageMeta();
  const [attempt, setAttempt] = useState(0);
  const connection = useGuestConnection(attempt);
  const linkToken = peekGuestLinkToken();

  if (connection.status === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg">
        <Spinner size={28} label="Connecting" />
      </div>
    );
  }
  if (connection.status === "error") {
    return (
      <GuestMessageScreen
        icon="signal"
        title="Can't reach the server"
        action={
          <Button
            onClick={() => {
              setAttempt((count) => count + 1);
            }}
          >
            Try again
          </Button>
        }
      >
        Check your connection and try again.
      </GuestMessageScreen>
    );
  }
  return (
    <GuestCallPage
      client={connection.client}
      convexUrl={connection.convexUrl}
      linkToken={linkToken}
    />
  );
}
