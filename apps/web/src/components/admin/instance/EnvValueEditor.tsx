/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, Field, Icon, IconButton, Input, Select, Switch, Text } from "@aulora/ui-web";
import { useState } from "react";
import {
  type EnvFieldMeta,
  type EnvVariable,
  envFieldMeta,
  envValueError,
  parseEnvList,
  prettyJson,
  serializeEnvList,
} from "../../../lib/instance-env";

export interface EnvValueEditorProps {
  readonly variable: EnvVariable;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

/**
 * Render the control that matches the variable's catalog type instead of a
 * generic text box: switches for booleans, selects for enums, bounded numeric
 * inputs, tag lists for lists and a validated mono editor for JSON.
 */
export function EnvValueEditor(props: EnvValueEditorProps) {
  const { variable } = props;
  if (variable.secret) {
    return <SecretField {...props} />;
  }
  switch (variable.type) {
    case "boolean":
      return <BooleanField {...props} />;
    case "enum":
      return <EnumField {...props} />;
    case "number":
      return <NumberField {...props} />;
    case "url":
      return <UrlField {...props} />;
    case "list":
      return <ListField {...props} />;
    case "json":
      return <JsonField {...props} />;
    case "string":
      return <TextField {...props} />;
  }
}

function BooleanField({ variable, value, onChange }: EnvValueEditorProps) {
  return (
    <div className="rounded-input border border-border bg-surface-2 px-3 py-1">
      <Switch
        checked={value === "true"}
        label={variable.label}
        description="Enabled stores true; disabled stores false."
        onChange={(checked) => {
          onChange(checked ? "true" : "false");
        }}
      />
    </div>
  );
}

function EnumField({ variable, value, onChange }: EnvValueEditorProps) {
  const options = (variable.enumValues ?? []).map((option) => ({ value: option, label: option }));
  return (
    <Select
      label={variable.label}
      placeholder="Choose an option"
      value={value}
      options={options}
      onChange={(next) => {
        onChange(next);
      }}
    />
  );
}

function NumberField({ variable, value, onChange }: EnvValueEditorProps) {
  const meta = envFieldMeta(variable);
  const error = value.trim().length > 0 ? envValueError(variable, value) : null;
  const errorProps = error !== null ? { error } : {};
  return (
    <Input
      label={variable.label}
      type="number"
      inputMode="numeric"
      min={meta.min ?? undefined}
      max={meta.max ?? undefined}
      step={meta.step}
      value={value}
      hint={boundsLabel(meta)}
      {...errorProps}
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
    />
  );
}

function UrlField({ variable, value, onChange }: EnvValueEditorProps) {
  const error = value.trim().length > 0 ? envValueError(variable, value) : null;
  const errorProps = error !== null ? { error } : {};
  return (
    <Input
      label={variable.label}
      type="url"
      value={value}
      placeholder="https://example.com"
      spellCheck={false}
      autoComplete="off"
      {...errorProps}
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
    />
  );
}

function TextField({ variable, value, onChange }: EnvValueEditorProps) {
  return (
    <Input
      label={variable.label}
      value={value}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
    />
  );
}

function SecretField({ variable, value, onChange }: EnvValueEditorProps) {
  const [visible, setVisible] = useState(false);
  const saved = variable.source === "ui";
  const hintProps = saved ? { hint: "Leave blank to keep the current secret." } : {};
  return (
    <div className="flex items-end gap-1.5">
      <div className="min-w-0 flex-1">
        <Input
          label={variable.label}
          type={visible ? "text" : "password"}
          value={value}
          placeholder={
            saved ? "•••••• — leave blank to keep the current value" : "Enter the secret"
          }
          {...hintProps}
          autoComplete="new-password"
          spellCheck={false}
          onChange={(event) => {
            onChange(event.currentTarget.value);
          }}
        />
      </div>
      <IconButton
        label={visible ? "Hide value" : "Show value"}
        size="md"
        onClick={() => {
          setVisible((current) => !current);
        }}
      >
        <Icon name={visible ? "eye-off" : "eye"} size={15} />
      </IconButton>
    </div>
  );
}

function listEntries(items: readonly string[]): { readonly id: string; readonly value: string }[] {
  const seen = new Map<string, number>();
  return items.map((value) => {
    const count = seen.get(value) ?? 0;
    seen.set(value, count + 1);
    return { id: `${value}#${count}`, value };
  });
}

function ListField({ variable, value, onChange }: EnvValueEditorProps) {
  const items = parseEnvList(value);
  const entries = listEntries(items);
  const [draft, setDraft] = useState("");
  const error = items.length > 0 ? envValueError(variable, value) : null;

  function addItem(): void {
    const next = draft.trim();
    if (next.length === 0) {
      return;
    }
    onChange(serializeEnvList([...items, next]));
    setDraft("");
  }

  function removeItem(id: string): void {
    onChange(
      serializeEnvList(entries.filter((entry) => entry.id !== id).map((entry) => entry.value)),
    );
  }

  return (
    <Field label={variable.label} hint="Add a value, then press Enter. Values are space-separated.">
      <div className="flex flex-wrap gap-1.5">
        {entries.map((entry) => (
          <span
            key={entry.id}
            className="inline-flex items-center gap-1 rounded-pill border border-border bg-surface-3 py-0.5 pl-2.5 pr-1"
          >
            <span className="font-mono text-[12px] text-text">{entry.value}</span>
            <IconButton
              label={`Remove ${entry.value}`}
              size="sm"
              onClick={() => {
                removeItem(entry.id);
              }}
            >
              <Icon name="x" size={12} />
            </IconButton>
          </span>
        ))}
        {items.length === 0 && (
          <Text size="xs" tone="muted">
            No values yet.
          </Text>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          aria-label={`Add a value to ${variable.label}`}
          value={draft}
          placeholder="Add a value and press Enter"
          onChange={(event) => {
            setDraft(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addItem();
            }
          }}
          className="min-w-0 flex-1 rounded-input border border-border bg-surface-3 px-2.5 py-1.5 text-[13px] text-text placeholder:text-text-muted focus-visible:border-accent focus-visible:outline-none"
        />
        <Button size="sm" variant="secondary" onClick={addItem}>
          Add
        </Button>
      </div>
      {error !== null && (
        <Text tone="danger" size="xs" role="alert">
          {error}
        </Text>
      )}
    </Field>
  );
}

function JsonField({ variable, value, onChange }: EnvValueEditorProps) {
  const meta = envFieldMeta(variable);
  const error = value.trim().length > 0 ? envValueError(variable, value) : null;
  const pretty = prettyJson(value);
  return (
    <Field label={variable.label}>
      <textarea
        aria-label={variable.label}
        value={value}
        rows={6}
        spellCheck={false}
        placeholder={jsonPlaceholder(meta)}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        className="w-full resize-y rounded-input border border-border bg-surface-3 p-3 font-mono text-[12px] leading-relaxed text-text placeholder:text-text-muted focus-visible:border-accent focus-visible:outline-none"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={pretty === null}
          onClick={() => {
            if (pretty !== null) {
              onChange(pretty);
            }
          }}
        >
          Pretty print
        </Button>
        <Text size="xs" tone="muted">
          {jsonHint(meta)}
        </Text>
      </div>
      {error !== null && (
        <Text tone="danger" size="xs" role="alert">
          {error}
        </Text>
      )}
    </Field>
  );
}

function boundsLabel(meta: EnvFieldMeta): string {
  const parts: string[] = [];
  if (meta.min !== null && meta.max !== null) {
    parts.push(`Between ${meta.min} and ${meta.max}`);
  } else if (meta.min !== null) {
    parts.push(`At least ${meta.min}`);
  } else if (meta.max !== null) {
    parts.push(`At most ${meta.max}`);
  }
  if (meta.unit !== null) {
    parts.push(meta.unit);
  }
  return parts.length > 0 ? parts.join(" · ") : "Whole number";
}

function jsonHint(meta: EnvFieldMeta): string {
  switch (meta.format) {
    case "group-role-map":
      return "JSON object mapping IdP groups to role name(s).";
    case "ice-servers":
      return "JSON array of RTCIceServer entries with urls.";
    default:
      return "Enter a JSON object or array.";
  }
}

function jsonPlaceholder(meta: EnvFieldMeta): string {
  switch (meta.format) {
    case "group-role-map":
      return '{"admins":"Admin"}';
    case "ice-servers":
      return '[{"urls":["stun:stun.example.com:3478"]}]';
    default:
      return "{}";
  }
}
