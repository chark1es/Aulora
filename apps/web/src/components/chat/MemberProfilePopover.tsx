import { Button, Icon } from "@aulora/ui-web";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MemberEntry } from "./MembersPanel";
import { PresenceAvatar, type PresenceStatus, presenceLabel } from "./PresenceAvatar";

export interface MemberProfilePopoverProps {
  readonly member: MemberEntry;
  readonly anchor: HTMLButtonElement;
  readonly status: PresenceStatus;
  /** Undefined while loading; null if the member has left the workspace. */
  readonly profile:
    | {
        readonly bio: string | null;
        readonly lastOnlineAt: number | null;
      }
    | null
    | undefined;
  readonly onMessage: (userId: string) => Promise<void>;
  readonly onClose: () => void;
}

export function MemberProfilePopover({
  member,
  anchor,
  status,
  profile,
  onMessage,
  onClose,
}: MemberProfilePopoverProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastOnline = profile?.lastOnlineAt;

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (panel === null) {
      return;
    }
    const place = () => {
      if (!anchor.isConnected) {
        onClose();
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const margin = 8;
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
        onClose();
        return;
      }
      setPosition({
        left: Math.max(margin, rect.left - panel.offsetWidth - 12),
        top: Math.max(margin, Math.min(rect.top, window.innerHeight - panel.offsetHeight - margin)),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    observer.observe(anchor);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, onClose]);

  useEffect(() => {
    closeRef.current?.focus();
    const panel = panelRef.current;
    const outside = (event: PointerEvent | FocusEvent) => {
      if (
        event.target instanceof Node &&
        !panel?.contains(event.target) &&
        !anchor.contains(event.target)
      ) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", onKeyDown, true);
      if (panel?.contains(document.activeElement) || document.activeElement === document.body) {
        anchor.focus();
      }
    };
  }, [anchor, onClose]);

  const sendMessage = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onMessage(member.userId);
      onClose();
    } catch {
      setError("Couldn't open the direct message. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-labelledby={titleId}
      style={{ left: position.left, top: position.top }}
      className="fixed z-50 flex max-h-[calc(100dvh-16px)] w-[320px] max-w-[calc(100vw-16px)] animate-pop-in flex-col overflow-hidden rounded-[14px] border border-border bg-surface-2 shadow-2xl shadow-black/30"
    >
      <header className="flex shrink-0 items-start gap-3 p-4 pb-2">
        <PresenceAvatar
          userId={member.userId}
          size={44}
          status={status}
          roleColor={member.roleColor}
          ringClassName="ring-surface-2"
        />
        <div className="min-w-0 flex-1">
          <h2
            id={titleId}
            className="break-words text-[15px] font-semibold tracking-[-0.01em] text-text"
          >
            {member.displayName}
          </h2>
          <p className="mt-0.5 text-[12px] text-text-muted">{presenceLabel(status)}</p>
        </div>
        <button
          ref={closeRef}
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] text-text-muted transition hover:bg-surface-3 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Icon name="x" size={16} />
        </button>
      </header>
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4 pt-2">
        {profile === undefined ? (
          <p role="status" className="text-[13px] text-text-muted">
            Loading profile…
          </p>
        ) : profile === null ? (
          <p role="status" className="text-[13px] text-text-muted">
            This member is no longer in the workspace.
          </p>
        ) : (
          <>
            <div>
              <h3 className="mb-1 text-[12px] font-medium text-text-muted">Last online</h3>
              <p className="text-[13px] text-text">
                {status !== "offline" ? (
                  "Online now"
                ) : lastOnline != null ? (
                  <time dateTime={new Date(lastOnline).toISOString()}>
                    {new Date(lastOnline).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                ) : (
                  "Unknown"
                )}
              </p>
            </div>
            <div>
              <h3 className="mb-1 text-[12px] font-medium text-text-muted">Bio</h3>
              <p className="max-h-[30vh] overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text">
                {profile.bio?.trim() || "No bio yet."}
              </p>
            </div>
          </>
        )}
        {error !== null && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
      </div>
      <footer className="shrink-0 border-t border-border bg-surface-1/60 p-4 pt-3">
        <Button
          leading={<Icon name="message" size={16} />}
          loading={busy}
          disabled={profile === null}
          onClick={() => void sendMessage()}
          className="w-full"
        >
          Send message
        </Button>
      </footer>
    </div>,
    document.body,
  );
}
