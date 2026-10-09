import { DEFAULT_VOICE_SETTINGS } from "@aulora/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CallCompactView } from "../components/voice/CallCompactView";
import { UNKNOWN_IDENTITY } from "../components/voice/identity";
import type { PipMode } from "../lib/voice/pip";

const state = vi.hoisted(() => ({
  mode: "window" as PipMode,
  active: false,
  pinned: false,
  toggle: vi.fn(),
  setPinned: vi.fn(),
  setView: vi.fn(),
}));

vi.mock("../providers/VoiceProvider", () => ({
  useVoice: () => ({
    call: { id: "c", kind: "voice", startedAt: 0, participants: [] },
    pip: { mode: state.mode, active: state.active, toggle: state.toggle },
    pipPinned: state.pinned,
    setPipPinned: state.setPinned,
    setView: state.setView,
    remoteStreams: new Map(),
    remoteScreens: new Map(),
    remoteSpeaking: new Set(),
    selfUserId: "me",
    localVideoTrack: null,
    settings: DEFAULT_VOICE_SETTINGS,
    localSpeaking: false,
    local: { muted: false, deafened: false, video: false, sharingScreen: false },
    canSpeak: true,
    canVideo: true,
    canStream: true,
    mediaError: null,
    setMuted: vi.fn(),
    setDeafened: vi.fn(),
    setCamera: vi.fn(),
    setScreenSharing: vi.fn(),
    leave: vi.fn(),
  }),
}));

beforeEach(() => {
  state.mode = "window";
  state.active = false;
  state.pinned = false;
  state.toggle.mockReset();
  state.setPinned.mockReset();
  state.setView.mockReset();
});

function view(floating: boolean) {
  return render(<CallCompactView title="Lounge" identity={UNKNOWN_IDENTITY} floating={floating} />);
}

describe("CallCompactView buttons", () => {
  it("has a picture-in-picture button that toggles the floating window", async () => {
    const user = userEvent.setup();
    view(false);
    await user.click(screen.getByRole("button", { name: "Picture in picture" }));
    expect(state.toggle).toHaveBeenCalledTimes(1);
  });

  it("shows the picture-in-picture button as pressed while floating", () => {
    state.active = true;
    view(true);
    expect(screen.getByRole("button", { name: "Close picture in picture" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("has a keep-on-top button on the desktop, in the small window too", async () => {
    const user = userEvent.setup();
    view(true);
    await user.click(screen.getByRole("button", { name: "Keep on top of other windows" }));
    expect(state.setPinned).toHaveBeenCalledWith(true);
  });

  it("says so, and offers to stop, once pinned", async () => {
    state.pinned = true;
    const user = userEvent.setup();
    view(true);
    await user.click(screen.getByRole("button", { name: "Stop keeping on top" }));
    expect(state.setPinned).toHaveBeenCalledWith(false);
  });

  it("offers no pin inside the browser's own floating window, which is always on top", () => {
    state.mode = "document";
    view(true);
    expect(screen.queryByRole("button", { name: /pin to top|keep on top/i })).toBeNull();
  });

  it("still pins the in-page dock in the browser", () => {
    state.mode = "document";
    view(false);
    expect(screen.getByRole("button", { name: "Pin to top" })).toBeInTheDocument();
  });

  it("offers no picture-in-picture where the platform has none", () => {
    state.mode = "none";
    view(false);
    expect(screen.queryByRole("button", { name: /picture in picture/i })).toBeNull();
  });

  it("closes the floating window before expanding to the full view", async () => {
    state.active = true;
    const user = userEvent.setup();
    view(true);
    await user.click(screen.getByRole("button", { name: "Expand to full view" }));
    expect(state.toggle).toHaveBeenCalledTimes(1);
    expect(state.setView).toHaveBeenCalledWith("stage");
  });

  it("only the dock can be hidden", () => {
    const { unmount } = view(true);
    expect(screen.queryByRole("button", { name: "Hide call window" })).toBeNull();
    unmount();
    render(
      <CallCompactView
        title="Lounge"
        identity={UNKNOWN_IDENTITY}
        floating={false}
        onHide={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Hide call window" })).toBeInTheDocument();
  });
});
