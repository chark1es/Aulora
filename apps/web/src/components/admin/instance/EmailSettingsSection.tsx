import { Button, Input, Select, Switch, Text } from "@aulora/ui-web";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import type { Callback } from "../callbacks";
import { SaveRow } from "../SettingsSaveRow";
import { SettingsSectionHeader } from "../SettingsSection";

type EmailSettings = NonNullable<FunctionReturnType<typeof api.email.settings>>;
type EmailProvider = "none" | "resend" | "smtp";

const PROVIDER_OPTIONS: readonly { readonly value: EmailProvider; readonly label: string }[] = [
  { value: "none", label: "Disabled" },
  { value: "resend", label: "Resend" },
  { value: "smtp", label: "SMTP" },
];

export function EmailSection() {
  const current = useQuery(api.email.settings, {});
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onResult = (nextStatus: string | null, nextError: string | null) => {
    setStatus(nextStatus);
    setError(nextError);
  };

  return (
    <section className="flex flex-col gap-4" data-testid="instance-email">
      <SettingsSectionHeader
        icon="mail"
        title="Email"
        description="Configure invite delivery. Credentials are encrypted on the server and are never shown again."
      />
      {current === undefined ? (
        <EmailConfigForm onResult={onResult} />
      ) : (
        <EmailConfigForm current={current} onResult={onResult} />
      )}
      <EmailTestForm onResult={onResult} />
      {status !== null && (
        <Text tone="secondary" size="sm" role="status">
          {status}
        </Text>
      )}
      {error !== null && (
        <Text tone="danger" size="sm" role="alert">
          {error}
        </Text>
      )}
    </section>
  );
}

interface EmailDraft {
  readonly provider: EmailProvider;
  readonly from: string;
  readonly smtpHost: string;
  readonly smtpPort: string;
  readonly smtpSecure: boolean;
  readonly smtpUser: string;
  readonly resendApiKey: string;
  readonly smtpPassword: string;
}

function emailDirty(draft: EmailDraft, current?: EmailSettings): boolean {
  if (current === undefined) {
    return false;
  }
  return (
    draft.provider !== current.provider ||
    draft.from !== current.from ||
    draft.smtpHost !== current.smtpHost ||
    draft.smtpPort !== String(current.smtpPort) ||
    draft.smtpSecure !== current.smtpSecure ||
    draft.smtpUser !== current.smtpUser ||
    draft.resendApiKey.length > 0 ||
    draft.smtpPassword.length > 0
  );
}

function EmailConfigForm({
  current,
  onResult,
}: {
  readonly current?: EmailSettings;
  readonly onResult: Callback<[status: string | null, error: string | null]>;
}) {
  const update = useMutation(api.email.updateSettings);
  const [provider, setProvider] = useState<EmailProvider>("none");
  const [from, setFrom] = useState("");
  const [resendApiKey, setResendApiKey] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (current === undefined) return;
    setProvider(current.provider);
    setFrom(current.from);
    setSmtpHost(current.smtpHost);
    setSmtpPort(String(current.smtpPort));
    setSmtpSecure(current.smtpSecure);
    setSmtpUser(current.smtpUser);
  }, [current]);

  const dirty = emailDirty(
    { provider, from, smtpHost, smtpPort, smtpSecure, smtpUser, resendApiKey, smtpPassword },
    current,
  );

  function submit(): void {
    onResult(null, null);
    setBusy(true);
    void update({
      provider,
      from,
      ...(resendApiKey ? { resendApiKey } : {}),
      smtpHost,
      smtpPort: Number(smtpPort),
      smtpSecure,
      smtpUser,
      ...(smtpPassword ? { smtpPassword } : {}),
    })
      .then(() => {
        setResendApiKey("");
        setSmtpPassword("");
        onResult("Email settings saved. Send a test message to verify delivery.", null);
      })
      .catch((cause: unknown) => {
        onResult(null, cause instanceof Error ? cause.message : "Could not save email settings.");
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Provider"
          value={provider}
          options={PROVIDER_OPTIONS}
          onChange={(next) => {
            setProvider(next);
            onResult(null, null);
          }}
        />
        <Input
          label="From address"
          value={from}
          placeholder="Aulora hello@example.com"
          required
          onChange={(event) => {
            setFrom(event.currentTarget.value);
          }}
        />
        {provider === "resend" && (
          <Input
            label="Resend API key"
            type="password"
            value={resendApiKey}
            placeholder={current?.hasResendApiKey ? "Saved key" : "re_..."}
            autoComplete="off"
            onChange={(event) => {
              setResendApiKey(event.currentTarget.value);
            }}
          />
        )}
        {provider === "smtp" && (
          <SmtpFields
            host={smtpHost}
            port={smtpPort}
            user={smtpUser}
            password={smtpPassword}
            secure={smtpSecure}
            hasPassword={current?.hasSmtpPassword ?? false}
            onHost={setSmtpHost}
            onPort={setSmtpPort}
            onUser={setSmtpUser}
            onPassword={setSmtpPassword}
            onSecure={setSmtpSecure}
          />
        )}
      </div>
      <SaveRow busy={busy} dirty={dirty} saved={false} error={null} />
    </form>
  );
}

interface SmtpFieldsProps {
  readonly host: string;
  readonly port: string;
  readonly user: string;
  readonly password: string;
  readonly secure: boolean;
  readonly hasPassword: boolean;
  readonly onHost: Callback<[value: string]>;
  readonly onPort: Callback<[value: string]>;
  readonly onUser: Callback<[value: string]>;
  readonly onPassword: Callback<[value: string]>;
  readonly onSecure: Callback<[value: boolean]>;
}

function SmtpFields(props: SmtpFieldsProps) {
  const { host, port, user, password, secure, hasPassword } = props;
  return (
    <>
      <Input
        label="SMTP host"
        value={host}
        required
        onChange={(event) => {
          props.onHost(event.currentTarget.value);
        }}
      />
      <Input
        label="SMTP port"
        type="number"
        value={port}
        required
        onChange={(event) => {
          props.onPort(event.currentTarget.value);
        }}
      />
      <Input
        label="SMTP username"
        value={user}
        autoComplete="off"
        onChange={(event) => {
          props.onUser(event.currentTarget.value);
        }}
      />
      <Input
        label="SMTP password"
        type="password"
        value={password}
        placeholder={hasPassword ? "Saved password" : "Optional if server needs no login"}
        autoComplete="new-password"
        onChange={(event) => {
          props.onPassword(event.currentTarget.value);
        }}
      />
      <Switch
        checked={secure}
        onChange={props.onSecure}
        label="Use TLS immediately"
        description="Enable for port 465. Port 587 uses STARTTLS automatically."
      />
    </>
  );
}

function EmailTestForm({
  onResult,
}: {
  readonly onResult: Callback<[status: string | null, error: string | null]>;
}) {
  const sendTest = useAction(api.email.sendTest);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="flex flex-wrap items-end gap-3 border-t border-border pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        onResult(null, null);
        setBusy(true);
        void sendTest({ to: to.trim() })
          .then((result) => {
            onResult(
              result.sent
                ? "Test email sent."
                : "Delivery failed. Check the provider settings and server logs.",
              null,
            );
          })
          .catch((cause: unknown) => {
            onResult(
              null,
              cause instanceof Error ? cause.message : "Could not send the test email.",
            );
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <Input
        label="Send a test email to"
        type="email"
        placeholder="you@example.com"
        value={to}
        autoComplete="off"
        onChange={(event) => {
          setTo(event.currentTarget.value);
        }}
      />
      <Button type="submit" loading={busy} disabled={busy || to.trim().length === 0}>
        Send test email
      </Button>
    </form>
  );
}
