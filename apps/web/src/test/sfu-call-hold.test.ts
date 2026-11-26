import { describe, expect, it, vi } from "vitest";
import { SfuCall } from "../lib/voice/sfu-call";

interface HeldInfo {
  readonly visible: boolean;
  readonly pictureInPicture: boolean;
  width(): number;
  height(): number;
}

/** A subscribed LiveKit camera, as far as `holdVideo` touches it. */
function remoteCamera() {
  const mediaStreamTrack = { kind: "video" } as MediaStreamTrack;
  const observed: HeldInfo[] = [];
  return {
    mediaStreamTrack,
    observed,
    observeElementInfo: vi.fn((info: HeldInfo) => {
      observed.push(info);
    }),
    stopObservingElementInfo: vi.fn((info: HeldInfo) => {
      observed.splice(observed.indexOf(info), 1);
    }),
  };
}

function callWith(userId: string, camera: ReturnType<typeof remoteCamera>): SfuCall {
  const call = new SfuCall();
  (call as unknown as { videoTracks: Map<string, unknown> }).videoTracks.set(userId, camera);
  return call;
}

describe("SfuCall.holdVideo", () => {
  it("registers the camera as shown in picture-in-picture at the floating size", () => {
    const camera = remoteCamera();
    const call = callWith("them", camera);
    const release = call.holdVideo(camera.mediaStreamTrack, { width: 380, height: 292 });
    expect(release).not.toBeNull();
    expect(camera.observed).toHaveLength(1);
    const info = camera.observed[0];
    // Picture-in-picture counts as visible even while the app is in the background.
    expect(info?.pictureInPicture).toBe(true);
    expect(info?.visible).toBe(true);
    expect(info?.width()).toBe(380);
    expect(info?.height()).toBe(292);
  });

  it("releases once, however often it is called", () => {
    const camera = remoteCamera();
    const call = callWith("them", camera);
    const release = call.holdVideo(camera.mediaStreamTrack, { width: 380, height: 292 });
    release?.();
    release?.();
    expect(camera.stopObservingElementInfo).toHaveBeenCalledTimes(1);
    expect(camera.observed).toHaveLength(0);
  });

  it("holds nothing for a track that is not one of the call's cameras", () => {
    const camera = remoteCamera();
    const call = callWith("them", camera);
    const other = { kind: "video" } as MediaStreamTrack;
    expect(call.holdVideo(other, { width: 380, height: 292 })).toBeNull();
    expect(camera.observeElementInfo).not.toHaveBeenCalled();
  });
});

describe("SfuCall.holdVideo with LiveKit's own track", () => {
  it("makes a paused camera visible to the server, and hands it back on release", async () => {
    const { RemoteVideoTrack, TrackEvent } = await import("livekit-client");
    const media = {
      kind: "video",
      id: "camera",
      enabled: true,
      readyState: "live",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      getSettings: () => ({}),
    } as unknown as MediaStreamTrack;
    // Adaptive streaming, as `sfu-call.ts` configures the media room.
    // No receiver: nothing here reads stats.
    const receiver = undefined as unknown as RTCRtpReceiver;
    const remote = new RemoteVideoTrack(media, "TR_camera", receiver, {});
    // In the background: LiveKit pauses every adaptive camera here.
    (remote as unknown as { isInBackground: boolean }).isInBackground = true;
    const visibility: boolean[] = [];
    remote.on(TrackEvent.VisibilityChanged, (visible: boolean) => {
      visibility.push(visible);
    });
    const call = new SfuCall();
    (call as unknown as { videoTracks: Map<string, unknown> }).videoTracks.set("them", remote);

    const release = call.holdVideo(media, { width: 380, height: 292 });
    expect(visibility).toEqual([true]);
    release?.();
    expect(visibility).toEqual([true, false]);
  });
});
