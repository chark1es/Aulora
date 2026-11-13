import { describe, expect, it } from "vitest";

/**
 * The native bridge's API contract cannot be exercised by the Node test runner
 * (it needs an Android runtime). These assertions guard the exact defects the
 * platform documentation makes invalid: selecting a recorder *source* where
 * `AudioManager.setCommunicationDevice` requires a communication *sink*, and
 * returning Kotlin `Unit` from `clearCommunicationDevice` where the JS bridge
 * promises `true`. The module is compiled separately by the Android build.
 */
declare global {
  interface ImportMeta {
    glob(
      patterns: string[],
      options: { eager: true; query: string; import: string },
    ): Record<string, string>;
  }
}
const sources = import.meta.glob(
  [
    "../modules/aulora-audio-route/android/src/main/java/expo/modules/auloraaudioroute/AudioRouteModule.kt",
  ],
  { eager: true, query: "?raw", import: "default" },
);
const source =
  sources[
    "../modules/aulora-audio-route/android/src/main/java/expo/modules/auloraaudioroute/AudioRouteModule.kt"
  ] ?? "";

describe("AudioRouteModule native contract", () => {
  it("selects communication sinks and never recorder inputs", () => {
    // GET_DEVICES_INPUTS returns source endpoints whose ids the platform does
    // not accept in setCommunicationDevice.
    expect(source).not.toMatch(/getDevices\(\s*AudioManager\.GET_DEVICES_INPUTS/);
    expect(source).toContain("availableCommunicationDevices");

    const setter = source.slice(source.indexOf('Function("setCommunicationDevice")'));
    expect(setter).toMatch(/communicationDevice\(uid\)/);
    expect(setter).toMatch(/audioManager\.setCommunicationDevice\(device\)/);

    const resolver = source.slice(
      source.indexOf("private fun communicationDevice"),
      source.indexOf("override fun definition"),
    );
    expect(resolver).toMatch(/availableCommunicationDevices\.firstOrNull/);
  });

  it("enumerates and reports in the sink domain", () => {
    expect(source).toContain('Function("getAvailableCommunicationDevices")');
    const current = source.slice(source.indexOf('Function("getCommunicationDevice")'));
    expect(current).toMatch(/audioManager\.communicationDevice/);
    const list = source.slice(source.indexOf('Function("getAvailableCommunicationDevices")'));
    expect(list).toMatch(/audioManager\.availableCommunicationDevices\.map/);
  });

  it("returns explicit true after a successful clear", () => {
    // clearCommunicationDevice() is void; the JS bridge checks === true.
    expect(source).toMatch(/audioManager\.clearCommunicationDevice\(\)\s*\n\s*true/);
  });

  it("reports OS capability separately from module presence", () => {
    expect(source).toContain('Function("isSupported")');
    expect(source).toContain("Build.VERSION_CODES.S");
  });
});
