import {
  Button,
  ConfirmDialog,
  cn,
  Field,
  Icon,
  IconButton,
  Input,
  SegmentedControl,
  Text,
} from "@aulora/ui-web";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { PresenceAvatar } from "./PresenceAvatar";

export interface UserSettingsViewProps {
  readonly ownUserId: string;
  readonly ownName: string;
  readonly ownBio?: string;
  readonly alignment: "left" | "right";
  readonly canEditNickname: boolean;
  readonly isOwner: boolean;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onSave: (input: {
    readonly alignment: "left" | "right";
    readonly nickname?: string;
    readonly bio?: string;
  }) => void | Promise<void>;
  readonly onBack: () => void;
  readonly onSignOut?: () => void;
  /** This workspace's picture, when one is set. */
  readonly hasAvatar?: boolean;
  readonly onChangeAvatar?: (file: File) => Promise<void>;
  readonly onClearAvatar?: () => Promise<void>;
  /** Voice device settings, injected to keep this view decoupled. */
  readonly voiceSettings?: ReactNode;
  /** Notifications & sounds settings, injected to keep this view decoupled. */
  readonly soundSettings?: ReactNode;
  readonly updateSettings?: ReactNode;
  readonly updateAvailable?: boolean;
}

type Category = "account" | "notifications" | "voice" | "appearance" | "updates";

const CATEGORIES: readonly {
  readonly id: Category;
  readonly label: string;
  readonly icon: Parameters<typeof Icon>[0]["name"];
}[] = [
  { id: "account", label: "Account", icon: "users" },
  { id: "notifications", label: "Notifications & sounds", icon: "bell" },
  { id: "voice", label: "Voice & video", icon: "headphones" },
  { id: "appearance", label: "Appearance", icon: "eye" },
  { id: "updates", label: "Updates", icon: "download" },
];

/**
 * The account settings surface, rendered as a main view (it replaces the
 * conversation while the sidebar stays visible). Split into focused categories
 * so each pane is short; a wider column keeps the whitespace calm instead of
 * narrow.
 */
export function UserSettingsView({
  ownUserId,
  ownName,
  ownBio = "",
  alignment,
  canEditNickname,
  isOwner,
  busy = false,
  error = null,
  onSave,
  onBack,
  onSignOut,
  hasAvatar = false,
  onChangeAvatar,
  onClearAvatar,
  voiceSettings,
  soundSettings,
  updateSettings,
  updateAvailable = false,
}: UserSettingsViewProps) {
  const [category, setCategory] = useState<Category>(
    updateAvailable && updateSettings !== undefined ? "updates" : "account",
  );
  const [nextAlignment, setNextAlignment] = useState<"left" | "right">(alignment);
  const [nickname, setNickname] = useState("");
  const [bio, setBio] = useState(ownBio);
  const [bioEdited, setBioEdited] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  // Track live alignment changes without clobbering the nickname field.
  useEffect(() => {
    setNextAlignment(alignment);
  }, [alignment]);

  useEffect(() => {
    if (!bioEdited) {
      setBio(ownBio);
    }
  }, [ownBio, bioEdited]);

  const isBusy = busy || submitting;
  const trimmedNickname = nickname.trim();
  const nicknameProvided = canEditNickname && trimmedNickname.length > 0;

  const changeAvatar = (file: File) => {
    if (onChangeAvatar === undefined || avatarBusy) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      setAvatarError("Choose an image.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setAvatarError("Choose an image under 4 MB.");
      return;
    }
    setAvatarBusy(true);
    setAvatarError(null);
    void onChangeAvatar(file)
      .catch(() => setAvatarError("Couldn't update your profile picture."))
      .finally(() => setAvatarBusy(false));
  };

  const clearAvatar = () => {
    if (onClearAvatar === undefined || avatarBusy) {
      return;
    }
    setAvatarBusy(true);
    setAvatarError(null);
    void onClearAvatar()
      .catch(() => setAvatarError("Couldn't remove your profile picture."))
      .finally(() => setAvatarBusy(false));
  };

  const submit = (includeNickname: boolean) => {
    if (isBusy) {
      return;
    }
    setSubmitting(true);
    setSaveError(null);
    void Promise.resolve()
      .then(() =>
        onSave({
          alignment: nextAlignment,
          ...(includeNickname && nicknameProvided ? { nickname: trimmedNickname } : {}),
          ...(includeNickname ? { bio: bio.trim() } : {}),
        }),
      )
      .catch(() => setSaveError("Couldn't save your settings. Please try again."))
      .finally(() => setSubmitting(false));
  };

  return (
    <section
      className="pane flex h-full min-w-0 flex-1 flex-col bg-surface-1"
      data-testid="user-settings-view"
      aria-label="Your settings"
    >
      <header className="material-chrome flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3">
        <IconButton label="Back to chat" onClick={onBack}>
          <Icon name="chevron-left" size={16} />
        </IconButton>
        <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-[-0.01em] text-text">
          Your settings
        </h2>
      </header>

      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <nav
          aria-label="Settings categories"
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-2 sm:w-[212px] sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r sm:p-3"
        >
          {CATEGORIES.filter((entry) => entry.id !== "updates" || updateSettings !== undefined).map(
            (entry) => (
              <button
                key={entry.id}
                type="button"
                aria-current={category === entry.id ? "page" : undefined}
                onClick={() => setCategory(entry.id)}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-[8px] px-2.5 py-2 text-left text-[13px]",
                  category === entry.id
                    ? "bg-surface-3 font-medium text-text"
                    : "text-text-muted transition hover:bg-surface-2 hover:text-text",
                )}
              >
                <Icon name={entry.icon} size={16} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {entry.id === "updates" && updateAvailable && (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                    role="img"
                    aria-label="Update available"
                  />
                )}
              </button>
            ),
          )}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 p-6">
            {category === "updates" && updateSettings}
            {category === "account" && (
              <>
                <div className="flex items-center gap-3">
                  <PresenceAvatar userId={ownUserId} size={56} />
                  <div className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 truncate text-[17px] font-semibold text-text">
                      {ownName}
                      {isOwner && (
                        <span
                          className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent"
                          data-testid="user-settings-admin-badge"
                        >
                          Admin
                        </span>
                      )}
                    </span>
                    <p className="truncate text-[13px] text-text-muted">
                      Your profile in this workspace.
                    </p>
                  </div>
                </div>

                {onChangeAvatar !== undefined && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      aria-label="Change profile picture"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file !== undefined) {
                          changeAvatar(file);
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      loading={avatarBusy}
                      disabled={avatarBusy}
                      leading={<Icon name="image" size={15} />}
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      Change picture
                    </Button>
                    {hasAvatar && onClearAvatar !== undefined && (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={avatarBusy}
                        onClick={clearAvatar}
                      >
                        Use generated avatar
                      </Button>
                    )}
                    {avatarError !== null && (
                      <Text tone="danger" size="sm" role="alert">
                        {avatarError}
                      </Text>
                    )}
                  </div>
                )}

                <form
                  className="flex flex-col gap-5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submit(true);
                  }}
                >
                  {canEditNickname && (
                    <Input
                      label="Nickname"
                      placeholder={ownName}
                      value={nickname}
                      maxLength={32}
                      onChange={(event) => setNickname(event.target.value)}
                      hint="Leave blank to use your account name."
                    />
                  )}
                  {!canEditNickname && (
                    <Text tone="muted" size="sm">
                      You do not have permission to change your nickname.
                    </Text>
                  )}

                  <label className="flex flex-col gap-1.5 text-[12px] font-medium text-text-muted">
                    Bio
                    <textarea
                      value={bio}
                      maxLength={500}
                      rows={4}
                      placeholder="Tell other members a little about yourself."
                      onChange={(event) => {
                        setBioEdited(true);
                        setBio(event.target.value);
                      }}
                      className="w-full resize-y rounded-input border border-border bg-surface-2 px-3 py-2 text-[13px] font-normal text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    />
                    <span className="text-[11px] font-normal">{bio.length}/500 characters</span>
                  </label>

                  {(saveError !== null || (error !== null && error.length > 0)) && (
                    <Text tone="danger" size="sm" role="alert">
                      {saveError ?? error}
                    </Text>
                  )}

                  <div className="flex items-center gap-2">
                    {onSignOut !== undefined && (
                      <Button
                        type="button"
                        variant="ghost"
                        className="mr-auto"
                        leading={<Icon name="logout" size={15} />}
                        onClick={() => setConfirmSignOut(true)}
                      >
                        Sign out
                      </Button>
                    )}
                    <Button type="button" variant="ghost" onClick={onBack}>
                      Cancel
                    </Button>
                    <Button type="submit" loading={isBusy} disabled={isBusy}>
                      Save
                    </Button>
                  </div>
                </form>
              </>
            )}

            {category === "notifications" &&
              (soundSettings !== undefined ? (
                soundSettings
              ) : (
                <Text tone="muted" size="sm">
                  Notification settings are unavailable.
                </Text>
              ))}

            {category === "voice" &&
              (voiceSettings !== undefined ? (
                voiceSettings
              ) : (
                <Text tone="muted" size="sm">
                  Voice settings are unavailable.
                </Text>
              ))}

            {category === "appearance" && (
              <form
                className="flex flex-col gap-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  submit(false);
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-accent-soft text-accent">
                    <Icon name="eye" size={17} />
                  </span>
                  <div>
                    <h3 className="text-[14px] font-semibold text-text">Appearance</h3>
                    <p className="text-[12px] text-text-muted">How conversations look to you.</p>
                  </div>
                </div>
                <Field label="Message alignment" hint="Which side your own messages sit on.">
                  <SegmentedControl
                    value={nextAlignment}
                    options={[
                      { value: "left", label: "Left" },
                      { value: "right", label: "Right" },
                    ]}
                    onChange={setNextAlignment}
                    label="Message alignment"
                    className="w-full"
                  />
                </Field>
                <div>
                  <Button type="submit" loading={isBusy} disabled={isBusy}>
                    Save
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmSignOut}
        onClose={() => setConfirmSignOut(false)}
        title={`Sign out of ${ownName}'s workspace?`}
        description="You can sign back in at any time."
        confirmLabel="Sign out"
        variant="danger"
        onConfirm={() => {
          setConfirmSignOut(false);
          onSignOut?.();
        }}
      />
    </section>
  );
}
