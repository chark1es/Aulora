import { DEFAULT_VOICE_SETTINGS, type VoiceDeviceSettings } from "@aulora/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BackgroundSettings } from "../components/voice/BackgroundSettings";
import { NoiseSuppressionSetting } from "../components/voice/NoiseSuppressionSetting";
import { StreamSettings } from "../components/voice/StreamSettings";

const state = vi.hoisted(() => ({
  settings: {} as VoiceDeviceSettings,
  updateSettings: vi.fn(),
  enhancedAvailable: true,
  effectsSupported: true,
}));

vi.mock("../providers/VoiceProvider", () => ({
  useVoice: () => ({ settings: state.settings, updateSettings: state.updateSettings }),
}));
vi.mock("../lib/voice/mic-pipeline", () => ({
  enhancedNoiseSuppressionAvailable: () => Promise.resolve(state.enhancedAvailable),
}));
vi.mock("../lib/voice/effects/background-effect", () => ({
  backgroundEffectsSupported: () => state.effectsSupported,
}));

function use(overrides: Partial<VoiceDeviceSettings> = {}) {
  state.settings = { ...DEFAULT_VOICE_SETTINGS, ...overrides };
}

beforeEach(() => {
  state.updateSettings.mockReset();
  state.enhancedAvailable = true;
  state.effectsSupported = true;
  use();
});

describe("NoiseSuppressionSetting", () => {
  it("shows Standard for the default and maps each level to the two flags", async () => {
    const user = userEvent.setup();
    render(<NoiseSuppressionSetting />);
    expect(screen.getByRole("radio", { name: "Standard" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "Enhanced" }));
    expect(state.updateSettings).toHaveBeenLastCalledWith({
      noiseSuppression: true,
      enhancedNoiseSuppression: true,
    });
    await user.click(screen.getByRole("radio", { name: "Off" }));
    expect(state.updateSettings).toHaveBeenLastCalledWith({
      noiseSuppression: false,
      enhancedNoiseSuppression: false,
    });
  });

  it("reflects the stored level", () => {
    use({ noiseSuppression: true, enhancedNoiseSuppression: true });
    render(<NoiseSuppressionSetting />);
    expect(screen.getByRole("radio", { name: "Enhanced" })).toBeChecked();
  });

  it("says so when the AI denoiser cannot run, instead of silently doing less", async () => {
    use({ noiseSuppression: true, enhancedNoiseSuppression: true });
    state.enhancedAvailable = false;
    render(<NoiseSuppressionSetting />);
    await waitFor(() => {
      expect(screen.getByText(/not available on this device/i)).toBeInTheDocument();
    });
  });

  it("stays quiet about availability when Enhanced is not selected", async () => {
    state.enhancedAvailable = false;
    render(<NoiseSuppressionSetting />);
    await Promise.resolve();
    expect(screen.queryByText(/not available on this device/i)).toBeNull();
  });
});

describe("BackgroundSettings", () => {
  it("offers no blur or backdrop controls while the effect is off", () => {
    render(<BackgroundSettings />);
    expect(screen.queryByRole("radio", { name: "Strong blur" })).toBeNull();
  });

  it("offers blur strength once blur is on, but no backdrops", () => {
    use({ backgroundEffect: "blur" });
    render(<BackgroundSettings />);
    expect(screen.getByRole("radio", { name: "Strong blur" })).toBeChecked();
    expect(screen.queryByRole("radiogroup", { name: "Background image" })).toBeNull();
  });

  it("offers the built-in backdrops for the image effect and selects one", async () => {
    use({ backgroundEffect: "image", backgroundImage: "dusk" });
    const user = userEvent.setup();
    render(<BackgroundSettings />);
    expect(screen.getByRole("radio", { name: "Dusk" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Aurora" }));
    expect(state.updateSettings).toHaveBeenCalledWith({ backgroundImage: "aurora" });
  });

  it("explains why effects are unavailable instead of offering dead controls", () => {
    state.effectsSupported = false;
    use({ backgroundEffect: "blur" });
    render(<BackgroundSettings />);
    expect(screen.getByText(/need WebGL 2/i)).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Strong blur" })).toBeNull();
  });
});

describe("StreamSettings", () => {
  it("changes the quality and says what it means", async () => {
    const user = userEvent.setup();
    render(<StreamSettings />);
    expect(screen.getByText(/1080p at 30 frames/)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Data saver" }));
    expect(state.updateSettings).toHaveBeenCalledWith({ streamQuality: "saver" });
  });

  it("toggles whether the shared screen's sound goes along", async () => {
    const user = userEvent.setup();
    render(<StreamSettings />);
    await user.click(screen.getByRole("switch", { name: /Share sound/ }));
    expect(state.updateSettings).toHaveBeenCalledWith({ streamAudio: false });
  });
});
