import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTypingTarget, matchDesktopShortcut, useDesktopShortcuts } from "./use-desktop-shortcuts";

const mocks = vi.hoisted(() => ({
  desktop: true,
  platform: "windows" as "windows" | "linux" | "macos",
  toggleFullscreen: vi.fn(async () => undefined),
}));

vi.mock("./desktop", () => ({
  isDesktop: () => mocks.desktop,
  desktopPlatform: () => mocks.platform,
  toggleDesktopFullscreen: mocks.toggleFullscreen,
}));

function press(key: string, options: KeyboardEventInit = {}): boolean {
  return window.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true, ...options }));
}

beforeEach(() => {
  mocks.desktop = true;
  mocks.platform = "windows";
  mocks.toggleFullscreen.mockClear();
});

describe("matchDesktopShortcut", () => {
  const base = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };

  it("maps Ctrl+N to connect and Ctrl+Shift+D to the sidebar", () => {
    expect(matchDesktopShortcut({ ...base, key: "n", ctrlKey: true })).toBe("connect");
    expect(matchDesktopShortcut({ ...base, key: "d", ctrlKey: true, shiftKey: true })).toBe(
      "toggle-sidebar",
    );
  });

  it("maps F11 to fullscreen", () => {
    expect(matchDesktopShortcut({ ...base, key: "F11" })).toBe("toggle-fullscreen");
  });

  it("leaves every other combination alone", () => {
    expect(matchDesktopShortcut({ ...base, key: "n" })).toBeNull();
    expect(matchDesktopShortcut({ ...base, key: "d", ctrlKey: true })).toBeNull();
    expect(matchDesktopShortcut({ ...base, key: "n", metaKey: true, ctrlKey: true })).toBeNull();
    expect(matchDesktopShortcut({ ...base, key: "k", ctrlKey: true })).toBeNull();
  });
});

describe("isTypingTarget", () => {
  it("recognises text fields and contenteditable hosts", () => {
    const input = document.createElement("input");
    const area = document.createElement("textarea");
    const region = document.createElement("div");
    region.setAttribute("contenteditable", "true");
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(area)).toBe(true);
    expect(isTypingTarget(region)).toBe(true);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("useDesktopShortcuts", () => {
  it("connects on Ctrl+N on Windows", () => {
    const onConnect = vi.fn();
    const { unmount } = renderHook(() => {
      useDesktopShortcuts({ onConnect });
    });
    const dispatched = press("n", { ctrlKey: true });
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(dispatched).toBe(false);
    unmount();
  });

  it("toggles the sidebar through the same window event as the native menu", () => {
    const listener = vi.fn();
    window.addEventListener("aulora:toggle-sidebar", listener);
    const { unmount } = renderHook(() => {
      useDesktopShortcuts({ onConnect: vi.fn() });
    });
    press("d", { ctrlKey: true, shiftKey: true });
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("aulora:toggle-sidebar", listener);
    unmount();
  });

  it("asks the shell for fullscreen on F11", () => {
    const { unmount } = renderHook(() => {
      useDesktopShortcuts({ onConnect: vi.fn() });
    });
    press("F11");
    expect(mocks.toggleFullscreen).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("does not run on macOS, where the menu owns the accelerators", () => {
    mocks.platform = "macos";
    const onConnect = vi.fn();
    const { unmount } = renderHook(() => {
      useDesktopShortcuts({ onConnect });
    });
    press("n", { ctrlKey: true });
    expect(onConnect).not.toHaveBeenCalled();
    unmount();
  });

  it("does nothing outside the desktop shell", () => {
    mocks.desktop = false;
    const onConnect = vi.fn();
    const { unmount } = renderHook(() => {
      useDesktopShortcuts({ onConnect });
    });
    press("n", { ctrlKey: true });
    expect(onConnect).not.toHaveBeenCalled();
    unmount();
  });

  it("runs Ctrl chords from the composer but leaves F11 to a text field", () => {
    const input = document.createElement("textarea");
    document.body.append(input);
    const onConnect = vi.fn();
    const { unmount } = renderHook(() => {
      useDesktopShortcuts({ onConnect });
    });
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "n", ctrlKey: true, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "F11", bubbles: true }));
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(mocks.toggleFullscreen).not.toHaveBeenCalled();
    input.remove();
    unmount();
  });
});
