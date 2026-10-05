import { Button, Heading, Input, Switch, Text } from "@aulora/ui-web";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import type { Callback } from "../callbacks";

type EmailSettings = NonNullable<FunctionReturnType<typeof api.email.settings>>;

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
      <Heading level={3}>Email</Heading>
      <Text tone="muted" size="sm">
        Configure invite delivery. Credentials are encrypted on the server and are never shown
        again.
      </Text>
      <EmailConfigForm current={current} onResult={onResult} />
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

function EmailConfigForm({
  current,
  onResult,
}: {
  readonly current: EmailSettings | undefined;
  readonly onResult: Callback<[status: string | null, error: string | null]>;
}) {
  const update = useMutation(api.email.updateSettings);
  const [provider, setProvider] = useState<"none" | "resend" | "smtp">("none");
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

  return (
    <form
      className="grid gap-4 md:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
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
            onResult(
              null,
              cause instanceof Error ? cause.message : "Could not save email settings.",
            );
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-text">
        Provider
        <select
          value={provider}
          onChange={(event) => {
            setProvider(event.target.value as typeof provider);
          }}
          className="h-10 rounded-[8px] border border-border bg-surface-2 px-3 text-text"
        >
          <option value="none">Disabled</option>
          <option value="resend">Resend</option>
          <option value="smtp">SMTP</option>
        </select>
      </label>
      <Input
        label="From address"
        value={from}
        onChange={(event) => {
          setFrom(event.currentTarget.value);
        }}
        placeholder="Aulora hello@example.com"
        required
      />
      {provider === "resend" && (
        <Input
          label="Resend API key"
          type="password"
          value={resendApiKey}
          onChange={(event) => {
            setResendApiKey(event.currentTarget.value);
          }}
          placeholder={current?.hasResendApiKey ? "Saved key" : "re_..."}
          autoComplete="off"
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
      <div className="md:col-span-2">
        <Button type="submit" loading={busy} disabled={busy || current === undefined}>
          Save email settings
        </Button>
      </div>
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
  const {
    host,
    port,
    user,
    password,
    secure,
    hasPassword,
    onHost,
    onPort,
    onUser,
    onPassword,
    onSecure,
  } = props;
  return (
    <>
      <Input
        label="SMTP host"
        value={host}
        onChange={(event) => {
          onHost(event.currentTarget.value);
        }}
        required
      />
      <Input
        label="SMTP port"
        type="number"
        value={port}
        onChange={(event) => {
          onPort(event.currentTarget.value);
        }}
        required
      />
      <Input
        label="SMTP username"
        value={user}
        onChange={(event) => {
          onUser(event.currentTarget.value);
        }}
        autoComplete="off"
      />
      <SmtpPasswordField value={password} hasPassword={hasPassword} onChange={onPassword} />
      <Switch
        checked={secure}
        onChange={onSecure}
        label="Use TLS immediately"
        description="Enable for port 465. Port 587 uses STARTTLS automatically."
      />
    </>
  );
}

function SmtpPasswordField({
  value,
  hasPassword,
  onChange,
}: {
  readonly value: string;
  readonly hasPassword: boolean;
  readonly onChange: Callback<[value: string]>;
}) {
  return (
    <Input
      label="SMTP password"
      type="password"
      value={value}
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
      placeholder={hasPassword ? "Saved password" : "Optional if server needs no login"}
      autoComplete="new-password"
    />
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
        onChange={(event) => {
          setTo(event.currentTarget.value);
        }}
        autoComplete="off"
      />
      <Button type="submit" loading={busy} disabled={busy || to.trim().length === 0}>
        Send test email
      </Button>
    </form>
  );
}
