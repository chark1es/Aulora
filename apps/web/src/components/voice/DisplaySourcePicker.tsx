import { Button, cn, Icon, Modal, Spinner, Switch } from "@aulora/ui-web";
import { useState, useSyncExternalStore } from "react";
import type {
  CapturePermission,
  DisplaySource,
  DisplaySourceKind,
  SystemAudioSupport,
} from "../../lib/voice/desktop-display";
import {
  cancelDisplayPicker,
  confirmDisplayPicker,
  type DisplayPickerState,
  getDisplayPickerState,
  openDisplayPermissionSettings,
  retryDisplayPicker,
  selectDisplaySource,
  setDisplayAudioRequested,
  subscribeDisplayPicker,
} from "../../lib/voice/display-picker";

/**
 * Aulora’s own screen panes picker, used by the desktop shell.
 *
 * The webview’s `getDisplayMedia` picker is drawn by the engine (it even names
 * the `tauri.localhost` origin), so the shell lists the sources instead and
 * this dialog chooses one. It renders nothing outside the desktop share flow.
 * The browser build keeps the engine picker and never opens this.
 *
 * Before any tile is listed the dialog shows the OS permission state: asking
 * for screen recording on macOS, and saying plainly when the session cannot
 * share at all (Wayland). Capturing without that grant would only produce black
 * frames, which looks like a bug instead of a permission.
 */
export function DisplaySourcePicker() {
  const state = useSyncExternalStore(
    subscribeDisplayPicker,
    getDisplayPickerState,
    getDisplayPickerState,
  );
  const [opening, setOpening] = useState(false);
  const selected = state.sources.find((source) => source.id === state.selectedId) ?? null;
  const permission = state.permission;
  const blocked = state.status === "permission" ? permission : null;
  const description = modalDescription(state.status, permission);

  const openSettings = async () => {
    setOpening(true);
    try {
      await openDisplayPermissionSettings();
    } finally {
      setOpening(false);
    }
  };

  return (
    <Modal
      open={state.status !== "idle"}
      onClose={cancelDisplayPicker}
      label={blocked === null ? "Share your screen" : "Screen sharing permission"}
      title={modalTitle(state.status, permission)}
      {...(description !== undefined ? { description } : {})}
      icon={<Icon name={blocked === null ? "monitor" : "shield"} size={18} />}
      size="lg"
      footer={
        <PickerFooter
          state={state}
          selected={selected}
          opening={opening}
          onOpenSettings={openSettings}
        />
      }
    >
      <PickerBody state={state} />
    </Modal>
  );
}

function modalTitle(status: DisplayPickerState["status"], permission: CapturePermission | null) {
  if (status !== "permission") {
    return "Share your screen";
  }
  return permission?.status === "unsupported"
    ? "Screen sharing isn’t available here"
    : "Allow screen recording";
}

function modalDescription(
  status: DisplayPickerState["status"],
  permission: CapturePermission | null,
): string | undefined {
  if (status === "permission") {
    return permission?.status === "unsupported"
      ? undefined
      : "Aulora needs this permission before it can share your screen and its audio with the call.";
  }
  if (status === "checking") {
    return undefined;
  }
  return "Choose a screen or a window. Everyone in the call sees it.";
}

function PickerFooter({
  state,
  selected,
  opening,
  onOpenSettings,
}: {
  readonly state: DisplayPickerState;
  readonly selected: DisplaySource | null;
  readonly opening: boolean;
  readonly onOpenSettings: () => Promise<void>;
}) {
  if (state.status === "permission" && state.permission !== null) {
    return (
      <>
        <Button type="button" variant="ghost" onClick={cancelDisplayPicker}>
          Cancel
        </Button>
        <Button type="button" variant="secondary" onClick={retryDisplayPicker}>
          {state.permission.canOpenSettings ? "Check again" : "Try again"}
        </Button>
        {state.permission.canOpenSettings && (
          <Button type="button" variant="primary" loading={opening} onClick={onOpenSettings}>
            Open System Settings
          </Button>
        )}
      </>
    );
  }
  return (
    <>
      <Button type="button" variant="ghost" onClick={cancelDisplayPicker}>
        Cancel
      </Button>
      {state.status === "error" ? (
        <Button type="button" variant="primary" onClick={retryDisplayPicker}>
          Try again
        </Button>
      ) : (
        <Button
          type="button"
          variant="primary"
          disabled={selected === null}
          onClick={confirmDisplayPicker}
        >
          Share
        </Button>
      )}
    </>
  );
}

function PickerBody({ state }: { readonly state: DisplayPickerState }) {
  if (state.status === "checking") {
    return (
      <div className="flex items-center justify-center gap-3 py-14 text-text-muted">
        <Spinner size={20} label="Checking screen sharing permission" />
        <span className="text-[13px]">Checking screen sharing permission…</span>
      </div>
    );
  }
  if (state.status === "permission" && state.permission !== null) {
    return <PermissionBody permission={state.permission} />;
  }
  if (state.status === "loading") {
    return (
      <div className="flex items-center justify-center gap-3 py-14 text-text-muted">
        <Spinner size={20} label="Looking for screens and windows" />
        <span className="text-[13px]">Looking for screens and windows…</span>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p role="alert" className="max-w-sm text-[13px] leading-relaxed text-text-muted">
          {state.error}
        </p>
      </div>
    );
  }
  const screens = state.sources.filter((source) => source.kind === "screen");
  const windows = state.sources.filter((source) => source.kind === "window");
  return (
    <div className="flex flex-col gap-5">
      <SourceSection
        title="Screens"
        sources={screens}
        selectedId={state.selectedId}
        onSelect={selectDisplaySource}
      />
      {windows.length > 0 && (
        <SourceSection
          title="Windows"
          sources={windows}
          selectedId={state.selectedId}
          onSelect={selectDisplaySource}
        />
      )}
      {state.audio !== null && (
        <AudioToggle
          audio={state.audio}
          requested={state.audioRequested}
          onChange={setDisplayAudioRequested}
        />
      )}
    </div>
  );
}

/** The share’s audio switch, with the platform’s own caveat underneath. */
function AudioToggle({
  audio,
  requested,
  onChange,
}: {
  readonly audio: SystemAudioSupport;
  readonly requested: boolean;
  // eslint-disable-next-line no-unused-vars -- parameter name documents the callback contract
  readonly onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-1 border-t border-border/60 pt-3">
      <Switch
        checked={requested}
        onChange={onChange}
        disabled={!audio.supported}
        label="Share system audio"
        {...(audio.detail !== null ? { description: audio.detail } : {})}
      />
      {!audio.supported && (
        <p className="text-[12.5px] leading-relaxed text-text-muted">
          Without it the share still works; it sends video only.
        </p>
      )}
    </div>
  );
}

/** Explains a blocked share, and what happens if it stays blocked. */
function PermissionBody({ permission }: { readonly permission: CapturePermission }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] leading-relaxed text-text-muted">
        {permission.detail ??
          "Aulora is missing a permission the system needs before it can read your screen."}
      </p>
      <p className="text-[12.5px] leading-relaxed text-text-muted">
        {permission.canOpenSettings
          ? "Nothing is shared until this is allowed. Close this and share again whenever you’re ready."
          : "Nothing is shared in this session. Close this and try again from a session that allows it."}
      </p>
    </div>
  );
}

function SourceSection({
  title,
  sources,
  selectedId,
  onSelect,
}: {
  readonly title: string;
  readonly sources: readonly DisplaySource[];
  readonly selectedId: string | null;
  // eslint-disable-next-line no-unused-vars -- parameter name documents the callback contract
  readonly onSelect: (sourceId: string) => void;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{title}</h3>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {sources.map((source) => (
          <SourceTile
            key={source.id}
            source={source}
            selected={source.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

function SourceTile({
  source,
  selected,
  onSelect,
}: {
  readonly source: DisplaySource;
  readonly selected: boolean;
  readonly onSelect: (sourceId: string) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={source.name}
      onClick={() => {
        onSelect(source.id);
      }}
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-[10px] p-1.5 text-left transition",
        selected
          ? "bg-accent/[0.12] ring-1 ring-accent"
          : "hover:bg-surface-3 focus-visible:bg-surface-3",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
      )}
    >
      <span className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-[7px] bg-black/35">
        {source.thumbnail === null ? (
          <Icon name={tileIcon(source.kind)} size={22} className="text-text-muted" />
        ) : (
          <img src={source.thumbnail} alt="" className="h-full w-full object-cover" />
        )}
      </span>
      <span className="line-clamp-2 min-w-0 break-words text-[12px] leading-snug text-text">
        {source.name}
      </span>
    </button>
  );
}

function tileIcon(kind: DisplaySourceKind): "desktop" | "monitor" {
  return kind === "screen" ? "desktop" : "monitor";
}
