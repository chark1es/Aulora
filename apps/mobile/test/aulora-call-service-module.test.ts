import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  current: null as null | Record<string, unknown>,
}));

vi.mock("expo", () => ({
  requireOptionalNativeModule: () => native.current,
}));

async function load() {
  vi.resetModules();
  return await import("../modules/aulora-call-service");
}

beforeEach(() => {
  native.current = null;
});

describe("aulora-call-service wrapper", () => {
  it("does nothing, safely, where the native module is absent", async () => {
    const service = await load();
    expect(() => {
      service.syncCallService({ microphone: true, camera: true });
    }).not.toThrow();
    expect(() => {
      service.syncCallService({ microphone: false, camera: false });
    }).not.toThrow();
  });

  it("runs the service for either capture and passes both flags", async () => {
    native.current = { update: vi.fn(), stop: vi.fn() };
    const service = await load();
    service.syncCallService({ microphone: true, camera: false });
    expect(native.current.update).toHaveBeenCalledWith(true, false);
    service.syncCallService({ microphone: false, camera: true });
    expect(native.current.update).toHaveBeenCalledWith(false, true);
    expect(native.current.stop).not.toHaveBeenCalled();
  });

  it("stops the service once the call holds no capture", async () => {
    native.current = { update: vi.fn(), stop: vi.fn() };
    const service = await load();
    service.syncCallService({ microphone: false, camera: false });
    expect(native.current.stop).toHaveBeenCalledTimes(1);
    expect(native.current.update).not.toHaveBeenCalled();
  });
});
