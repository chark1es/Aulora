import {
  clampRetentionDays,
  DEFAULT_SUMMARY_MODEL,
  OPENROUTER_BASE_URL,
  TRANSCRIPTION_MAX_RETENTION_DAYS,
  type TranscriptionModelStatus,
  type TranscriptionProvider,
} from "@aulora/core";
import {
  Button,
  ConfirmDialog,
  Icon,
  Input,
  SegmentedControl,
  Select,
  Spinner,
  Switch,
  Text,
} from "@aulora/ui-web";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { SettingsGroup, SettingsGroupRow } from "./SettingsGroup";
import { SaveRow } from "./SettingsSaveRow";
import {
  downloadNotice,
  draftFromConfig,
  draftIsDirty,
  endpointProblem,
  type KeyMode,
  MODEL_DESCRIPTIONS,
  modelStatusLine,
  type TranscriptionDraft,
  updateArgsFromDraft,
} from "./transcription-settings-model";

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

/**
 * The transcription addon’s settings: speech model, summary endpoint, retention.
 * Shown to `ManageTranscription` holders once the addon is on. The API key is
 * write-only: the server never sends it back, so this form only ever holds what
 * the person is typing right now.
 */
export function TranscriptionSettings() {
  const config = useQuery(api.transcription.getConfig, {});
  if (config === undefined) {
    return <Spinner label="Loading transcription settings" />;
  }
  return <TranscriptionForm config={config} />;
}

type Config = NonNullable<ReturnType<typeof useQuery<typeof api.transcription.getConfig>>>;

function TranscriptionForm({ config }: { readonly config: Config }) {
  const update = useMutation(api.transcription.updateConfig);
  const download = useMutation(api.transcription.downloadModel);
  const testConnection = useAction(api.transcriptionActions.testConnection);
  const baseline = draftFromConfig(config);
  const [draft, setDraft] = useState<TranscriptionDraft>(baseline);
  const [modelChoice, setModelChoice] = useState(config.modelId);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmPrivate, setConfirmPrivate] = useState(false);
  const dirty = draftIsDirty(draft, baseline);
  const problem = endpointProblem(draft);

  // Follow the server after a save (or another admin’s change) while nothing is being edited.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new server version resets the draft
  useEffect(() => {
    if (!dirty) {
      setDraft(draftFromConfig(config));
    }
  }, [config.updatedAt]);

  const set = (patch: Partial<TranscriptionDraft>) => {
    setSaved(false);
    setDraft((current) => ({ ...current, ...patch }));
  };

  const modelStatus: TranscriptionModelStatus =
    modelChoice === config.modelId ? config.modelStatus : "not_installed";
  const status = modelStatusLine({
    status: modelStatus,
    progress: modelChoice === config.modelId ? config.modelProgress : null,
    error: modelChoice === config.modelId ? config.modelError : null,
  });
  const notice = downloadNotice({
    lastError: config.modelError,
    modelStatus: config.modelStatus,
  });
  const busyDownload =
    downloading || (modelChoice === config.modelId && config.modelStatus === "downloading");

  const save = () => {
    if (problem !== null || saving) {
      return;
    }
    setSaving(true);
    setError(null);
    void update(updateArgsFromDraft(draft))
      .then(() => {
        setSaved(true);
        setDraft((current) => ({ ...current, keyMode: "keep", keyValue: "" }));
      })
      .catch((cause: unknown) => {
        setError(messageOf(cause, "Could not save. Try again."));
      })
      .finally(() => {
        setSaving(false);
      });
  };

  return (
    <form
      className="flex flex-col gap-6"
      data-testid="settings-transcription"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      {!config.serviceInstalled && (
        <div
          role="status"
          className="flex gap-2.5 rounded-[10px] border border-idle/30 bg-idle/10 px-3 py-2.5 text-[13px] text-text"
        >
          <Icon name="signal" size={16} className="mt-0.5 shrink-0 text-idle" />
          <div className="min-w-0">
            <p className="font-medium">Transcription service not installed</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-text-muted">
              Models are downloaded by the optional <code>transcriber</code> container. Start it
              with the <code>transcription</code> compose profile, then come back to download a
              model. Until then nobody can start transcription.
            </p>
          </div>
        </div>
      )}

      <SettingsGroup
        title="Speech model"
        description="Runs on your server. Audio is processed in memory and never stored."
      >
        <SettingsGroupRow
          label="Model"
          description={MODEL_DESCRIPTIONS.get(modelChoice) ?? ""}
          align="start"
        >
          <Select
            value={modelChoice}
            onChange={setModelChoice}
            className="w-[200px]"
            options={config.availableModels.map((id) => ({ value: id, label: id }))}
          />
        </SettingsGroupRow>
        <SettingsGroupRow label="Status" description={status.detail}>
          <div className="flex min-w-[150px] flex-col items-end gap-1.5">
            <span
              data-testid="transcription-model-status"
              className={
                modelStatus === "ready"
                  ? "text-[12.5px] font-medium text-secondary-text"
                  : modelStatus === "error"
                    ? "text-[12.5px] font-medium text-danger-text"
                    : "text-[12.5px] font-medium text-text-muted"
              }
            >
              {status.label}
            </span>
            {status.indeterminate && (
              <div
                role="progressbar"
                aria-label="Model download"
                aria-valuetext="Downloading"
                className="h-1.5 w-[150px] overflow-hidden rounded-full bg-surface-3"
              >
                <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
              </div>
            )}
            {status.progress !== null && (
              <div
                role="progressbar"
                aria-label="Model download"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={status.progress}
                className="h-1.5 w-[150px] overflow-hidden rounded-full bg-surface-3"
              >
                <div
                  className="h-full rounded-full bg-accent transition-[width]"
                  style={{ width: `${status.progress}%` }}
                />
              </div>
            )}
            {modelStatus !== "ready" && (
              <Button
                type="button"
                size="sm"
                loading={busyDownload}
                disabled={busyDownload || !config.serviceInstalled}
                leading={<Icon name="download" size={14} />}
                onClick={() => {
                  setDownloading(true);
                  setDownloadError(null);
                  void download({ modelId: modelChoice })
                    .catch((cause: unknown) => {
                      setDownloadError(messageOf(cause, "Could not start the download."));
                    })
                    .finally(() => {
                      setDownloading(false);
                    });
                }}
              >
                {modelStatus === "error" ? "Try again" : "Download"}
              </Button>
            )}
          </div>
        </SettingsGroupRow>
        {notice !== null && (
          <div className="px-4 py-2.5">
            <Text tone="muted" size="sm" role="status">
              {notice}
            </Text>
          </div>
        )}
        {downloadError !== null && (
          <div className="px-4 py-2.5">
            <Text tone="danger" size="sm" role="alert">
              {downloadError}
            </Text>
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup
        title="Summaries"
        description="After a call, the transcript text is sent to this endpoint to write a summary. Audio is never sent."
      >
        <div className="flex flex-col gap-4 px-4 py-4">
          <SegmentedControl<TranscriptionProvider>
            label="Provider"
            value={draft.provider}
            onChange={(provider) => {
              set({
                provider,
                baseUrl: provider === "openrouter" ? OPENROUTER_BASE_URL : draft.baseUrl,
              });
            }}
            options={[
              { value: "openrouter", label: "OpenRouter" },
              { value: "openai_compatible", label: "OpenAI-compatible" },
            ]}
          />
          <Input
            label="Base URL"
            value={draft.baseUrl}
            readOnly={draft.provider === "openrouter"}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              set({ baseUrl: event.target.value });
            }}
            hint={
              draft.provider === "openrouter"
                ? "OpenRouter’s address is fixed."
                : "Requests go to {base URL}/chat/completions. https is required unless you allow a private network endpoint below. localhost is never allowed."
            }
            {...(problem !== null ? { error: problem } : {})}
          />
          <ApiKeyField
            hasKey={config.hasApiKey}
            mode={draft.keyMode}
            value={draft.keyValue}
            onMode={(keyMode) => {
              set({ keyMode, keyValue: "" });
            }}
            onValue={(keyValue) => {
              // Typing is replacing: with no saved key there is nothing to "keep".
              set({ keyValue, keyMode: "replace" });
            }}
          />
          <Input
            label="Model"
            value={draft.model}
            autoComplete="off"
            spellCheck={false}
            placeholder={DEFAULT_SUMMARY_MODEL}
            onChange={(event) => {
              set({ model: event.target.value });
            }}
            hint="The model id your provider uses, for example openai/gpt-4o-mini."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Summary language (optional)"
              value={draft.summaryLanguage}
              placeholder="Same as the call"
              onChange={(event) => {
                set({ summaryLanguage: event.target.value });
              }}
            />
            <Input
              label="Summary style (optional)"
              value={draft.summaryStyle}
              placeholder="Concise, bullet points"
              onChange={(event) => {
                set({ summaryStyle: event.target.value });
              }}
            />
          </div>
        </div>
        <SettingsGroupRow
          label="Allow private network endpoint"
          description="Lets summaries go to a private LAN address, such as 192.168.x.x, 10.x.x.x or host.docker.internal. Off by default. Loopback (localhost), link-local and cloud-metadata addresses are always refused, with or without this."
          align="start"
        >
          <Switch
            bare
            label="Allow private network endpoint"
            checked={draft.allowPrivateEndpoint}
            onChange={(allow) => {
              if (allow) {
                setConfirmPrivate(true);
              } else {
                set({ allowPrivateEndpoint: false });
              }
            }}
          />
        </SettingsGroupRow>
        {draft.allowPrivateEndpoint && (
          <div
            role="note"
            className="flex gap-2.5 px-4 py-3 text-[12.5px] leading-relaxed text-text"
          >
            <Icon name="shield" size={16} className="mt-0.5 shrink-0 text-danger-text" />
            <p>
              <strong className="font-semibold text-danger-text">
                Private network access is on.
              </strong>{" "}
              Your server can now send transcripts and the API key to private addresses inside your
              network. Only point this at a service you run and trust. Loopback (localhost),
              link-local and cloud-metadata addresses are always refused, even with this on.
            </p>
          </div>
        )}
        <SettingsGroupRow
          label="Test connection"
          description="Checks the address, key and model above, even before you save. The key is never shown."
          align="start"
        >
          <div className="flex max-w-[260px] flex-col items-end gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              loading={testing}
              disabled={testing || problem !== null}
              onClick={() => {
                setTesting(true);
                setTestResult(null);
                void testConnection({
                  baseUrl: draft.baseUrl.trim(),
                  ...(draft.keyMode === "replace" && draft.keyValue.trim().length > 0
                    ? { apiKey: draft.keyValue.trim() }
                    : {}),
                  ...(draft.model.trim().length > 0 ? { model: draft.model.trim() } : {}),
                  allowPrivateEndpoint: draft.allowPrivateEndpoint,
                })
                  .then((result) => {
                    setTestResult({ ok: true, text: `Connected. Model: ${result.model}` });
                  })
                  .catch((cause: unknown) => {
                    setTestResult({ ok: false, text: messageOf(cause, "The test failed.") });
                  })
                  .finally(() => {
                    setTesting(false);
                  });
              }}
            >
              Test connection
            </Button>
            {testResult !== null && (
              <p
                role={testResult.ok ? "status" : "alert"}
                data-testid="transcription-test-result"
                className={
                  testResult.ok
                    ? "text-right text-[12.5px] text-secondary-text"
                    : "text-right text-[12.5px] text-danger-text"
                }
              >
                {testResult.text}
              </p>
            )}
          </div>
        </SettingsGroupRow>
      </SettingsGroup>

      <SettingsGroup title="Retention">
        <SettingsGroupRow
          label="Keep transcripts for"
          description="Days before transcripts and summaries are deleted automatically. 0 keeps them until someone deletes them."
          align="start"
        >
          <div className="w-[120px]">
            <Input
              label="Days"
              type="number"
              min={0}
              max={TRANSCRIPTION_MAX_RETENTION_DAYS}
              value={draft.retentionDays}
              onChange={(event) => {
                set({ retentionDays: event.target.value });
              }}
              {...(retentionProblem(draft.retentionDays) !== null
                ? { error: retentionProblem(draft.retentionDays) ?? "" }
                : {})}
            />
          </div>
        </SettingsGroupRow>
      </SettingsGroup>

      <SaveRow
        inset
        busy={saving}
        dirty={dirty && problem === null && retentionProblem(draft.retentionDays) === null}
        saved={saved && !dirty}
        error={error}
        onDiscard={() => {
          setDraft(baseline);
          setSaved(false);
          setError(null);
        }}
      />

      <ConfirmDialog
        open={confirmPrivate}
        onClose={() => {
          setConfirmPrivate(false);
        }}
        title="Allow private network endpoints?"
        description="Your server will be able to send call transcripts and the API key to private addresses inside your own network, such as 192.168.x.x, 10.x.x.x or host.docker.internal. Only do this for a service you run and trust. Loopback (localhost), link-local and cloud-metadata addresses stay refused."
        confirmLabel="Allow private network"
        variant="danger"
        icon="shield"
        onConfirm={() => {
          setConfirmPrivate(false);
          set({ allowPrivateEndpoint: true });
        }}
      />
    </form>
  );
}

function retentionProblem(text: string): string | null {
  const trimmed = text.trim();
  if (!/^\d{1,4}$/u.test(trimmed)) {
    return `Enter a whole number of days, 0 to ${TRANSCRIPTION_MAX_RETENTION_DAYS}.`;
  }
  return clampRetentionDays(Number(trimmed)) === Number(trimmed)
    ? null
    : `Enter 0 to ${TRANSCRIPTION_MAX_RETENTION_DAYS} days.`;
}

/**
 * Write-only API key: shows whether one is saved, never its value. Replacing or
 * removing is an explicit choice, and the typed value lives only in this form.
 */
function ApiKeyField({
  hasKey,
  mode,
  value,
  onMode,
  onValue,
}: {
  readonly hasKey: boolean;
  readonly mode: KeyMode;
  readonly value: string;
  readonly onMode: (mode: KeyMode) => void;
  readonly onValue: (value: string) => void;
}) {
  if (hasKey && mode === "keep") {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-text">API key</span>
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="transcription-key-saved"
            className="flex h-9 flex-1 items-center gap-2 rounded-[8px] border border-border bg-surface-3 px-2.5 text-[13px] text-text-muted"
          >
            <Icon name="key" size={14} />A key is saved. It can’t be shown again.
          </span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              onMode("replace");
            }}
          >
            Replace
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              onMode("clear");
            }}
          >
            Remove
          </Button>
        </div>
      </div>
    );
  }
  if (mode === "clear") {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-text">API key</span>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-9 flex-1 items-center rounded-[8px] border border-danger/30 bg-danger/10 px-2.5 text-[13px] text-danger-text">
            The saved key will be removed when you save.
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              onMode("keep");
            }}
          >
            Undo
          </Button>
        </div>
      </div>
    );
  }
  return (
    <Input
      label="API key"
      type="password"
      value={value}
      autoComplete="new-password"
      autoCapitalize="off"
      spellCheck={false}
      placeholder={hasKey ? "Paste the new key" : "Paste your API key"}
      onChange={(event) => {
        onValue(event.target.value);
      }}
      hint="Encrypted on your server and never sent back to any browser."
      trailing={
        hasKey ? (
          <button
            type="button"
            onClick={() => {
              onMode("keep");
            }}
            className="rounded-[6px] px-1.5 py-0.5 text-[12px] font-medium text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Keep
          </button>
        ) : undefined
      }
    />
  );
}
