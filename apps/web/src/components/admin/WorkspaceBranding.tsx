/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Avatar } from "@aulora/avatars";
import { Button, Icon, Input, Spinner, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { SaveRow } from "./SettingsSaveRow";
import { SettingsSection } from "./SettingsSection";

export interface WorkspaceBrandingProps {
  readonly canManageWorkspace: boolean;
}

const MAX_LOGO_BYTES = 4 * 1024 * 1024;

interface BrandingModel {
  readonly name: string;
  readonly iconSeed: string;
  readonly description: string;
  readonly logoUrl: string | null;
  readonly busy: boolean;
  readonly dirty: boolean;
  readonly saved: boolean;
  readonly error: string | null;
  readonly logoInputRef: RefObject<HTMLInputElement | null>;
  readonly onNameChange: (value: string) => void;
  readonly onIconSeedChange: (value: string) => void;
  readonly onDescriptionChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onUploadClick: () => void;
  readonly onLogoFile: (file: File) => void;
  readonly onClearLogo: () => void;
  readonly onDiscard: () => void;
}

/**
 * Workspace branding: name, icon seed, description and logo, with a live
 * preview of how the workspace presents on the sign-in screen. Writes go through
 * `server.updateBranding` / `server.setLogo`.
 */
export function WorkspaceBranding({ canManageWorkspace }: WorkspaceBrandingProps) {
  const server = useQuery(api.server.settings, canManageWorkspace ? {} : "skip");
  const updateBranding = useMutation(api.server.updateBranding);
  const setLogo = useMutation(api.server.setLogo);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);

  const [name, setName] = useState("");
  const [iconSeed, setIconSeed] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (server === undefined) {
      return;
    }
    setName(server.name);
    setIconSeed(server.iconSeed);
    setDescription(server.description);
  }, [server]);

  if (!canManageWorkspace) {
    return null;
  }
  if (server === undefined) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size={22} label="Loading branding" />
      </div>
    );
  }

  async function run(task: () => Promise<unknown>): Promise<void> {
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await task();
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save branding.");
    } finally {
      setBusy(false);
    }
  }

  const uploadLogo = async (file: File): Promise<void> => {
    if (file.size > MAX_LOGO_BYTES) {
      setError("Choose an image under 4 MB.");
      return;
    }
    await run(async () => {
      const url = await generateUploadUrl({});
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) {
        throw new Error("Logo upload failed.");
      }
      const body = (await response.json()) as { storageId?: unknown };
      if (typeof body.storageId !== "string") {
        throw new Error("Logo upload did not return a storage id.");
      }
      await setLogo({ storageId: body.storageId as never });
    });
  };

  const dirty =
    name.trim() !== server.name ||
    iconSeed.trim() !== server.iconSeed ||
    description !== server.description;

  const model: BrandingModel = {
    name,
    iconSeed,
    description,
    logoUrl: server.logoUrl,
    busy,
    dirty,
    saved,
    error,
    logoInputRef,
    onNameChange: setName,
    onIconSeedChange: setIconSeed,
    onDescriptionChange: setDescription,
    onSubmit: () => {
      void run(() => updateBranding({ name: name.trim(), iconSeed: iconSeed.trim(), description }));
    },
    onUploadClick: () => {
      logoInputRef.current?.click();
    },
    onLogoFile: (file) => {
      void uploadLogo(file);
    },
    onClearLogo: () => {
      void run(() => setLogo({}));
    },
    onDiscard: () => {
      setName(server.name);
      setIconSeed(server.iconSeed);
      setDescription(server.description);
      setError(null);
      setSaved(false);
    },
  };

  return (
    <div data-testid="workspace-branding">
      <SettingsSection
        title="Branding"
        description="How this workspace looks to members and on the sign-in screen."
      >
        <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_220px]">
          <BrandingForm model={model} />
          <BrandingPreview
            model={model}
            storedName={server.name}
            storedIconSeed={server.iconSeed}
          />
        </div>
      </SettingsSection>
    </div>
  );
}

/** Upload or clear the uploaded logo, with the accepted formats beside it. */
function LogoControls({ model }: { readonly model: BrandingModel }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
      <input
        ref={model.logoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="Upload workspace logo"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file !== undefined) {
            model.onLogoFile(file);
          }
        }}
      />
      <Button
        type="button"
        variant="secondary"
        disabled={model.busy}
        onClick={model.onUploadClick}
        leading={<Icon name="image-plus" size={15} />}
      >
        Upload logo
      </Button>
      {model.logoUrl !== null && (
        <Button type="button" variant="ghost" disabled={model.busy} onClick={model.onClearLogo}>
          Clear logo
        </Button>
      )}
      <Text size="xs" tone="muted">
        PNG, JPEG or WebP up to 4 MB.
      </Text>
    </div>
  );
}

function BrandingForm({ model }: { readonly model: BrandingModel }) {
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        model.onSubmit();
      }}
    >
      <div className="flex flex-col gap-4 rounded-[12px] bg-surface-2 p-4">
        <Input
          label="Workspace name"
          value={model.name}
          maxLength={80}
          onChange={(event) => {
            model.onNameChange(event.currentTarget.value);
          }}
        />
        <Input
          label="Icon seed"
          value={model.iconSeed}
          onChange={(event) => {
            model.onIconSeedChange(event.currentTarget.value);
          }}
          hint="Drives the generated icon when no logo is set."
        />
        <Input
          label="Description"
          value={model.description}
          maxLength={280}
          onChange={(event) => {
            model.onDescriptionChange(event.currentTarget.value);
          }}
          hint="A short line shown under the workspace name."
        />
        <LogoControls model={model} />
      </div>

      <SaveRow
        busy={model.busy}
        dirty={model.dirty}
        saved={model.saved}
        error={model.error}
        onDiscard={model.onDiscard}
        inset
      />
    </form>
  );
}

function BrandingPreview({
  model,
  storedName,
  storedIconSeed,
}: {
  readonly model: BrandingModel;
  readonly storedName: string;
  readonly storedIconSeed: string;
}) {
  return (
    <aside className="flex flex-col gap-2">
      <span className="text-[12px] font-medium text-text-muted">Preview</span>
      <div className="flex flex-col items-center gap-3 rounded-[12px] bg-surface-2 p-5 text-center">
        {model.logoUrl !== null ? (
          <img src={model.logoUrl} alt="" className="h-16 w-16 rounded-[16px] object-cover" />
        ) : (
          <Avatar seed={model.iconSeed || storedIconSeed} size={64} shape="squircle" />
        )}
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-text">{model.name || storedName}</p>
          <p className="mt-0.5 line-clamp-2 text-[11px] text-text-muted">
            {model.description || "A self-hosted Aulora workspace."}
          </p>
        </div>
      </div>
    </aside>
  );
}
