import { NativeBlobatar } from "@aulora/avatars/native";
import {
  joinCodeFailureMessage,
  normalizeInviteCode,
  type RedeemOutcome,
  redeemOutcomeMessage,
} from "@aulora/core";
import { Button, Heading, Input, Spinner, Text } from "@aulora/ui-native";
import { useMutation, useQuery } from "convex/react";
import { useState, useSyncExternalStore } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../../../../packages/convex/convex/_generated/api";
import {
  clearPendingInvite,
  getPendingInvite,
  subscribePendingInvite,
} from "../lib/pending-invite";
import { AuthScaffold } from "./AuthScaffold";

export interface JoinGateProps {
  readonly workspaceIconSeed: string;
  readonly signedInAs: string | null;
  readonly onSignOut: () => void;
  /** Permanently deletes the signed-in account, even without workspace membership. */
  readonly onDeleteAccount: () => void | Promise<void>;
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.length > 0 ? cause.message : fallback;
}

/**
 * Shown to a signed-in account that is not a member yet: enter an invite code
 * or link, or join straight away when an admin pre-approved the address.
 * Membership is reactive, so the chat appears the moment a join lands.
 */
export function JoinGate({
  workspaceIconSeed,
  signedInAs,
  onSignOut,
  onDeleteAccount,
}: JoinGateProps) {
  const status = useQuery(api.joinAccess.status, {});
  if (status === undefined) {
    return (
      <View className="flex-1 items-center justify-center">
        <Spinner size={28} label="Checking your access" />
      </View>
    );
  }
  const subtitle = status.banned
    ? "You can’t join this workspace."
    : status.inviteOnly
      ? "This workspace is invite only. Enter your invite to continue."
      : "You’re signed in. Join to get started.";
  const confirmDeleteAccount = () => {
    Alert.alert(
      "Delete your account?",
      "This permanently deletes your account, profile, sessions, and notification settings. Messages you sent stay in the workspace for other members. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete account",
          style: "destructive",
          onPress: () => {
            void Promise.resolve(onDeleteAccount()).catch((cause: unknown) => {
              Alert.alert("Couldn't delete account", errorMessage(cause, "Try again in a moment."));
            });
          },
        },
      ],
    );
  };
  return (
    <SafeAreaView className="flex-1" edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <AuthScaffold
            seed={workspaceIconSeed}
            aura={
              <NativeBlobatar seed={workspaceIconSeed} size={96} title={status.workspaceName} />
            }
          >
            <JoinHeader
              workspaceName={status.workspaceName}
              subtitle={subtitle}
              signedInAs={signedInAs}
            />
            {!status.banned && <JoinOptions status={status} />}
            <View className="gap-2">
              <Button variant="ghost" onPress={onSignOut}>
                Sign out
              </Button>
              <Button variant="ghost" onPress={confirmDeleteAccount}>
                Delete account
              </Button>
            </View>
          </AuthScaffold>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

interface JoinHeaderProps {
  readonly workspaceName: string;
  readonly subtitle: string;
  readonly signedInAs: string | null;
}

function JoinHeader({ workspaceName, subtitle, signedInAs }: JoinHeaderProps) {
  return (
    <View className="gap-2">
      <Heading level={1}>Join {workspaceName}</Heading>
      <Text size="base" tone="muted" className="leading-relaxed">
        {subtitle}
      </Text>
      {signedInAs !== null && (
        <Text size="xs" tone="muted" mono numberOfLines={1} ellipsizeMode="tail">
          {signedInAs}
        </Text>
      )}
    </View>
  );
}

interface JoinOptionsProps {
  readonly status: {
    readonly inviteOnly: boolean;
    readonly allowlisted: boolean;
    readonly emailVerified: boolean;
    readonly emailHint: string | null;
    readonly canEmailCode: boolean;
  };
}

function JoinOptions({ status }: JoinOptionsProps) {
  return (
    <View className="gap-6">
      {status.allowlisted && (
        <AllowlistJoin
          emailHint={status.emailHint}
          emailVerified={status.emailVerified}
          canEmailCode={status.canEmailCode}
        />
      )}
      {status.inviteOnly ? <CodeEntry /> : <OpenJoin />}
    </View>
  );
}

function CodeEntry() {
  const redeem = useMutation(api.invites.redeem);
  const pendingFromLink = useSyncExternalStore(subscribePendingInvite, getPendingInvite);
  const [typed, setTyped] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = typed ?? pendingFromLink ?? "";
  const ready = normalizeInviteCode(value).length >= 8;
  const errorProps = error !== null ? { error } : {};

  const submit = async () => {
    if (!ready || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const outcome: RedeemOutcome = await redeem({ code: value });
      if (outcome.joined) {
        clearPendingInvite();
      } else {
        setError(redeemOutcomeMessage(outcome));
      }
    } catch (cause) {
      setError(errorMessage(cause, "That invite could not be redeemed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="gap-3">
      <Input
        size="lg"
        label="Invite code or link"
        placeholder="ABCD-EFGH-JKMN"
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        value={value}
        onChangeText={setTyped}
        hint="Paste the link you were sent, or type the code."
        {...errorProps}
      />
      <Button size="lg" loading={busy} disabled={!ready || busy} onPress={() => void submit()}>
        Join workspace
      </Button>
    </View>
  );
}

function ErrorLine({ message }: { readonly message: string | null }) {
  if (message === null) {
    return null;
  }
  return (
    <Text size="sm" tone="danger" accessibilityRole="alert">
      {message}
    </Text>
  );
}

function OpenJoin() {
  const join = useMutation(api.joinAccess.joinOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <View className="gap-3">
      <ErrorLine message={error} />
      <Button
        size="lg"
        loading={busy}
        disabled={busy}
        onPress={() => {
          setBusy(true);
          setError(null);
          join({})
            .catch((cause: unknown) => {
              setError(errorMessage(cause, "Could not join."));
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        Join workspace
      </Button>
    </View>
  );
}

interface AllowlistJoinProps {
  readonly emailHint: string | null;
  readonly emailVerified: boolean;
  readonly canEmailCode: boolean;
}

function AllowlistJoin({ emailHint, emailVerified, canEmailCode }: AllowlistJoinProps) {
  return (
    <View className="gap-3 rounded-2xl border border-border bg-surface-2 p-4">
      <View className="gap-0.5">
        <Text size="sm" className="font-medium">
          You’re pre-approved
        </Text>
        <Text size="xs" tone="muted">
          {emailHint ?? "Your address"} is on this workspace’s allowlist.
        </Text>
      </View>
      {emailVerified ? <DirectJoin /> : <EmailedCode canEmailCode={canEmailCode} />}
    </View>
  );
}

function DirectJoin() {
  const join = useMutation(api.joinAccess.joinAllowlisted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <View className="gap-2">
      {error !== null && (
        <Text size="sm" tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      )}
      <Button
        loading={busy}
        disabled={busy}
        onPress={() => {
          setBusy(true);
          setError(null);
          join({})
            .catch((cause: unknown) => {
              setError(errorMessage(cause, "Could not join."));
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        Join workspace
      </Button>
    </View>
  );
}

function EmailedCode({ canEmailCode }: { readonly canEmailCode: boolean }) {
  const requestCode = useMutation(api.joinAccess.requestCode);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canEmailCode) {
    return (
      <Text size="xs" tone="muted">
        We can’t email a verification code from this server. Ask an admin for an invite link.
      </Text>
    );
  }
  return (
    <View className="gap-3">
      <Text size="xs" tone="muted">
        {sent
          ? "We emailed you a six-digit code. It expires in 10 minutes."
          : "Confirm it’s your address with a one-time code we email you."}
      </Text>
      {sent && <VerifyForm />}
      {error !== null && (
        <Text size="sm" tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      )}
      <Button
        variant={sent ? "ghost" : "primary"}
        loading={busy}
        disabled={busy}
        onPress={() => {
          setBusy(true);
          setError(null);
          requestCode({})
            .then(() => {
              setSent(true);
            })
            .catch((cause: unknown) => {
              setError(errorMessage(cause, "Could not send a code."));
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        {sent ? "Send a new code" : "Email me a code"}
      </Button>
    </View>
  );
}

function VerifyForm() {
  const verify = useMutation(api.joinAccess.verifyCode);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = /^\d{6}$/.test(code);
  const errorProps = error !== null ? { error } : {};

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await verify({ code });
      if (!result.joined) {
        setError(joinCodeFailureMessage(result.reason));
      }
    } catch (cause) {
      setError(errorMessage(cause, "That code did not work."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="gap-2">
      <Input
        label="Verification code"
        keyboardType="number-pad"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="123456"
        value={code}
        onChangeText={(next) => {
          setCode(next.replace(/\D/g, ""));
        }}
        {...errorProps}
      />
      <Button loading={busy} disabled={!ready || busy} onPress={() => void submit()}>
        Verify and join
      </Button>
    </View>
  );
}
