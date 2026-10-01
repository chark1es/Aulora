import { Avatar } from "@aulora/avatars";
import { Button, Icon, Input, Spinner, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { SettingsSectionHeader } from "./SettingsSection";

export interface WorkspaceBrandingProps {
  readonly canManageWorkspace: boolean;
}

const MAX_LOGO_BYTES = 4 * 1024 * 1024;

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

  return (
    <section className="flex flex-col gap-5" data-testid="workspace-branding">
      <SettingsSectionHeader
        icon="image"
        title="Branding"
        description="How this workspace looks to members and on the sign-in screen."
      />

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() =>
              updateBranding({
                name: name.trim(),
                iconSeed: iconSeed.trim(),
                description,
              }),
            );
          }}
        >
          <Input
            label="Workspace name"
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <Input
            label="Icon seed"
            value={iconSeed}
            onChange={(event) => setIconSeed(event.currentTarget.value)}
            hint="Drives the generated icon when no logo is set."
          />
          <Input
            label="Description"
            value={description}
            maxLength={280}
            onChange={(event) => setDescription(event.currentTarget.value)}
            hint="A short line shown under the workspace name."
          />

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              aria-label="Upload workspace logo"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file !== undefined) {
                  void uploadLogo(file);
                }
              }}
            />
            <Button type="button" variant="secondary" onClick={() => logoInputRef.current?.click()}>
              <Icon name="image-plus" size={15} />
              Upload logo
            </Button>
            {server.logoUrl !== null && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => void run(() => setLogo({}))}
                disabled={busy}
              >
                Clear logo
              </Button>
            )}
            <Button type="submit" loading={busy} disabled={busy || !dirty}>
              Save branding
            </Button>
            {saved && (
              <span
                className="flex items-center gap-1 text-[12px] font-medium text-secondary"
                role="status"
              >
                <Icon name="check" size={13} />
                Saved
              </span>
            )}
          </div>
          {error !== null && (
            <Text tone="danger" size="sm" role="alert">
              {error}
            </Text>
          )}
        </form>

        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            Login preview
          </span>
          <div className="flex flex-col items-center gap-3 rounded-[12px] border border-border bg-surface-2 p-5 text-center">
            {server.logoUrl !== null ? (
              <img src={server.logoUrl} alt="" className="h-16 w-16 rounded-[16px] object-cover" />
            ) : (
              <Avatar seed={iconSeed || server.iconSeed} size={64} shape="squircle" />
            )}
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-text">{name || server.name}</p>
              <p className="mt-0.5 line-clamp-2 text-[11px] text-text-muted">
                {description || "A self-hosted Aulora workspace."}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
