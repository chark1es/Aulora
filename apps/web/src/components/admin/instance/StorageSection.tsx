import { Button, Heading, Input, Select, Text } from "@aulora/ui-web";
import { useMutation } from "convex/react";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import {
  BYTE_UNIT_OPTIONS,
  type ByteUnit,
  composeByteSize,
  splitByteSize,
} from "../../../lib/instance-admin";

/**
 * The `instance.overview` fields the storage form reads. Kept structural so this
 * module does not import the overview type back from `InstanceSections`.
 */
export interface StorageOverview {
  readonly storage: {
    readonly quotaBytes: number;
    readonly maxUploadBytes: number;
  };
}

interface ByteSizeDraft {
  readonly value: string;
  readonly unit: ByteUnit;
}

const MIN_MAX_UPLOAD_BYTES = 1024;

/** Instance-admin storage limits: a number plus a binary unit, not raw bytes. */
export function StorageSection({ overview }: { readonly overview: StorageOverview }) {
  const updateStorage = useMutation(api.instance.updateStorage);
  const [quota, setQuota] = useState<ByteSizeDraft>({ value: "0", unit: "GiB" });
  const [maxUpload, setMaxUpload] = useState<ByteSizeDraft>({ value: "", unit: "MiB" });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setQuota(splitByteSize(overview.storage.quotaBytes));
    setMaxUpload(splitByteSize(overview.storage.maxUploadBytes));
  }, [overview.storage.quotaBytes, overview.storage.maxUploadBytes]);

  return (
    <form
      className="flex flex-col gap-4"
      data-testid="instance-storage"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setSaved(false);
        const quotaBytes = quota.value.trim() === "" ? 0 : composeByteSize(quota.value, quota.unit);
        const maxUploadBytes = composeByteSize(maxUpload.value, maxUpload.unit);
        if (quotaBytes === null || maxUploadBytes === null) {
          setError("Enter a number for the quota and the max upload size.");
          return;
        }
        if (
          maxUploadBytes < MIN_MAX_UPLOAD_BYTES ||
          (quotaBytes > 0 && maxUploadBytes > quotaBytes)
        ) {
          setError("Max upload must be at least 1 KiB and no larger than the quota.");
          return;
        }
        setBusy(true);
        void updateStorage({ storageQuotaBytes: quotaBytes, maxUploadBytes })
          .then(() => {
            setSaved(true);
          })
          .catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : "Could not save the quota.");
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <Heading level={3}>Storage quotas</Heading>
      <Text tone="muted" size="sm">
        The quota is the total upload budget; 0 means unlimited. The max upload caps a single file.
        Type a number and choose its binary unit.
      </Text>
      <ByteSizeField
        label="Total storage quota"
        hint="0 means unlimited. Enter a number and pick a unit."
        draft={quota}
        onChange={setQuota}
      />
      <ByteSizeField
        label="Max upload size"
        hint="At least 1 KiB and no larger than the quota."
        draft={maxUpload}
        onChange={setMaxUpload}
      />
      {error !== null && (
        <Text tone="danger" size="sm" role="alert">
          {error}
        </Text>
      )}
      {saved && (
        <Text tone="secondary" size="sm" role="status">
          Quota saved.
        </Text>
      )}
      <div>
        <Button type="submit" loading={busy} disabled={busy}>
          Save quotas
        </Button>
      </div>
    </form>
  );
}

function ByteSizeField({
  label,
  hint,
  draft,
  onChange,
}: {
  readonly label: string;
  readonly hint: string;
  readonly draft: ByteSizeDraft;
  readonly onChange: Dispatch<SetStateAction<ByteSizeDraft>>;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <Input
          label={label}
          hint={hint}
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={draft.value}
          onChange={(event) => {
            onChange({ ...draft, value: event.currentTarget.value });
          }}
        />
      </div>
      <Select
        label="Unit"
        className="w-24 shrink-0"
        value={draft.unit}
        options={BYTE_UNIT_OPTIONS}
        onChange={(unit) => {
          onChange({ ...draft, unit });
        }}
      />
    </div>
  );
}
