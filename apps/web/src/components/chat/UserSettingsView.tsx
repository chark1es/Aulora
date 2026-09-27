import { Field, Icon, IconButton, Input, SegmentedControl, Text } from "@aulora/ui-web";
import { useEffect, useState } from "react";
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
}

/**
 * The account settings surface, rendered as a main view (it replaces the
 * conversation while the sidebar stays visible). Message alignment and (when
 * permitted) a nickname. Presence and custom status live in the account menu.
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
}: UserSettingsViewProps) {
  const [nextAlignment, setNextAlignment] = useState<"left" | "right">(alignment);
  const [nickname, setNickname] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Track live alignment changes without clobbering the nickname field.
  useEffect(() => {
    setNextAlignment(alignment);
  }, [alignment]);

  const isBusy = busy || submitting;
  const trimmedNickname = nickname.trim();
  const nicknameProvided = canEditNickname && trimmedNickname.length > 0;

  const submit = () => {
    if (isBusy) {
      return;
    }
    setSubmitting(true);
    void Promise.resolve(
      onSave({
        alignment: nextAlignment,
        ...(nicknameProvided ? { nickname: trimmedNickname } : {}),
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[560px] flex-col gap-6 p-5">
          <div className="flex items-center gap-3">
            <PresenceAvatar userId={ownUserId} size={56} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[17px] font-semibold text-text">{ownName}</span>
                {isOwner && (
                  <span
                    className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent"
                    data-testid="user-settings-admin-badge"
                  >
                    Admin
                  </span>
                )}
              </div>
              <p className="truncate text-[13px] text-text-muted">
                Manage your profile and message alignment.
              </p>
            </div>
          </div>

          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
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

            {error !== null && error.length > 0 && (
              <Text tone="danger" size="sm" role="alert">
                {error}
              </Text>
            )}

            <div className="flex items-center gap-2">
              {onSignOut !== undefined && (
                <button
                  type="button"
                  onClick={onSignOut}
                  className="mr-auto flex h-9 items-center gap-2 rounded-[8px] px-3 text-[13px] font-medium text-text-muted transition hover:bg-surface-3 hover:text-text"
                >
                  <Icon name="logout" size={15} />
                  Sign out
                </button>
              )}
              <button
                type="button"
                onClick={onBack}
                className="h-9 rounded-[8px] px-3 text-[13px] font-medium text-text-muted transition hover:bg-surface-3 hover:text-text"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isBusy}
                className="h-9 rounded-[8px] bg-accent px-3.5 text-[13px] font-semibold text-on-accent transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-40"
              >
                {isBusy ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
