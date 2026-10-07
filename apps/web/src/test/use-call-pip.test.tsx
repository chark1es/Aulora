import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceSnapshot } from "../lib/voice/call-types";
import type { PipMode } from "../lib/voice/pip";
import { type CallPipOptions, useCallPip } from "../providers/use-call-pip";

const mocks = vi.hoisted(() => ({
  mode: "window" as PipMode,
  enterMini: vi.fn(async () => true),
  exitMini: vi.fn(async () => undefined),
  isMini: vi.fn(async () => false),
  alwaysOnTop: vi.fn(async () => undefined),
  openDocument: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
  startVideo: vi.fn(),
}));

vi.mock("../lib/desktop", () => ({
  enterDesktopMiniWindow: mocks.enterMini,
  exitDesktopMiniWindow: mocks.exitMini,
  isDesktopMiniWindow: mocks.isMini,
  setDesktopAlwaysOnTop: mocks.alwaysOnTop,
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

const snapshot = {
  call: { participants: [] },
  remoteStreams: new Map(),
  remoteScreens: new Map(),
  remoteSpeaking: new Set(),
} as unknown as VoiceSnapshot;

function setup(overrides: Partial<CallPipOptions> = {}) {
  const setPinned = vi.fn();
  const controls = { toggleMicrophone: vi.fn(), toggleCamera: vi.fn(), hangUp: vi.fn() };
  const initial: CallPipOptions = {
    callActive: true,
    snapshot,
    selfUserId: "me",
    pinned: false,
    setPinned,
    controls,
    ...overrides,
  };
  const view = renderHook((props: CallPipOptions) => useCallPip(props), {
    initialProps: initial,
  });
  return { ...view, setPinned, controls, initial };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    if (typeof mock === "function") {
      mock.mockClear();
    }
  }
  mocks.mode = "window";
  mocks.enterMini.mockResolvedValue(true);
});

describe("desktop window mode", () => {
  it("shrinks the window and keeps it on top", async () => {
    const { result, setPinned } = setup();
    expect(result.current.pip.mode).toBe("window");
    act(() => {
      result.current.pip.toggle();
    });
    await waitFor(() => {
      expect(result.current.pip.active).toBe(true);
    });
    expect(mocks.enterMini).toHaveBeenCalledTimes(1);
    expect(result.current.surface.mini).toBe(true);
    expect(setPinned).toHaveBeenCalledWith(true);
  });

  it("restores the window and undoes only the pin it added", async () => {
    const { result, setPinned } = setup();
    act(() => {
      result.current.pip.toggle();
    });
    await waitFor(() => {
      expect(result.current.pip.active).toBe(true);
    });
    act(() => {
      result.current.pip.toggle();
    });
    expect(result.current.pip.active).toBe(false);
    expect(mocks.exitMini).toHaveBeenCalled();
    expect(setPinned).toHaveBeenLastCalledWith(false);
  });

  it("leaves a pin the user set themselves alone", async () => {
    const { result, setPinned } = setup({ pinned: true });
    act(() => {
      result.current.pip.toggle();
    });
    await waitFor(() => {
      expect(result.current.pip.active).toBe(true);
    });
    expect(setPinned).not.toHaveBeenCalled();
    act(() => {
      result.current.pip.toggle();
    });
    expect(setPinned).not.toHaveBeenCalled();
  });

  it("does not claim to be floating when the shell refuses", async () => {
    mocks.enterMini.mockResolvedValue(false);
    const { result, setPinned } = setup();
    act(() => {
      result.current.pip.toggle();
    });
    await waitFor(() => {
      expect(mocks.enterMini).toHaveBeenCalled();
    });
    expect(result.current.pip.active).toBe(false);
    expect(setPinned).not.toHaveBeenCalled();
  });

  it("restores the window when the call ends", async () => {
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
    expect(mocks.exitMini).toHaveBeenCalled();
  });

  it("restores a window a reload left small", async () => {
    mocks.isMini.mockResolvedValueOnce(true);
    setup();
    await waitFor(() => {
      expect(mocks.exitMini).toHaveBeenCalled();
    });
  });

  it("mirrors the pin to the operating system window", () => {
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
    expect(mocks.enterMini).not.toHaveBeenCalled();
    expect(mocks.openDocument).not.toHaveBeenCalled();
    expect(mocks.startVideo).not.toHaveBeenCalled();
  });
});
