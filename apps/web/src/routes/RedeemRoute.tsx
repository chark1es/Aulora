import { Button, Card, Heading, Spinner, Text } from "@aulora/ui-web";
import { useNavigate, useParams } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { parseInviteCode } from "../lib/invites";
import { useProfiles } from "../providers/ProfileProvider";

// Redeeming pulls in the whole signed-out session gate (and its sign-in screen),
// which no other route needs once the workspace is joined. An invite link is a
// rare entry point, so its session surface loads after the route resolves.
const RedeemSession = lazy(() =>
  import("../components/admin/RedeemScreen").then((module) => ({ default: module.RedeemSession })),
);

/** `/invite/:code` — accepts an invite for the active server profile. */
export function RedeemRoute() {
  const { activeProfile } = useProfiles();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { readonly code?: string };
  const code = parseInviteCode(params.code);

  if (code === null) {
    return (
      <div className="mx-auto w-full max-w-md p-6">
        <Card>
          <Heading level={2}>Invalid invite</Heading>
          <Text tone="muted" size="sm">
            This invite link is missing its code.
          </Text>
        </Card>
      </div>
    );
  }

  if (activeProfile === undefined) {
    return (
      <div className="mx-auto w-full max-w-md p-6">
        <Card className="flex flex-col gap-4">
          <Heading level={2}>Connect first</Heading>
          <Text tone="muted" size="sm">
            Connect to the server this invite belongs to, then open the link again.
          </Text>
          <Button onClick={() => void navigate({ to: "/connect" })}>Connect to a server</Button>
        </Card>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="pane flex flex-1 items-center justify-center">
          <Spinner size={28} label="Loading invite" />
        </div>
      }
    >
      <RedeemSession
        profile={activeProfile}
        code={code}
        onDone={() => void navigate({ to: "/" })}
      />
    </Suspense>
  );
}
