import { beforeEach, describe, expect, it, vi } from "vitest";

const setNotificationHandler = vi.fn();
const setNotificationChannelAsync = vi.fn();

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("expo-device", () => ({ isDevice: false }));
vi.mock("expo-notifications", () => ({
  setNotificationHandler: (...args: unknown[]) => setNotificationHandler(...args),
  setNotificationChannelAsync: (...args: unknown[]) => setNotificationChannelAsync(...args),
  getPermissionsAsync: async () => ({ status: "granted" }),
  requestPermissionsAsync: async () => ({ status: "granted" }),
  getDevicePushTokenAsync: async () => ({ data: "unused" }),
  AndroidImportance: { MAX: "max", DEFAULT: "default" },
  AndroidNotificationVisibility: { PUBLIC: "public" },
}));

import { configureNotificationHandler, registerForPushNotifications } from "../src/lib/push";

describe("configureNotificationHandler", () => {
  beforeEach(() => {
    setNotificationHandler.mockReset();
    setNotificationChannelAsync.mockReset();
  });

  it("installs the foreground handler and the Android call channel", () => {
    setNotificationChannelAsync.mockResolvedValue(null);

    configureNotificationHandler();

    expect(setNotificationHandler).toHaveBeenCalledTimes(1);
    expect(setNotificationChannelAsync).toHaveBeenCalledWith("calls", expect.any(Object));
  });

  it("does not throw when the notifications module refuses to install the handler", () => {
    // The root layout calls this from its first effect; a throw there replaces
    // the whole app with the error boundary before any screen appears.
    setNotificationHandler.mockImplementation(() => {
      throw new Error("expo-notifications is unavailable in this build");
    });

    expect(() => {
      configureNotificationHandler();
    }).not.toThrow();
  });

  it("attaches a handler to a channel registration that may reject", () => {
    // A denied channel registration used to be a bare `void` promise: an
    // unhandled rejection on every launch that reached this effect.
    const catchSpy = vi.fn();
    setNotificationChannelAsync.mockReturnValue({ catch: catchSpy });

    configureNotificationHandler();

    expect(catchSpy).toHaveBeenCalledTimes(1);
  });

  it("skips push registration off a real device", async () => {
    // A simulator has no APNs token; asking for one used to be the way this
    // path threw during a first sign-in.
    await expect(registerForPushNotifications()).resolves.toBeNull();
  });
});
