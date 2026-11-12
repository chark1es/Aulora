import { messageOf } from "./call-errors";
import {
  type CapturePermission,
  type DisplaySource,
  listDisplaySources,
  openCapturePermissionSettings,
  requestScreenCapturePermission,
  type SystemAudioSupport,
  screenCapturePermission,
  systemAudioSupport,
} from "./desktop-display";
import {
  getDisplayPickerState,
  IDLE_DISPLAY_PICKER,
  setDisplayPickerState,
} from "./display-picker-store";

export { getDisplayPickerState, subscribeDisplayPicker } from "./display-picker-store";

/**
 * The in-app screen/window picker, as a request the UI answers.
 *
 * The share flow starts outside React (see `acquireDisplay`), so it hands the
 * picker a promise and the modal settles it: a tile confirms with a source, a
 * cancel rejects with an `AbortError` the share flow treats as "not a failure".
 * One request is live at a time; a second replaces the first.
 *
 * Before listing anything the picker asks the OS whether Aulora may read the
 * screen. Without that grant the tiles would be black, so the dialog offers the
 * permission instead, opens the pane that grants it, and can re-check. Declining
 * then rejects with the reason, so the call says why nothing was shared.
 *
 * The same dialog carries the system-audio toggle: the shell reports whether
 * this platform can capture it at all, and the answer becomes the share’s audio
 * choice, so the person decides per share and an unsupported platform says why.
 */

export type DisplayPickerStatus =
  | "idle"
  | "checking"
  | "permission"
  | "loading"
  | "ready"
  | "error";

export interface DisplayPickerState {
  readonly status: DisplayPickerStatus;
  readonly sources: readonly DisplaySource[];
  readonly error: string | null;
  /** The tile the Share button acts on. */
  readonly selectedId: string | null;
  /** Whether the share should carry the machine’s audio. */
  readonly audioRequested: boolean;
  /** What this platform can do about system audio, once it is known. */
  readonly audio: SystemAudioSupport | null;
  /** The OS permission verdict, while it blocks or explains the share. */
  readonly permission: CapturePermission | null;
}

/** What the picker resolves: the tile and the audio choice made with it. */
export interface DisplayChoice {
  readonly source: DisplaySource;
  readonly audioRequested: boolean;
}

const NOTHING_TO_SHARE = "There is nothing to share right now.";
/** Fallback reason when the shell reports a block without its own wording. */
const NOT_ALLOWED =
  "Screen sharing needs permission Aulora doesn’t have. Allow it in your system settings to share your screen.";

export interface DisplayPickerOptions {
  /** Whether the call wants system audio with the share. */
  readonly audioRequested?: boolean;
  /** Where the tiles come from; the shell by default. */
  readonly listSources?: () => Promise<DisplaySource[]>;
  /** Reads the OS capture permission without prompting. */
  readonly readPermission?: () => Promise<CapturePermission>;
  /** Asks the OS for the permission (macOS shows its own prompt). */
  readonly requestAccess?: () => Promise<CapturePermission>;
  /** Opens the OS pane where the permission is granted. */
  readonly openSettings?: () => Promise<void>;
  /** Reads whether this platform can capture system audio. */
  readonly readAudio?: () => Promise<SystemAudioSupport>;
}

let pending: { resolve(choice: DisplayChoice): void; reject(error: unknown): void } | null = null;
let loadToken = 0;
let readSources: () => Promise<DisplaySource[]> = listDisplaySources;
let readPermission: () => Promise<CapturePermission> = screenCapturePermission;
let requestAccess: () => Promise<CapturePermission> = requestScreenCapturePermission;
let openSettings: () => Promise<void> = openCapturePermissionSettings;
let readAudio: () => Promise<SystemAudioSupport> = systemAudioSupport;

function setState(next: DisplayPickerState): void {
  setDisplayPickerState(next);
}

/** A picker state with every field at its idle value except what is given. */
function stateOf(
  fields: Pick<DisplayPickerState, "status" | "audioRequested"> & Partial<DisplayPickerState>,
): DisplayPickerState {
  return {
    sources: [],
    error: null,
    selectedId: null,
    audio: null,
    permission: null,
    ...fields,
  };
}

function abortError(): DOMException {
  return new DOMException("Screen sharing was cancelled.", "AbortError");
}

/**
 * Checks the permission, then loads the tiles for an open picker. A newer
 * request always wins, and a permission block is a state of its own so the
 * dialog can explain it instead of showing an error.
 */
async function load(audioRequested: boolean): Promise<void> {
  const token = loadToken + 1;
  loadToken = token;
  setState(stateOf({ status: "checking", audioRequested }));
  const settled = (next: DisplayPickerState) => {
    if (token === loadToken && pending !== null) {
      setState(next);
    }
  };

  // The audio capability is advisory: a shell that cannot answer must not stop
  // the share, it just loses the toggle.
  const [permission, audio] = await Promise.all([
    readPermission().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    readAudio().catch(() => null),
  ]);
  if (!permission.ok) {
    settled(stateOf({ status: "error", error: messageOf(permission.error), audioRequested }));
    return;
  }
  const permissionVerdict = permission.value;
  // Asking for audio the platform cannot produce would only produce a notice.
  const audioWanted = audioRequested && audio?.supported === true;
  if (token !== loadToken || pending === null) {
    return;
  }
  if (permissionVerdict.status !== "granted") {
    settled(
      stateOf({
        status: "permission",
        audioRequested: audioWanted,
        audio,
        permission: permissionVerdict,
      }),
    );
    return;
  }

  let sources: DisplaySource[];
  try {
    sources = await readSources();
  } catch (error) {
    settled(
      stateOf({
        status: "error",
        error: messageOf(error),
        audioRequested: audioWanted,
        audio,
        permission: permissionVerdict,
      }),
    );
    return;
  }
  if (token !== loadToken || pending === null) {
    return;
  }
  if (sources.length === 0) {
    settled(
      stateOf({
        status: "error",
        error: NOTHING_TO_SHARE,
        audioRequested: audioWanted,
        audio,
        permission: permissionVerdict,
      }),
    );
    return;
  }
  // A screen is the common share, so the first one starts selected.
  const first = sources.find((source) => source.kind === "screen") ?? sources[0];
  settled(
    stateOf({
      status: "ready",
      sources,
      selectedId: first?.id ?? null,
      audioRequested: audioWanted,
      audio,
      permission: permissionVerdict,
    }),
  );
}

/**
 * Opens the picker and resolves with the chosen source. Rejects with an
 * `AbortError` when the person closes it without sharing, or with the reason
 * when a missing permission is what stopped the share.
 */
export function requestDisplaySource(options: DisplayPickerOptions = {}): Promise<DisplayChoice> {
  const previous = pending;
  pending = null;
  previous?.reject(abortError());
  readSources = options.listSources ?? listDisplaySources;
  readPermission = options.readPermission ?? screenCapturePermission;
  requestAccess = options.requestAccess ?? requestScreenCapturePermission;
  openSettings = options.openSettings ?? openCapturePermissionSettings;
  readAudio = options.readAudio ?? systemAudioSupport;
  return new Promise<DisplayChoice>((resolve, reject) => {
    pending = { resolve, reject };
    void load(options.audioRequested === true);
  });
}

/** Selects a tile; the next confirm shares it. */
export function selectDisplaySource(sourceId: string): void {
  const state = getDisplayPickerState();
  if (state.status !== "ready" || state.selectedId === sourceId) {
    return;
  }
  if (!state.sources.some((source) => source.id === sourceId)) {
    return;
  }
  setState({ ...state, selectedId: sourceId });
}

/** Turns the share’s system audio on or off; ignored where it is unsupported. */
export function setDisplayAudioRequested(on: boolean): void {
  const state = getDisplayPickerState();
  if (state.audio?.supported !== true || state.audioRequested === on) {
    return;
  }
  setState({ ...state, audioRequested: on });
}

/** Shares the selected tile and closes the picker. */
export function confirmDisplayPicker(): void {
  const state = getDisplayPickerState();
  const source = state.sources.find((entry) => entry.id === state.selectedId);
  if (state.status !== "ready" || source === undefined) {
    return;
  }
  const request = pending;
  pending = null;
  loadToken += 1;
  const choice: DisplayChoice = { source, audioRequested: state.audioRequested };
  setState(IDLE_DISPLAY_PICKER);
  request?.resolve(choice);
}

/** Closes the picker without sharing. */
export function cancelDisplayPicker(): void {
  const state = getDisplayPickerState();
  const blocking = state.status === "permission" ? state.permission : null;
  loadToken += 1;
  setState(IDLE_DISPLAY_PICKER);
  const request = pending;
  pending = null;
  if (blocking === null) {
    request?.reject(abortError());
    return;
  }
  // Declining a permission is the reason nothing was shared, so say it rather
  // than swallowing the attempt as a plain cancel.
  request?.reject(new Error(blocking.detail ?? NOT_ALLOWED));
}

/** Re-checks the permission and reloads the tiles, for a "check again" action. */
export function retryDisplayPicker(): void {
  if (pending === null) {
    return;
  }
  void load(getDisplayPickerState().audioRequested);
}

/**
 * Opens the OS pane that grants screen recording, asking the OS first so Aulora
 * is listed there. Continues straight to the tiles if access was just granted.
 */
export async function openDisplayPermissionSettings(): Promise<void> {
  const state = getDisplayPickerState();
  if (pending === null || state.permission?.canOpenSettings !== true) {
    return;
  }
  const token = loadToken;
  const audioRequested = state.audioRequested;
  try {
    const permission = await requestAccess();
    if (pending === null || token !== loadToken) {
      return;
    }
    if (permission.status === "granted") {
      void load(audioRequested);
      return;
    }
    setState({ ...state, permission });
  } catch {
    // The pane is still worth opening; the detail text says what to enable.
  }
  if (pending === null || token !== loadToken) {
    return;
  }
  try {
    await openSettings();
  } catch {
    // Nothing else to do: the detail text names the setting by hand.
  }
}
