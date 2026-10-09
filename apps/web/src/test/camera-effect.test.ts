import { DEFAULT_VOICE_SETTINGS, type VoiceDeviceSettings } from "@aulora/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CameraEffect, effectOptions } from "../lib/voice/camera-effect";

const effects = vi.hoisted(() => ({
  createBackgroundEffect: vi.fn(),
  backgroundEffectsSupported: vi.fn(() => true),
}));
vi.mock("../lib/voice/effects/background-effect", () => effects);

const raw = { id: "raw" } as unknown as MediaStreamTrack;
const processed = { id: "processed" } as unknown as MediaStreamTrack;

function settings(overrides: Partial<VoiceDeviceSettings> = {}): VoiceDeviceSettings {
  return { ...DEFAULT_VOICE_SETTINGS, ...overrides };
}

function fakeEffect() {
  return { track: processed, update: vi.fn(), stop: vi.fn() };
}

function rig() {
  const host = { onError: vi.fn(), onFailed: vi.fn() };
  return { host, camera: new CameraEffect(host) };
}

beforeEach(() => {
  effects.createBackgroundEffect.mockReset();
  effects.backgroundEffectsSupported.mockReset();
  effects.backgroundEffectsSupported.mockReturnValue(true);
});

describe("effectOptions", () => {
  it("is nothing when no effect is chosen", () => {
    expect(effectOptions(settings())).toBeNull();
  });

  it("describes a blur", () => {
    expect(effectOptions(settings({ backgroundEffect: "blur", backgroundBlur: "light" }))).toEqual({
      mode: "blur",
      blur: "light",
    });
  });

  it("describes a replacement, keeping the blur as the fallback strength", () => {
    expect(
      effectOptions(
        settings({
          backgroundEffect: "image",
          backgroundImage: "aurora",
          backgroundBlur: "strong",
        }),
      ),
    ).toEqual({ mode: "image", image: "aurora", blur: "strong" });
  });
});

describe("CameraEffect.attach", () => {
  it("sends the plain camera when no effect is wanted", async () => {
    const { camera } = rig();
    expect(await camera.attach(raw, settings())).toBe(raw);
    expect(effects.createBackgroundEffect).not.toHaveBeenCalled();
  });

  it("sends the processed track when an effect runs", async () => {
    effects.createBackgroundEffect.mockResolvedValue(fakeEffect());
    const { camera } = rig();
    expect(await camera.attach(raw, settings({ backgroundEffect: "blur" }))).toBe(processed);
  });

  it("falls back to the plain camera, telling the user once, when the browser cannot", async () => {
    effects.backgroundEffectsSupported.mockReturnValue(false);
    const { camera, host } = rig();
    const wanted = settings({ backgroundEffect: "blur" });
    expect(await camera.attach(raw, wanted)).toBe(raw);
    expect(await camera.attach(raw, wanted)).toBe(raw);
    expect(host.onError).toHaveBeenCalledTimes(1);
  });

  it("falls back when the model fails to load", async () => {
    effects.createBackgroundEffect.mockRejectedValue(new Error("wasm blocked"));
    const { camera, host } = rig();
    expect(await camera.attach(raw, settings({ backgroundEffect: "blur" }))).toBe(raw);
    expect(host.onError).toHaveBeenCalledTimes(1);
  });

  it("replaces a previous effect instead of stacking them", async () => {
    const first = fakeEffect();
    effects.createBackgroundEffect.mockResolvedValueOnce(first).mockResolvedValue(fakeEffect());
    const { camera } = rig();
    const wanted = settings({ backgroundEffect: "blur" });
    await camera.attach(raw, wanted);
    await camera.attach(raw, wanted);
    expect(first.stop).toHaveBeenCalledTimes(1);
  });

  it("reports a pipeline that breaks mid-call so the engine can send the plain camera", async () => {
    effects.createBackgroundEffect.mockImplementation(
      async (_source: unknown, _options: unknown, onFailure: () => void) => {
        queueMicrotask(onFailure);
        return fakeEffect();
      },
    );
    const { camera, host } = rig();
    await camera.attach(raw, settings({ backgroundEffect: "blur" }));
    await vi.waitFor(() => {
      expect(host.onFailed).toHaveBeenCalledTimes(1);
    });
    expect(host.onError).toHaveBeenCalledTimes(1);
  });
});

describe("CameraEffect.sync", () => {
  it("updates a running effect in place", async () => {
    const effect = fakeEffect();
    effects.createBackgroundEffect.mockResolvedValue(effect);
    const { camera } = rig();
    await camera.attach(raw, settings({ backgroundEffect: "blur", backgroundBlur: "light" }));
    const sent = await camera.sync(
      raw,
      processed,
      settings({ backgroundEffect: "blur", backgroundBlur: "strong" }),
    );
    expect(sent).toBe(processed);
    expect(effect.update).toHaveBeenCalledWith({ mode: "blur", blur: "strong" });
    expect(effects.createBackgroundEffect).toHaveBeenCalledTimes(1);
  });

  it("returns to the plain camera when the effect is switched off", async () => {
    const effect = fakeEffect();
    effects.createBackgroundEffect.mockResolvedValue(effect);
    const { camera } = rig();
    await camera.attach(raw, settings({ backgroundEffect: "blur" }));
    expect(await camera.sync(raw, processed, settings())).toBe(raw);
    expect(effect.stop).toHaveBeenCalled();
  });

  it("starts an effect that is switched on during a call", async () => {
    effects.createBackgroundEffect.mockResolvedValue(fakeEffect());
    const { camera } = rig();
    expect(await camera.sync(raw, raw, settings({ backgroundEffect: "image" }))).toBe(processed);
  });

  it("leaves the camera alone when nothing is wanted and nothing runs", async () => {
    const { camera } = rig();
    expect(await camera.sync(raw, raw, settings())).toBe(raw);
    expect(effects.createBackgroundEffect).not.toHaveBeenCalled();
  });
});
