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
import { type ReactNode, useEffect, useState } from "react";
import { PresenceAvatar } from "./PresenceAvatar";

export interface UserSettingsViewProps {
  readonly ownUserId: string;
  readonly ownName: string;
  readonly alignment: "left" | "right";
  readonly canEditNickname: boolean;
  readonly isOwner: boolean;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onSave: (input: {
    readonly alignment: "left" | "right";
    readonly nickname?: string;
  }) => void | Promise<void>;
  readonly onBack: () => void;
  readonly onSignOut?: () => void;
  /** Voice device settings, injected to keep this view decoupled. */
  readonly voiceSettings?: ReactNode;
  /** Notifications & sounds settings, injected to keep this view decoupled. */
  readonly soundSettings?: ReactNode;
}

type Category = "account" | "notifications" | "voice" | "appearance";

const CATEGORIES: readonly {
  readonly id: Category;
  readonly label: string;
  readonly icon: Parameters<typeof Icon>[0]["name"];
}[] = [
  { id: "account", label: "Account", icon: "users" },
  { id: "notifications", label: "Notifications & sounds", icon: "bell" },
  { id: "voice", label: "Voice & video", icon: "headphones" },
  { id: "appearance", label: "Appearance", icon: "eye" },
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
  alignment,
  canEditNickname,
  isOwner,
  busy = false,
  error = null,
  onSave,
  onBack,
  onSignOut,
  voiceSettings,
  soundSettings,
}: UserSettingsViewProps) {
  const [category, setCategory] = useState<Category>("account");
  const [nextAlignment, setNextAlignment] = useState<"left" | "right">(alignment);
  const [nickname, setNickname] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  // Track live alignment changes without clobbering the nickname field.
  useEffect(() => {
    setNextAlignment(alignment);
  }, [alignment]);

  const isBusy = busy || submitting;
  const trimmedNickname = nickname.trim();
  const nicknameProvided = canEditNickname && trimmedNickname.length > 0;

  const submit = (includeNickname: boolean) => {
    if (isBusy) {
      return;
    }
    setSubmitting(true);
    void Promise.resolve(
      onSave({
        alignment: nextAlignment,
        ...(includeNickname && nicknameProvided ? { nickname: trimmedNickname } : {}),
      }),
    ).finally(() => setSubmitting(false));
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
          <div className="mb-2 hidden items-center gap-2.5 rounded-[10px] border border-border bg-surface-2 p-2.5 sm:flex">
            <PresenceAvatar userId={ownUserId} size={40} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[13px] font-semibold text-text">{ownName}</span>
                {isOwner && (
                  <span
                    className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent"
                    data-testid="user-settings-admin-badge"
                  >
                    Admin
                  </span>
                )}
              </div>
              <p className="truncate text-[11px] text-text-muted">Manage your account</p>
            </div>
          </div>
          {CATEGORIES.map((entry) => (
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
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 p-6">
            {category === "account" && (
              <>
                <div className="flex items-center gap-3">
                  <PresenceAvatar userId={ownUserId} size={56} />
                  <div className="min-w-0 flex-1">
                    <span className="truncate text-[17px] font-semibold text-text">{ownName}</span>
                    <p className="truncate text-[13px] text-text-muted">
                      Your profile in this workspace.
                    </p>
                  </div>
                </div>

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

                  {error !== null && error.length > 0 && (
                    <Text tone="danger" size="sm" role="alert">
                      {error}
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
