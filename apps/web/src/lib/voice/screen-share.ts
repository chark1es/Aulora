/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { CallParticipantView, SfuAccess, VoiceDeviceSettings } from "@aulora/core";
import { isAbort, messageOf } from "./call-errors";
import { acquireDisplay, type DisplayCapture } from "./display";
import { ScreenStreamer } from "./screen-stream";
import type { SfuConnector } from "./sfu-room";

export interface ScreenShareHost {
  readonly userId: string;
  getSettings(): VoiceDeviceSettings;
  getParticipants(): readonly CallParticipantView[];
  fetchAccess(): Promise<SfuAccess | null>;
  /** Publishes this device's streaming-server capability on the roster. */
  reportCapable(capable: boolean): void;
  /** Publishes whether this device is sharing. */
  reportSharing(sharing: boolean): void;
  /** Re-points every mesh peer at the right outgoing video. */
  refreshMesh(): Promise<void>;
  onChange(): void;
  onError(message: string): void;
}

/**
 * One device's screen or window share, from picking the surface to stopping.
 *
 * A share reaches viewers one of two ways. With a streaming server the sharer
 * publishes once and every viewer who can use the server watches there; anyone
 * who cannot (a phone, an older client, a failed connection) still receives it
 * over the peer mesh, exactly as before. Without a server it is mesh only.
 */
export class ScreenShare {
  private readonly streamer: ScreenStreamer;
  private capture: DisplayCapture | null = null;
  private viaServer = false;
  private starting = false;

  constructor(
    private readonly host: ScreenShareHost,
    connector?: SfuConnector,
  ) {
    this.streamer = new ScreenStreamer(
      {
        fetchAccess: () => host.fetchAccess(),
        reportCapable: (capable) => {
          host.reportCapable(capable);
          // A capability change decides who gets the mesh copy.
          void host.refreshMesh();
        },
        onScreens: () => {
          host.onChange();
        },
        onPublishLost: () => {
          this.viaServer = false;
          void host.refreshMesh();
          host.onChange();
        },
      },
      connector,
    );
  }

  /** The live capture's video, shown in the sharer's own tile. */
  get track(): MediaStreamTrack | null {
    return this.capture?.video ?? null;
  }

  get active(): boolean {
    return this.capture !== null;
  }

  /** The screens relayed by the streaming server, keyed by sharer. */
  get relayed(): ReadonlyMap<string, MediaStream> {
    return this.streamer.relayed;
  }

  /**
   * The share to send one mesh peer, or `null` when that peer watches it on the
   * streaming server (or nothing is being shared).
   */
  trackForPeer(peerId: string): MediaStreamTrack | null {
    if (this.capture === null) {
      return null;
    }
    if (!this.viaServer) {
      return this.capture.video;
    }
    const peer = this.host.getParticipants().find((entry) => entry.userId === peerId);
    return peer?.sfu === true ? null : this.capture.video;
  }

  /** Asks the backend once per call whether a streaming server is available. */
  async probe(): Promise<void> {
    if (await this.streamer.probe()) {
      this.follow();
    }
  }

  /** Joins or leaves the streaming room as the roster's sharers change. */
  follow(): void {
    const watched = this.host
      .getParticipants()
      .some((entry) => entry.userId !== this.host.userId && entry.sharingScreen && entry.sfu);
    if (watched) {
      void this.streamer.watch();
    } else {
      void this.streamer.idle();
    }
  }

  async start(): Promise<void> {
    if (this.capture !== null || this.starting) {
      return;
    }
    this.starting = true;
    try {
      await this.begin();
    } finally {
      this.starting = false;
    }
  }

  private async begin(): Promise<void> {
    const settings = this.host.getSettings();
    let capture: DisplayCapture;
    try {
      capture = await acquireDisplay(settings);
    } catch (error) {
      // A cancelled picker is not an error worth shouting about.
      if (!isAbort(error)) {
        this.host.onError(messageOf(error));
      }
      return;
    }
    capture.video.addEventListener("ended", () => {
      void this.stop();
    });
    this.capture = capture;
    this.viaServer = await this.streamer.publish(capture, settings);
    this.host.reportSharing(true);
    await this.host.refreshMesh();
    this.host.onChange();
  }

  async stop(): Promise<void> {
    const capture = this.capture;
    if (capture === null) {
      return;
    }
    this.capture = null;
    this.viaServer = false;
    capture.stop();
    await this.streamer.unpublish();
    this.host.reportSharing(false);
    await this.host.refreshMesh();
    this.follow();
    this.host.onChange();
  }

  /** Drops everything for the end of a call. */
  async reset(): Promise<void> {
    this.capture?.stop();
    this.capture = null;
    this.viaServer = false;
    await this.streamer.reset();
  }
}
