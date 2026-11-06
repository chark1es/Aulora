import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CallPipWindow } from "../components/voice/CallPipWindow";
import {
  MAIN_WINDOW_LABEL,
  PIP_ACTION_EVENT,
  PIP_STATE_EVENT,
  type PipCallState,
} from "../lib/call-pip";

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    handlers,
    listen: vi.fn(async (event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, handler);
      return () => {
        handlers.delete(event);
      };
    }),
    emitTo: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    focus: vi.fn(async () => undefined),
  };
});

vi.mock("../lib/desktop", () => ({
  listenDesktopEvent: mocks.listen,
  emitDesktopEventTo: mocks.emitTo,
  closeDesktopPipWindow: mocks.close,
  focusDesktopMainWindow: mocks.focus,
}));

const state: PipCallState = {
  kind: "voice",
  startedAt: 0,
  muted: false,
  deafened: false,
  camera: false,
  screen: false,
  canSpeak: true,
  canVideo: true,
  canStream: true,
  participants: [
    {
      id: "me",
      name: "Ada",
      speaking: true,
      muted: false,
      deafened: false,
      camera: false,
      screen: false,
      self: true,
    },
    {
      id: "them",
      name: "Grace",
      speaking: false,
      muted: true,
      deafened: false,
      camera: false,
      screen: false,
      self: false,
    },
  ],
};

/** Renders the window and waits for it to subscribe, optionally then a state. */
async function mount(payload?: unknown) {
  render(<CallPipWindow />);
  await waitFor(() => {
    expect(mocks.handlers.has(PIP_STATE_EVENT)).toBe(true);
  });
  if (payload === undefined) {
    return;
  }
  act(() => {
    mocks.handlers.get(PIP_STATE_EVENT)?.(payload);
  });
}

beforeEach(() => {
  mocks.handlers.clear();
  mocks.emitTo.mockClear();
  mocks.close.mockClear();
  mocks.focus.mockClear();
});

describe("the call window", () => {
  it("waits for the call before drawing anything", async () => {
    await mount();
    expect(screen.getByText("Waiting for the call…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mute" })).toBeNull();
  });

  it("draws the people in the call once the main window sends them", async () => {
    await mount(state);
    expect(screen.getByText("Ada (you)")).toBeInTheDocument();
    expect(screen.getByText("Grace")).toBeInTheDocument();
    expect(screen.getByText("Voice call")).toBeInTheDocument();
    // Ada is speaking; Grace is muted. One ring for the one who is talking.
    expect(document.querySelectorAll("[data-speaking-ring]")).toHaveLength(1);
  });

  it("ignores a payload that is not a call state", async () => {
    await mount({ kind: "nonsense" });
    expect(screen.getByText("Waiting for the call…")).toBeInTheDocument();
  });

  it("sends the mute, deafen, camera and screen presses to the call", async () => {
    const user = userEvent.setup();
    await mount(state);
    await user.click(screen.getByRole("button", { name: "Mute" }));
    await user.click(screen.getByRole("button", { name: "Deafen" }));
    await user.click(screen.getByRole("button", { name: "Turn on camera" }));
    await user.click(screen.getByRole("button", { name: "Share screen" }));
    expect(mocks.emitTo.mock.calls).toEqual([
      [MAIN_WINDOW_LABEL, PIP_ACTION_EVENT, "toggle-mute"],
      [MAIN_WINDOW_LABEL, PIP_ACTION_EVENT, "toggle-deafen"],
      [MAIN_WINDOW_LABEL, PIP_ACTION_EVENT, "toggle-camera"],
      [MAIN_WINDOW_LABEL, PIP_ACTION_EVENT, "toggle-screen"],
    ]);
  });

  it("ends the call from the window", async () => {
    const user = userEvent.setup();
    await mount(state);
    await user.click(screen.getByRole("button", { name: "Leave call" }));
    expect(mocks.emitTo).toHaveBeenCalledWith(MAIN_WINDOW_LABEL, PIP_ACTION_EVENT, "leave");
  });

  it("closes only itself, and hands focus back to the app", async () => {
    const user = userEvent.setup();
    await mount(state);
    await user.click(screen.getByRole("button", { name: "Close the call window" }));
    expect(mocks.focus).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalledTimes(1);
    // Nothing is sent to the call: it is still running.
    expect(mocks.emitTo).not.toHaveBeenCalled();
  });

  it("offers only the controls the caller may use", async () => {
    await mount({ ...state, canSpeak: false, canVideo: false, canStream: false });
    expect(screen.queryByRole("button", { name: "Mute" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Turn on camera" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Share screen" })).toBeNull();
    expect(screen.getByRole("button", { name: "Leave call" })).toBeInTheDocument();
  });
});
