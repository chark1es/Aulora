import { Button, Input } from "@aulora/ui-web";
import { useState } from "react";
import type { MemberView } from "../../lib/workspace-admin";
import type { Callback } from "./callbacks";

const TIMEOUTS: readonly { readonly label: string; readonly ms: number }[] = [
  { label: "60s", ms: 60_000 },
  { label: "5m", ms: 5 * 60_000 },
  { label: "1h", ms: 60 * 60_000 },
  { label: "1d", ms: 24 * 60 * 60_000 },
];

/** Ban durations; `null` means permanent. */
const BAN_DURATIONS: readonly { readonly label: string; readonly ms: number | null }[] = [
  { label: "60 seconds", ms: 60_000 },
  { label: "1 hour", ms: 60 * 60_000 },
  { label: "1 day", ms: 24 * 60 * 60_000 },
  { label: "7 days", ms: 7 * 24 * 60 * 60_000 },
  { label: "30 days", ms: 30 * 24 * 60 * 60_000 },
  { label: "Permanent", ms: null },
];

export interface MemberActionsSectionProps {
  readonly member: MemberView;
  readonly nickname: string;
  readonly onNicknameChange: Callback<[nickname: string]>;
  readonly displayName: string;
  readonly busy: boolean;
  readonly timedOut: boolean;
  readonly canEditNickname: boolean;
  readonly canTimeout: boolean;
  readonly canKick: boolean;
  readonly canBan: boolean;
  readonly onNickname: Callback<[nickname: string]>;
  readonly onTimeout: Callback<[until: number | undefined]>;
  readonly onKick: () => void;
  readonly onBan: Callback<[durationMs?: number, reason?: string]>;
}

export function MemberActionsSection(props: MemberActionsSectionProps) {
  const {
    member,
    nickname,
    onNicknameChange,
    displayName,
    busy,
    timedOut,
    canEditNickname,
    canTimeout,
    canKick,
    canBan,
    onNickname,
    onTimeout,
    onKick,
    onBan,
  } = props;
  const nicknameDirty = nickname !== (member.nickname ?? "");
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4">
      {canEditNickname && (
        <NicknameRow
          nickname={nickname}
          onNicknameChange={onNicknameChange}
          displayName={displayName}
          busy={busy}
          dirty={nicknameDirty}
          onSave={() => {
            onNickname(nickname.trim());
          }}
        />
      )}
      <ModerationRow
        busy={busy}
        timedOut={timedOut}
        canTimeout={canTimeout}
        canKick={canKick}
        canBan={canBan}
        onTimeout={onTimeout}
        onKick={onKick}
        onBan={onBan}
      />
    </section>
  );
}

function NicknameRow({
  nickname,
  onNicknameChange,
  displayName,
  busy,
  dirty,
  onSave,
}: {
  readonly nickname: string;
  readonly onNicknameChange: Callback<[nickname: string]>;
  readonly displayName: string;
  readonly busy: boolean;
  readonly dirty: boolean;
  readonly onSave: () => void;
}) {
  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <Input
          label="Nickname"
          value={nickname}
          placeholder={displayName}
          onChange={(event) => {
            onNicknameChange(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onSave();
            }
          }}
        />
      </div>
      <ActionButton disabled={busy || !dirty} onClick={onSave}>
        Save nickname
      </ActionButton>
    </div>
  );
}

interface ModerationRowProps {
  readonly busy: boolean;
  readonly timedOut: boolean;
  readonly canTimeout: boolean;
  readonly canKick: boolean;
  readonly canBan: boolean;
  readonly onTimeout: Callback<[until: number | undefined]>;
  readonly onKick: () => void;
  readonly onBan: Callback<[durationMs?: number, reason?: string]>;
}

function ModerationRow(props: ModerationRowProps) {
  const { busy, timedOut, canTimeout, canKick, canBan, onTimeout, onKick, onBan } = props;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canTimeout &&
        (timedOut ? (
          <ActionButton
            disabled={busy}
            onClick={() => {
              onTimeout(undefined);
            }}
          >
            Clear timeout
          </ActionButton>
        ) : (
          <TimeoutMenu
            disabled={busy}
            onPick={(until) => {
              onTimeout(until);
            }}
          />
        ))}

      <span className="flex-1" />

      {canKick && (
        <ActionButton danger disabled={busy} onClick={onKick}>
          Kick
        </ActionButton>
      )}
      {canBan && <BanMenu disabled={busy} onPick={onBan} />}
    </div>
  );
}

export function ActionButton({
  children,
  onClick,
  disabled = false,
  danger = false,
}: {
  readonly children: React.ReactNode;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly danger?: boolean;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={danger ? "danger" : "secondary"}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function BanMenu({
  disabled,
  onPick,
}: {
  readonly disabled: boolean;
  readonly onPick: Callback<[durationMs?: number, reason?: string]>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <div className="relative">
      <ActionButton
        danger
        disabled={disabled}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        Ban…
      </ActionButton>
      {open && (
        <div className="absolute bottom-full right-0 z-30 mb-1 w-[220px] animate-pop-in rounded-[9px] border border-border bg-surface-2 p-1.5 shadow-2xl shadow-black/25">
          <input
            aria-label="Ban reason"
            value={reason}
            maxLength={200}
            placeholder="Reason (optional)"
            onChange={(event) => {
              setReason(event.target.value);
            }}
            className="mb-1 h-8 w-full rounded-[7px] border border-border bg-surface-1 px-2 text-[12px] text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
          {BAN_DURATIONS.map((duration) => (
            <button
              key={duration.label}
              type="button"
              onClick={() => {
                setOpen(false);
                onPick(
                  duration.ms ?? undefined,
                  reason.trim().length > 0 ? reason.trim() : undefined,
                );
              }}
              className="flex w-full items-center rounded-[7px] px-2.5 py-1.5 text-left text-[12px] text-danger transition hover:bg-danger/10"
            >
              {duration.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TimeoutMenu({
  disabled,
  onPick,
}: {
  readonly disabled: boolean;
  readonly onPick: Callback<[until: number]>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <ActionButton
        disabled={disabled}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        Time out…
      </ActionButton>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1 min-w-[140px] animate-pop-in rounded-[9px] border border-border bg-surface-2 p-1 shadow-2xl shadow-black/25">
          {TIMEOUTS.map((duration) => (
            <button
              key={duration.label}
              type="button"
              onClick={() => {
                setOpen(false);
                onPick(Date.now() + duration.ms);
              }}
              className="flex w-full items-center rounded-[7px] px-2.5 py-1.5 text-left text-[12px] text-text transition hover:bg-surface-3"
            >
              {duration.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
