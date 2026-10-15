import {
  type CallParticipantView,
  DEFAULT_VOICE_SETTINGS,
  type SfuAccess,
  type VoiceDeviceSettings,
} from "@aulora/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DisplayCapture } from "../lib/voice/display";
import { screenBitrateFor } from "../lib/voice/peer-mesh";
import { ScreenShare, type ScreenShareHost } from "../lib/voice/screen-share";
import type { SfuConnection, SfuConnector, SfuHandlers } from "../lib/voice/sfu-room";

const display = vi.hoisted(() => ({ acquireDisplay: vi.fn() }));
vi.mock("../lib/voice/display", () => display);

const ACCESS: SfuAccess = { url: "wss://stream.example.com", token: "t", canPublish: true };

function person(userId: string, overrides: Partial<CallParticipantView> = {}) {
  return {
    userId,
    muted: false,
    deafened: false,
    video: false,
    sharingScreen: false,
    sfu: false,
    joinedAt: 0,
    clientId: null,
    session: 1,
    speaking: false,
    audioLevel: 0,
    connection: "connected",
    ...overrides,
  } as CallParticipantView;
}

function fakeCapture(): DisplayCapture & { ended(): void } {
  let onEnded: (() => void) | null = null;
  const video = {
    kind: "video",
    addEventListener: (_type: string, listener: () => void) => {
      onEnded = listener;
    },
  } as unknown as MediaStreamTrack;
  return {
    video,
    audio: null,
    stop: vi.fn(),
    ended: () => onEnded?.(),
  };
}

interface Rig {
  readonly share: ScreenShare;
  readonly roster: { participants: CallParticipantView[] };
  readonly flags: { capable: boolean[]; sharing: boolean[] };
  readonly host: ScreenShareHost & { refreshMesh: ReturnType<typeof vi.fn> };
  readonly connection: SfuConnection & { publish: ReturnType<typeof vi.fn> };
  handlers(): SfuHandlers;
}

function rig(options: { access?: SfuAccess | null; publishFails?: boolean } = {}): Rig {
  const roster = { participants: [person("me"), person("a"), person("b")] };
  const flags = { capable: [] as boolean[], sharing: [] as boolean[] };
  let handlers: SfuHandlers | null = null;
  const connection = {
    publish: vi.fn(async () => {
      if (options.publishFails === true) {
        throw new Error("rejected");
      }
    }),
    unpublish: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
  };
  const connector: SfuConnector = async (_access, given) => {
    handlers = given;
    return connection;
  };
  const host = {
    userId: "me",
    getSettings: (): VoiceDeviceSettings => DEFAULT_VOICE_SETTINGS,
    getParticipants: () => roster.participants,
    fetchAccess: async () => (options.access === undefined ? ACCESS : options.access),
    reportCapable: (value: boolean) => {
      flags.capable.push(value);
    },
    reportSharing: (value: boolean) => {
      flags.sharing.push(value);
    },
    refreshMesh: vi.fn(async () => undefined),
    onChange: vi.fn(),
    onError: vi.fn(),
  };
  return {
    share: new ScreenShare(host, connector),
    roster,
    flags,
    host,
    connection,
    handlers() {
      if (handlers === null) {
        throw new Error("not connected");
      }
      return handlers;
    },
  };
}

beforeEach(() => {
  display.acquireDisplay.mockReset();
});

describe("ScreenShare mesh delivery", () => {
  it("sends the share to every peer when there is no streaming server", async () => {
    const r = rig({ access: null });
    const capture = fakeCapture();
    display.acquireDisplay.mockResolvedValue(capture);
    await r.share.probe();
    await r.share.start();
    expect(r.share.active).toBe(true);
    expect(r.share.trackForPeer("a")).toBe(capture.video);
    expect(r.share.trackForPeer("b")).toBe(capture.video);
    expect(r.flags.sharing).toEqual([true]);
  });

  it("withholds the mesh copy only from peers who watch on the server", async () => {
    const r = rig();
    const capture = fakeCapture();
    display.acquireDisplay.mockResolvedValue(capture);
    await r.share.probe();
    r.roster.participants = [person("me"), person("a", { sfu: true }), person("b")];
    await r.share.start();
    expect(r.connection.publish).toHaveBeenCalledTimes(1);
    expect(r.share.trackForPeer("a")).toBeNull();
    expect(r.share.trackForPeer("b")).toBe(capture.video);
  });

  it("follows a peer that stops being able to use the server", async () => {
    const r = rig();
    display.acquireDisplay.mockResolvedValue(fakeCapture());
    await r.share.probe();
    r.roster.participants = [person("me"), person("a", { sfu: true })];
    await r.share.start();
    expect(r.share.trackForPeer("a")).toBeNull();
    r.roster.participants = [person("me"), person("a", { sfu: false })];
    expect(r.share.trackForPeer("a")).not.toBeNull();
  });

  it("sends everyone the mesh copy when publishing to the server fails", async () => {
    const r = rig({ publishFails: true });
    const capture = fakeCapture();
    display.acquireDisplay.mockResolvedValue(capture);
    await r.share.probe();
    r.roster.participants = [person("me"), person("a", { sfu: true })];
    await r.share.start();
    expect(r.share.trackForPeer("a")).toBe(capture.video);
    expect(r.flags.capable.at(-1)).toBe(false);
  });

  it("resumes on the mesh when the server connection drops mid-share", async () => {
    const r = rig();
    const capture = fakeCapture();
    display.acquireDisplay.mockResolvedValue(capture);
    await r.share.probe();
    r.roster.participants = [person("me"), person("a", { sfu: true })];
    await r.share.start();
    expect(r.share.trackForPeer("a")).toBeNull();
    r.host.refreshMesh.mockClear();
    r.handlers().onClosed();
    expect(r.share.trackForPeer("a")).toBe(capture.video);
    expect(r.host.refreshMesh).toHaveBeenCalled();
  });
});

describe("ScreenShare lifecycle", () => {
  it("stays quiet when the picker is cancelled", async () => {
    const r = rig();
    display.acquireDisplay.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    await r.share.start();
    expect(r.share.active).toBe(false);
    expect(r.host.onError).not.toHaveBeenCalled();
    expect(r.flags.sharing).toEqual([]);
  });

  it("reports a real capture failure", async () => {
    const r = rig();
    display.acquireDisplay.mockRejectedValue(new Error("This device cannot share its screen"));
    await r.share.start();
    expect(r.host.onError).toHaveBeenCalledWith("This device cannot share its screen");
  });

  it("stops when the browser's own stop-sharing control ends the capture", async () => {
    const r = rig({ access: null });
    const capture = fakeCapture();
    display.acquireDisplay.mockResolvedValue(capture);
    await r.share.start();
    capture.ended();
    await vi.waitFor(() => {
      expect(r.share.active).toBe(false);
    });
    expect(capture.stop).toHaveBeenCalled();
    expect(r.flags.sharing).toEqual([true, false]);
  });

  it("ignores a second start while one is already running", async () => {
    const r = rig({ access: null });
    display.acquireDisplay.mockResolvedValue(fakeCapture());
    await Promise.all([r.share.start(), r.share.start()]);
    expect(display.acquireDisplay).toHaveBeenCalledTimes(1);
  });

  it("releases the capture when the call ends", async () => {
    const r = rig({ access: null });
    const capture = fakeCapture();
    display.acquireDisplay.mockResolvedValue(capture);
    await r.share.start();
    await r.share.reset();
    expect(capture.stop).toHaveBeenCalled();
    expect(r.share.active).toBe(false);
  });
});

describe("ScreenShare viewing", () => {
  it("joins the server only while someone else is relaying a share", async () => {
    const r = rig();
    await r.share.probe();
    r.share.follow();
    await Promise.resolve();
    expect(r.connection.disconnect).not.toHaveBeenCalled();

    r.roster.participants = [person("me"), person("a", { sharingScreen: true, sfu: true })];
    r.share.follow();
    await vi.waitFor(() => {
      expect(r.handlers()).toBeDefined();
    });

    r.roster.participants = [person("me"), person("a")];
    r.share.follow();
    await vi.waitFor(() => {
      expect(r.connection.disconnect).toHaveBeenCalled();
    });
  });

  it("does not join for a share that travels over the mesh", async () => {
    const r = rig();
    await r.share.probe();
    r.roster.participants = [person("me"), person("a", { sharingScreen: true, sfu: false })];
    r.share.follow();
    await Promise.resolve();
    expect(() => r.handlers()).toThrow("not connected");
  });
});

describe("screenBitrateFor", () => {
  const budget = { maxBitrate: 3_000_000, frameRate: 30 };

  it("gives a few viewers full quality", () => {
    expect(screenBitrateFor(budget, 1)).toBe(3_000_000);
    expect(screenBitrateFor(budget, 3)).toBe(3_000_000);
  });

  it("shrinks each copy so the total upload stays bounded", () => {
    expect(screenBitrateFor(budget, 6)).toBe(1_500_000);
    expect(screenBitrateFor(budget, 9) * 9).toBeLessThanOrEqual(3_000_000 * 3);
  });

  it("never drops below a watchable floor", () => {
    expect(screenBitrateFor(budget, 100)).toBe(500_000);
  });

  it("treats zero viewers as one", () => {
    expect(screenBitrateFor(budget, 0)).toBe(3_000_000);
  });
});
