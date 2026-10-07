/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCallSession } from "../lib/voice/pip";

const actions = {
  toggleMicrophone: vi.fn(),
  toggleCamera: vi.fn(),
  hangUp: vi.fn(),
};

function stubSession(setActionHandler: (action: string, handler: unknown) => void) {
  vi.stubGlobal("navigator", { mediaSession: { setActionHandler } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("registerCallSession", () => {
  it("registers each action and removes it again", () => {
    const calls: [string, unknown][] = [];
    stubSession((action, handler) => {
      calls.push([action, handler]);
    });
    const enter = vi.fn();
    const unregister = registerCallSession({ ...actions, enterPictureInPicture: enter });
    expect(calls.map(([action]) => action)).toEqual([
      "enterpictureinpicture",
      "togglemicrophone",
      "togglecamera",
      "hangup",
    ]);
    expect(calls.find(([action]) => action === "enterpictureinpicture")?.[1]).toBe(enter);

    calls.length = 0;
    unregister();
    expect(calls.map(([action]) => action).sort()).toEqual(
      ["enterpictureinpicture", "hangup", "togglecamera", "togglemicrophone"].sort(),
    );
    expect(calls.every(([, handler]) => handler === null)).toBe(true);
  });

  it("skips the automatic picture-in-picture action when it is not wanted", () => {
    const seen: string[] = [];
    stubSession((action) => {
      seen.push(action);
    });
    registerCallSession(actions);
    expect(seen).not.toContain("enterpictureinpicture");
  });

  it("carries on when a browser rejects an action it does not know", () => {
    const registered: string[] = [];
    stubSession((action) => {
      if (action === "togglecamera") {
        throw new TypeError("not supported");
      }
      registered.push(action);
    });
    expect(() => registerCallSession(actions)).not.toThrow();
    expect(registered).toEqual(["togglemicrophone", "hangup"]);
  });

  it("does nothing where there is no media session", () => {
    vi.stubGlobal("navigator", {});
    const unregister = registerCallSession(actions);
    expect(unregister).not.toThrow();
  });
});
