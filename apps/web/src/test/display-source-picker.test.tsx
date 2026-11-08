import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DisplaySourcePicker } from "../components/voice/DisplaySourcePicker";
import type {
  CapturePermission,
  DisplaySource,
  SystemAudioSupport,
} from "../lib/voice/desktop-display";
import { cancelDisplayPicker, requestDisplaySource } from "../lib/voice/display-picker";

const SCREEN: DisplaySource = {
  id: "screen:1",
  name: "Screen 1 (1920×1080)",
  kind: "screen",
  thumbnail: "data:image/jpeg;base64,AAAA",
};

const ALLOWED: CapturePermission = { status: "granted", canOpenSettings: false, detail: null };

const DENIED: CapturePermission = {
  status: "denied",
  canOpenSettings: true,
  detail: "Aulora needs Screen Recording access to share your screen.",
};

const AUDIO_ON: SystemAudioSupport = {
  supported: true,
  backend: "wasapi-exclude-process",
  detail: "Captures the default output without Aulora's own audio.",
};

const AUDIO_OFF: SystemAudioSupport = {
  supported: false,
  backend: "none",
  detail: "macOS 13 or newer is needed to capture system audio.",
};

const UNSUPPORTED: CapturePermission = {
  status: "unsupported",
  canOpenSettings: false,
  detail: "This Wayland session doesn't let apps read the screen continuously.",
};

const WINDOW: DisplaySource = {
  id: "window:7",
  name: "Notes — Editor",
  kind: "window",
  thumbnail: null,
};

afterEach(() => {
  cancelDisplayPicker();
});

describe("DisplaySourcePicker", () => {
  it("shows screens and windows and shares the picked tile", async () => {
    const user = userEvent.setup();
    render(<DisplaySourcePicker />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const request = requestDisplaySource({
      readPermission: async () => ALLOWED,
      readAudio: async () => AUDIO_ON,
      listSources: async () => [SCREEN, WINDOW],
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: SCREEN.name })).toBeInTheDocument();
    });
    expect(screen.getByRole("region", { name: "Screens" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Windows" })).toBeInTheDocument();
    // The first screen is preselected, so Share is armed immediately.
    expect(screen.getByRole("button", { name: "Share" })).toBeEnabled();
    expect(screen.getByRole("button", { name: SCREEN.name })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: WINDOW.name }));
    expect(screen.getByRole("button", { name: WINDOW.name })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Share" }));

    await expect(request).resolves.toEqual({ source: WINDOW, audioRequested: false });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("cancels without sharing", async () => {
    const user = userEvent.setup();
    render(<DisplaySourcePicker />);
    const request = requestDisplaySource({
      readPermission: async () => ALLOWED,
      readAudio: async () => AUDIO_ON,
      listSources: async () => [SCREEN],
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
    });

    // Attach the rejection handler before the click, so the abort is never
    // observed as an unhandled rejection.
    const cancelled = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await cancelled;

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("shows the system audio switch and shares the audio choice", async () => {
    const user = userEvent.setup();
    render(<DisplaySourcePicker />);
    const request = requestDisplaySource({
      audioRequested: true,
      readPermission: async () => ALLOWED,
      readAudio: async () => AUDIO_ON,
      listSources: async () => [SCREEN],
    });

    const audio = await screen.findByRole("switch", { name: "Share system audio" });
    expect(audio).toBeChecked();
    expect(screen.getByText(/without Aulora's own audio/i)).toBeInTheDocument();

    await user.click(audio);
    expect(audio).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "Share" }));
    await expect(request).resolves.toEqual({ source: SCREEN, audioRequested: false });
  });

  it("disables the switch and says so where audio cannot be captured", async () => {
    const user = userEvent.setup();
    render(<DisplaySourcePicker />);
    const request = requestDisplaySource({
      audioRequested: true,
      readPermission: async () => ALLOWED,
      readAudio: async () => AUDIO_OFF,
      listSources: async () => [SCREEN],
    });

    const audio = await screen.findByRole("switch", { name: "Share system audio" });
    expect(audio).toBeDisabled();
    expect(audio).not.toBeChecked();
    // The platform's own reason is shown, plus the video-only fallback.
    expect(screen.getByText(/macOS 13 or newer/i)).toBeInTheDocument();
    expect(screen.getByText(/sends video only/i)).toBeInTheDocument();

    // The share itself stays available: video only.
    await user.click(screen.getByRole("button", { name: "Share" }));
    await expect(request).resolves.toEqual({ source: SCREEN, audioRequested: false });
  });

  it("explains a missing OS permission, opens the settings pane and re-checks", async () => {
    const user = userEvent.setup();
    const openSettings = vi.fn(async () => undefined);
    render(<DisplaySourcePicker />);
    // Denied first, granted once the person comes back from System Settings.
    const readPermission = vi.fn().mockResolvedValueOnce(DENIED).mockResolvedValueOnce(ALLOWED);
    const request = requestDisplaySource({
      readPermission,
      readAudio: async () => AUDIO_ON,
      requestAccess: async () => DENIED,
      openSettings,
      listSources: async () => [SCREEN],
    });

    await waitFor(() => {
      expect(screen.getByText(/Screen Recording access/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("dialog", { name: "Allow screen recording" })).toBeInTheDocument();
    expect(screen.getByText(/Nothing is shared until this is allowed/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: SCREEN.name })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open System Settings" }));
    await waitFor(() => {
      expect(openSettings).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: SCREEN.name })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Share" }));
    await expect(request).resolves.toEqual({
      source: SCREEN,
      audioRequested: false,
    });
  });

  it("says so when the session cannot share at all", async () => {
    const user = userEvent.setup();
    const openSettings = vi.fn(async () => undefined);
    render(<DisplaySourcePicker />);
    const request = requestDisplaySource({
      readPermission: async () => UNSUPPORTED,
      readAudio: async () => AUDIO_ON,
      openSettings,
      listSources: async () => [SCREEN],
    });

    await waitFor(() => {
      expect(screen.getByText(/This Wayland session/i)).toBeInTheDocument();
    });
    expect(
      screen.getByRole("dialog", { name: "Screen sharing isn't available here" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open System Settings" })).not.toBeInTheDocument();

    const declined = expect(request).rejects.toThrow("Wayland");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await declined;
    expect(openSettings).not.toHaveBeenCalled();
  });

  it("offers a retry when no source could be listed", async () => {
    const user = userEvent.setup();
    const listSources = vi
      .fn()
      .mockRejectedValueOnce(new Error("Could not list windows: denied"))
      .mockResolvedValueOnce([SCREEN]);
    render(<DisplaySourcePicker />);
    const request = requestDisplaySource({ readPermission: async () => ALLOWED, listSources });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Could not list windows: denied");
    });
    // Nothing to share yet, so the only action is another try.
    expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: SCREEN.name })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Share" }));
    await expect(request).resolves.toEqual({ source: SCREEN, audioRequested: false });
  });
});
