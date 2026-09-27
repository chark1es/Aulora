import { Logo } from "@aulora/ui-web";
import type { ReactNode } from "react";

/**
 * The frame for pre-session screens (connect, sign in, invites): one flat pane
 * with a centered card and a quiet footer line.
 */
export function AuthFrame({ children }: { readonly children: ReactNode }) {
  return (
    <div className="pane chat-canvas flex flex-1 flex-col items-center overflow-y-auto px-4 py-10">
      <div className="my-auto flex w-full max-w-[420px] animate-pop-in flex-col gap-6">
        {children}
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-text-muted">
          <Logo size={13} />
          Aulora · team chat on your own server
        </p>
      </div>
    </div>
  );
}

/** The raised card inside {@link AuthFrame}. */
export function AuthCard({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-5 rounded-[12px] border border-border bg-surface-2 p-6 shadow-xl shadow-black/[0.08]">
      {children}
    </div>
  );
}
