import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PIP_ACTION_EVENT,
  PIP_CLOSED_EVENT,
  PIP_SIGNAL_EVENT,
  PIP_STATE_EVENT,
  PIP_WINDOW_LABEL,
  parsePipState,
} from "../lib/call-pip";
import type { VoiceSnapshot } from "../lib/voice/call-types";
import type { PipMode } from "../lib/voice/pip";
import { type CallPipOptions, useCallPip } from "../providers/use-call-pip";

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    mode: "window" as PipMode,
    openPip: vi.fn(async () => true),
    closePip: vi.fn(async () => undefined),
    isPipOpen: vi.fn(async () => false),
    emitTo: vi.fn(async () => undefined),
    alwaysOnTop: vi.fn(async () => undefined),
    openDocument: vi.fn(),
    register: vi.fn(),
    unregister: vi.fn(),
    startVideo: vi.fn(),
    desktopMode: vi.fn(async () => "window"),
    frames: [] as { setTrack: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[],
    startFrames: vi.fn(() => {
      const instance = { setTrack: vi.fn(), close: vi.fn() };
      mocks.frames.push(instance);
      return instance;
    }),
    handlers,
    listen: vi.fn(async (event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, handler);
      return () => {
        handlers.delete(event);
      };
    }),
  };
});

vi.mock("../lib/desktop", () => ({
  openDesktopPipWindow: mocks.openPip,
  closeDesktopPipWindow: mocks.closePip,
  isDesktopPipWindowOpen: mocks.isPipOpen,
  emitDesktopEventTo: mocks.emitTo,
  listenDesktopEvent: mocks.listen,
  setDesktopAlwaysOnTop: mocks.alwaysOnTop,
  desktopPipMode: mocks.desktopMode,
  isDesktop: () => true,
}));
vi.mock("../lib/voice/pip-frames", () => ({
  choosePipTransport: () => "frames",
  framesSupported: () => true,
  startPipFrameSender: mocks.startFrames,
}));
vi.mock("../lib/voice/pip", () => ({
  detectPipMode: () => mocks.mode,
  openDocumentPip: mocks.openDocument,
  registerCallSession: (actions: unknown) => {
    mocks.register(actions);
    return mocks.unregister;
  },
}));
vi.mock("../lib/voice/video-pip", () => ({ startVideoPip: mocks.startVideo }));

const participant = (userId: string, extra: Record<string, unknown> = {}) => ({
  userId,
  muted: false,
  deafened: false,
  video: false,
  sharingScreen: false,
  sfu: true,
  joinedAt: 0,
  clientId: null,
  session: 1,
  speaking: false,
  audioLevel: 0,
  connection: "connected",
  ...extra,
});

const snapshot = {
  callId: "call-1",
  call: {
    id: "call-1",
    channelId: "ch",
    kind: "voice",
    status: "active",
    initiatorId: "me",
    ringingUserIds: [],
    screenShareUserId: null,
    startedAt: 1_000,
    participants: [participant("me"), participant("them", { muted: true })],
  },
  local: { muted: false, deafened: false, video: false, sharingScreen: false },
  remoteStreams: new Map(),
  remoteScreens: new Map(),
  remoteSpeaking: new Set(["them"]),
  localSpeaking: true,
} as unknown as VoiceSnapshot;

function setup(overrides: Partial<CallPipOptions> = {}) {
  const controls = {
    toggleMicrophone: vi.fn(),
    toggleDeafen: vi.fn(),
    toggleCamera: vi.fn(),
    toggleScreen: vi.fn(),
    hangUp: vi.fn(),
  };
  const initial: CallPipOptions = {
    callActive: true,
    snapshot,
    selfUserId: "me",
    canSpeak: true,
    canVideo: true,
    canStream: true,
    pinned: false,
    controls,
    ...overrides,
  };
  const view = renderHook((props: CallPipOptions) => useCallPip(props), {
    initialProps: initial,
  });
  return { ...view, controls, initial };
}

function fire(event: string, payload?: unknown) {
  const handler = mocks.handlers.get(event);
  if (handler === undefined) {
    throw new Error(`nothing listens for ${event}`);
  }
  act(() => {
    handler(payload);
  });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    if (typeof mock === "function" && "mockClear" in mock) {
      mock.mockClear();
    }
  }
  mocks.handlers.clear();
  mocks.frames.length = 0;
  mocks.mode = "window";
  mocks.openPip.mockResolvedValue(true);
  mocks.isPipOpen.mockResolvedValue(false);
  mocks.desktopMode.mockResolvedValue("window");
});

describe("desktop window mode", () => {
  it("opens the shell's own call window and leaves the app window alone", async () => {
    const { result } = setup();
    expect(result.current.pip.mode).toBe("window");
    act(() => {
      result.current.pip.toggle((id) => `Name of ${id}`);
    });
    await waitFor(() => {
      expect(result.current.pip.active).toBe(true);
    });
    expect(mocks.openPip).toHaveBeenCalledWith(380, 292);
    // The app window is never pinned or resized for the call window.
    expect(mocks.alwaysOnTop).not.toHaveBeenCalledWith(true);
  });

  it("keeps the in-app dock on a compositor that cannot float a window", async () => {
    mocks.desktopMode.mockResolvedValue("dock");
    const { result } = setup();
    await waitFor(() => {
      expect(result.current.pip.mode).toBe("none");
    });
    expect(result.current.pip.active).toBe(false);
  });

  it("does not claim to be floating when the shell refuses", async () => {
    mocks.openPip.mockResolvedValue(false);
    const { result } = setup();
    act(() => {
      result.current.pip.toggle();
    });
    await waitFor(() => {
      expect(mocks.openPip).toHaveBeenCalled();
    });
    expect(result.current.pip.active).toBe(false);
  });

  it("streams the call to the window, once per change", async () => {
    const { result, rerender, initial } = setup();
    act(() => {
      result.current.pip.toggle((id) => `Name of ${id}`);
    });
    await waitFor(() => {
      expect(mocks.emitTo).toHaveBeenCalled();
    });
    const call = mocks.emitTo.mock.calls[0] as unknown as [string, string, unknown];
    expect(call[0]).toBe(PIP_WINDOW_LABEL);
    expect(call[1]).toBe(PIP_STATE_EVENT);
    const state = parsePipState(call[2]);
    expect(state).not.toBeNull();
    expect(state?.participants.map((entry) => entry.name)).toEqual(["Name of me", "Name of them"]);
    expect(state?.participants[0]?.speaking).toBe(true);
    expect(state?.participants[1]?.speaking).toBe(true);

    // A change in the call reaches the window; an unchanged one does not.
    const before = mocks.emitTo.mock.calls.length;
    rerender({
      ...initial,
      snapshot: {
        ...snapshot,
        local: { ...snapshot.local, muted: true },
      } as unknown as VoiceSnapshot,
    });
    await waitFor(() => {
      expect(mocks.emitTo.mock.calls.length).toBe(before + 1);
    });
    const update = mocks.emitTo.mock.calls.at(-1) as unknown as [string, string, unknown];
    expect(parsePipState(update[2])?.muted).toBe(true);
  });

  it("falls back to frames when the webview has no loopback peer connection", async () => {
    const { result } = setup();
    act(() => {
      result.current.pip.toggle();
    });
    await waitFor(() => {
      expect(result.current.pip.active).toBe(true);
    });
    await waitFor(() => {
      expect(mocks.startFrames).toHaveBeenCalledTimes(1);
    });
    // The window's end of the loopback is heard even though the fallback is up.
    expect(mocks.handlers.has(PIP_SIGNAL_EVENT)).toBe(true);
    // Nobody has a camera in this call, so the sender starts with no track.
    expect(mocks.startFrames).toHaveBeenCalledWith({ track: null });
  });

  it("offers no video-only PiP while the operator has switched video off", async () => {
    mocks.mode = "video";
    const { result } = setup({ videoDisabled: true });
    expect(result.current.pip.mode).toBe("none");
    act(() => {
      result.current.pip.toggle();
    });
    await Promise.resolve();
    expect(mocks.startVideo).not.toHaveBeenCalled();
    expect(result.current.pip.active).toBe(false);
  });

  it("offers no document PiP while the operator has switched video off", async () => {
    mocks.mode = "document";
    const { result } = setup({ videoDisabled: true });
    expect(result.current.pip.mode).toBe("none");
    act(() => {
      result.current.pip.toggle();
    });
    await Promise.resolve();
    expect(mocks.openDocument).not.toHaveBeenCalled();
    expect(result.current.pip.active).toBe(false);
  });

  it("keeps the document PiP available when video is on", async () => {
    mocks.mode = "document";
    const { result } = setup();
    expect(result.current.pip.mode).toBe("document");
  });

  it("closes a floating video when the operator switches video off", async () => {
    mocks.mode = "video";
    const stop = vi.fn();
    mocks.startVideo.mockResolvedValue({ setSource: vi.fn(), stop });
    const { result, rerender, initial } = setup();
    act(() => {
      result.current.pip.toggle();
    });
    await waitFor(() => {
      expect(result.current.pip.active).toBe(true);
    });
    rerender({ ...initial, videoDisabled: true });
    await waitFor(() => {
      expect(stop).toHaveBeenCalled();
    });
  });

  it("stops the frame fallback when the window goes away", async () => {
    const { result } = setup();
    act(() => {
      result.current.pip.toggle();
    });
    await waitFor(() => {
      expect(result.current.pip.active).toBe(true);
    });
    await waitFor(() => {
      expect(mocks.frames).toHaveLength(1);
    });
    fire(PIP_CLOSED_EVENT);
    expect(mocks.frames[0]?.close).toHaveBeenCalledTimes(1);
  });

  it("stops floating when the shell says the window is gone", async () => {
    const { result } = setup();
    act(() => {
      result.current.pip.toggle();
    });
    await waitFor(() => {
      expect(result.current.pip.active).toBe(true);
    });
    fire(PIP_CLOSED_EVENT);
    expect(result.current.pip.active).toBe(false);
    // The call is untouched, and the window is already closed.
    expect(mocks.closePip).not.toHaveBeenCalled();
    expect(result.current.pip.mode).toBe("window");
  });

  it("runs the controls pressed in the window", async () => {
    const { result, controls } = setup();
    act(() => {
      result.current.pip.toggle();
    });
    await waitFor(() => {
      expect(mocks.handlers.has(PIP_ACTION_EVENT)).toBe(true);
    });
    fire(PIP_ACTION_EVENT, "toggle-mute");
    fire(PIP_ACTION_EVENT, "toggle-deafen");
    fire(PIP_ACTION_EVENT, "toggle-camera");
    fire(PIP_ACTION_EVENT, "toggle-screen");
    fire(PIP_ACTION_EVENT, "leave");
    expect(controls.toggleMicrophone).toHaveBeenCalledTimes(1);
    expect(controls.toggleDeafen).toHaveBeenCalledTimes(1);
    expect(controls.toggleCamera).toHaveBeenCalledTimes(1);
    expect(controls.toggleScreen).toHaveBeenCalledTimes(1);
    expect(controls.hangUp).toHaveBeenCalledTimes(1);
  });

  it("ignores a press it does not understand", async () => {
    const { result, controls } = setup();
    act(() => {
      result.current.pip.toggle();
    });
    await waitFor(() => {
      expect(mocks.handlers.has(PIP_ACTION_EVENT)).toBe(true);
    });
    fire(PIP_ACTION_EVENT, "launch-missiles");
    fire(PIP_ACTION_EVENT, { action: "leave" });
    expect(controls.toggleMicrophone).not.toHaveBeenCalled();
    expect(controls.hangUp).not.toHaveBeenCalled();
  });

  it("closes the window when the call ends", async () => {
    const { result, rerender, initial } = setup();
    act(() => {
      result.current.pip.toggle();
    });
    await waitFor(() => {
      expect(result.current.pip.active).toBe(true);
    });
    rerender({ ...initial, callActive: false });
    await waitFor(() => {
      expect(result.current.pip.active).toBe(false);
    });
    expect(mocks.closePip).toHaveBeenCalled();
  });

  it("adopts a window a reload left open", async () => {
    mocks.isPipOpen.mockResolvedValueOnce(true);
    const { result } = setup();
    await waitFor(() => {
      expect(result.current.pip.active).toBe(true);
    });
    expect(mocks.openPip).not.toHaveBeenCalled();
  });

  it("closes a window left open by a reload outside any call", async () => {
    setup({ callActive: false });
    await waitFor(() => {
      expect(mocks.closePip).toHaveBeenCalled();
    });
  });

  it("mirrors the dock's pin to the operating system window", () => {
    const { rerender, initial } = setup();
    expect(mocks.alwaysOnTop).toHaveBeenLastCalledWith(false);
    rerender({ ...initial, pinned: true });
    expect(mocks.alwaysOnTop).toHaveBeenLastCalledWith(true);
  });
});

describe("document picture-in-picture mode", () => {
  function fakeWindow() {
    const listeners = new Map<string, () => void>();
    return {
      close: vi.fn(),
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      fire: (type: string) => listeners.get(type)?.(),
    };
  }

  beforeEach(() => {
    mocks.mode = "document";
  });

  it("opens the window and exposes it for the page to draw into", async () => {
    const created = fakeWindow();
    mocks.openDocument.mockResolvedValue(created);
    const { result } = setup();
    act(() => {
      result.current.pip.toggle();
    });
    await waitFor(() => {
      expect(result.current.surface.window).toBe(created);
    });
    expect(result.current.pip.active).toBe(true);
  });

  it("notices the user closing the window", async () => {
    const created = fakeWindow();
    mocks.openDocument.mockResolvedValue(created);
    const { result } = setup();
    act(() => {
      result.current.pip.toggle();
    });
    await waitFor(() => {
      expect(result.current.pip.active).toBe(true);
    });
    act(() => {
      created.fire("pagehide");
    });
    expect(result.current.pip.active).toBe(false);
    expect(result.current.surface.window).toBeNull();
  });

  it("closes the window itself on the second toggle", async () => {
    const created = fakeWindow();
    mocks.openDocument.mockResolvedValue(created);
    const { result } = setup();
    act(() => {
      result.current.pip.toggle();
    });
    await waitFor(() => {
      expect(result.current.pip.active).toBe(true);
    });
    act(() => {
      result.current.pip.toggle();
    });
    expect(created.close).toHaveBeenCalled();
    expect(result.current.pip.active).toBe(false);
  });

  it("stays closed when the browser refuses", async () => {
    mocks.openDocument.mockResolvedValue(null);
    const { result } = setup();
    act(() => {
      result.current.pip.toggle();
    });
    await waitFor(() => {
      expect(mocks.openDocument).toHaveBeenCalled();
    });
    expect(result.current.pip.active).toBe(false);
  });

  it("lets the browser open it when the user leaves the tab", async () => {
    const created = fakeWindow();
    mocks.openDocument.mockResolvedValue(created);
    const { result } = setup();
    const actions = mocks.register.mock.calls.at(-1)?.[0] as {
      enterPictureInPicture?: () => void;
    };
    expect(actions.enterPictureInPicture).toBeTypeOf("function");
    act(() => {
      actions.enterPictureInPicture?.();
    });
    await waitFor(() => {
      expect(result.current.pip.active).toBe(true);
    });
  });
});

describe("browser registration", () => {
  it("offers the media-key actions in every mode, but auto-PiP only for documents", () => {
    setup();
    const actions = mocks.register.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(actions.enterPictureInPicture).toBeUndefined();
    expect(actions.toggleMicrophone).toBeTypeOf("function");
  });

  it("routes the browser's buttons to the call, using the latest state", () => {
    const { controls } = setup();
    const actions = mocks.register.mock.calls.at(-1)?.[0] as {
      toggleMicrophone: () => void;
      toggleCamera: () => void;
      hangUp: () => void;
    };
    actions.toggleMicrophone();
    actions.toggleCamera();
    actions.hangUp();
    expect(controls.toggleMicrophone).toHaveBeenCalled();
    expect(controls.toggleCamera).toHaveBeenCalled();
    expect(controls.hangUp).toHaveBeenCalled();
  });

  it("registers nothing outside a call, and unregisters when it ends", () => {
    const { rerender, initial } = setup({ callActive: false });
    expect(mocks.register).not.toHaveBeenCalled();
    rerender({ ...initial, callActive: true });
    expect(mocks.register).toHaveBeenCalledTimes(1);
    rerender({ ...initial, callActive: false });
    expect(mocks.unregister).toHaveBeenCalled();
  });
});

describe("floating video mode", () => {
  beforeEach(() => {
    mocks.mode = "video";
  });

  it("starts the floating video and notices it being closed", async () => {
    let closed: () => void = () => undefined;
    const video = { setSource: vi.fn(), stop: vi.fn() };
    mocks.startVideo.mockImplementation(async (_source: unknown, onClosed: () => void) => {
      closed = onClosed;
      return video;
    });
    const { result } = setup();
    act(() => {
      result.current.pip.toggle((id) => `Name of ${id}`);
    });
    await waitFor(() => {
      expect(result.current.pip.active).toBe(true);
    });
    act(() => {
      closed();
    });
    expect(result.current.pip.active).toBe(false);
  });

  it("stops the video on the second toggle", async () => {
    const video = { setSource: vi.fn(), stop: vi.fn() };
    mocks.startVideo.mockResolvedValue(video);
    const { result } = setup();
    act(() => {
      result.current.pip.toggle();
    });
    await waitFor(() => {
      expect(result.current.pip.active).toBe(true);
    });
    act(() => {
      result.current.pip.toggle();
    });
    expect(video.stop).toHaveBeenCalled();
    expect(result.current.pip.active).toBe(false);
  });

  it("stays closed when the browser refuses", async () => {
    mocks.startVideo.mockRejectedValue(new Error("not allowed"));
    const { result } = setup();
    act(() => {
      result.current.pip.toggle();
    });
    await waitFor(() => {
      expect(mocks.startVideo).toHaveBeenCalled();
    });
    expect(result.current.pip.active).toBe(false);
  });
});

describe("no picture-in-picture", () => {
  it("does nothing when the platform has none", () => {
    mocks.mode = "none";
    const { result } = setup();
    act(() => {
      result.current.pip.toggle();
    });
    expect(result.current.pip.active).toBe(false);
    expect(mocks.openPip).not.toHaveBeenCalled();
    expect(mocks.openDocument).not.toHaveBeenCalled();
    expect(mocks.startVideo).not.toHaveBeenCalled();
  });
});
