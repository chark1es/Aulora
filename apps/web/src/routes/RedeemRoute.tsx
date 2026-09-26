import { Button, Card, Heading, Text } from "@aulora/ui-web";
import { useNavigate, useParams } from "@tanstack/react-router";
import { RedeemSession } from "../components/admin/RedeemScreen";
import { parseInviteCode } from "../lib/invites";
import { useProfiles } from "../providers/ProfileProvider";

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
    <RedeemSession profile={activeProfile} code={code} onDone={() => void navigate({ to: "/" })} />
  );
}
