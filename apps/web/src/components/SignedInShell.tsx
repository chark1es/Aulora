import { Avatar, userAvatarSeed } from "@aulora/avatars";
import { Button, Card, Heading, Text } from "@aulora/ui-web";

export interface SignedInUser {
  readonly id: string;
  readonly email?: string;
  readonly name?: string;
}

export interface SignedInShellProps {
  readonly profileName: string;
  readonly user: SignedInUser;
  readonly onSignOut: () => void;
}

/** Minimal post-auth shell: workspace, avatar, email and sign out. */
export function SignedInShell({ profileName, user, onSignOut }: SignedInShellProps) {
  return (
    <div className="mx-auto w-full max-w-md p-6">
      <Card className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <Avatar
            seed={userAvatarSeed(user.id)}
            size={48}
            title={user.name ?? user.email ?? "You"}
          />
          <div className="flex flex-col">
            <Heading level={3}>{user.name ?? "Signed in"}</Heading>
            <Text tone="muted" size="sm">
              {user.email ?? "No email on this account"}
            </Text>
          </div>
        </div>
        <Text tone="secondary" size="sm">
          Connected to {profileName}. Channel and message features arrive in the next phase.
        </Text>
        <Button variant="secondary" onClick={onSignOut}>
          Sign out
        </Button>
      </Card>
    </div>
  );
}
