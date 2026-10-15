/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  current: null as null | Record<string, unknown>,
}));

vi.mock("expo", () => ({
  requireOptionalNativeModule: () => native.current,
}));

async function load() {
  vi.resetModules();
  return await import("../modules/aulora-pip");
}

beforeEach(() => {
  native.current = null;
});

describe("aulora-pip wrapper", () => {
  it("does nothing, safely, where the native module is absent", async () => {
    const pip = await load();
    expect(pip.pictureInPictureSupported()).toBe(false);
    expect(pip.enterPictureInPicture()).toBe(false);
    expect(pip.pictureInPictureActive()).toBe(false);
    expect(() => {
      pip.setPictureInPictureEnabled(true);
    }).not.toThrow();
    expect(pip.exitPictureInPicture).not.toThrow();
    const stop = pip.onPictureInPictureChange(() => undefined);
    expect(stop).not.toThrow();
  });

  it("forwards each call to the native module", async () => {
    native.current = {
      isSupported: vi.fn(() => true),
      setEnabled: vi.fn(),
      enter: vi.fn(() => true),
      expand: vi.fn(),
      isActive: vi.fn(() => true),
    };
    const pip = await load();
    expect(pip.pictureInPictureSupported()).toBe(true);
    pip.setPictureInPictureEnabled(true);
    expect(native.current.setEnabled).toHaveBeenCalledWith(true);
    expect(pip.enterPictureInPicture()).toBe(true);
    pip.exitPictureInPicture();
    expect(native.current.expand).toHaveBeenCalled();
    expect(pip.pictureInPictureActive()).toBe(true);
  });

  it("reports changes to a listener and stops when unsubscribed", async () => {
    const remove = vi.fn();
    let emit: (event: { active: boolean }) => void = () => undefined;
    native.current = {
      addListener: vi.fn((_name: string, listener: (event: { active: boolean }) => void) => {
        emit = listener;
        return { remove };
      }),
    };
    const pip = await load();
    const seen: boolean[] = [];
    const stop = pip.onPictureInPictureChange((active) => seen.push(active));
    emit({ active: true });
    emit({ active: false });
    expect(seen).toEqual([true, false]);
    stop();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("treats a native failure to enter as not entered", async () => {
    native.current = { enter: vi.fn(() => false) };
    const pip = await load();
    expect(pip.enterPictureInPicture()).toBe(false);
  });
});
