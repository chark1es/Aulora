/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { SfuAccess, VoiceDeviceSettings } from "@aulora/core";
import { streamProfile } from "@aulora/core";
import type { DisplayCapture } from "./display";
import { connectLiveKit, type SfuConnection, type SfuConnector } from "./sfu-room";

/** How soon a dropped viewer connection may be retried, so a down server is not hammered. */
const RETRY_MS = 5_000;

export interface ScreenStreamHost {
  /** Asks the backend for room access; `null` when the workspace has no streaming server. */
  fetchAccess(): Promise<SfuAccess | null>;
  /**
   * Tells the roster whether this device can use the streaming server right now.
   * A sharer sends over the mesh to anyone who reports `false`, so this must flip
   * to `false` the moment the connection fails or drops.
   */
  reportCapable(capable: boolean): void;
  /** The relayed screens changed. */
  onScreens(screens: ReadonlyMap<string, MediaStream>): void;
  /** The stream this device was publishing is gone and must fall back to the mesh. */
  onPublishLost(): void;
}

/**
 * Sends and receives screen shares through the optional streaming server.
 *
 * Capability is learned once per call by asking the backend for room access.
 * A device that can use the server says so on the roster, and a sharer then
 * relays through the server for every viewer who said the same, sending over
 * the peer mesh only to those who did not. Any failure here degrades to the
 * mesh instead of ending the share.
 */
export class ScreenStreamer {
  private access: SfuAccess | null = null;
  private connection: SfuConnection | null = null;
  private connecting: Promise<SfuConnection | null> | null = null;
  private publishing = false;
  private lastFailure = 0;
  private generation = 0;
  private reachable: boolean | null = null;
  private screens: ReadonlyMap<string, MediaStream> = new Map();

  constructor(
    private readonly host: ScreenStreamHost,
    private readonly connector: SfuConnector = connectLiveKit,
  ) {}

  get capable(): boolean {
    return this.access !== null;
  }

  get canPublish(): boolean {
    return this.access?.canPublish === true;
  }

  get relayed(): ReadonlyMap<string, MediaStream> {
    return this.screens;
  }

  /** Learns whether the workspace has a streaming server this user can reach. */
  async probe(): Promise<boolean> {
    const generation = this.generation;
    try {
      const access = await this.host.fetchAccess();
      if (generation !== this.generation) {
        return false;
      }
      this.access = access;
    } catch {
      this.access = null;
    }
    this.setReachable(this.access !== null);
    return this.access !== null;
  }

  /** Joins the room as a viewer so a relayed share can arrive. Idempotent. */
  async watch(): Promise<void> {
    if (this.connection !== null || this.connecting !== null || this.access === null) {
      return;
    }
    if (Date.now() - this.lastFailure < RETRY_MS) {
      return;
    }
    await this.connect();
  }

  /** Leaves the room when nobody is relaying a share and this device is not. */
  async idle(): Promise<void> {
    if (this.publishing) {
      return;
    }
    await this.close();
  }

  /** Publishes a capture. Returns `false` (leaving the mesh to carry it) on any failure. */
  async publish(capture: DisplayCapture, settings: VoiceDeviceSettings): Promise<boolean> {
    if (this.access === null || !this.access.canPublish) {
      return false;
    }
    const connection = this.connection ?? (await this.connect());
    if (connection === null) {
      return false;
    }
    try {
      await connection.publish(capture, {
        profile: streamProfile(settings.streamQuality),
        codec: settings.screenCodec,
      });
      this.publishing = true;
      return true;
    } catch {
      this.setReachable(false);
      await this.close();
      return false;
    }
  }

  async unpublish(): Promise<void> {
    if (!this.publishing) {
      return;
    }
    this.publishing = false;
    await this.connection?.unpublish();
  }

  /** Drops everything for the end of a call. */
  async reset(): Promise<void> {
    this.generation += 1;
    this.access = null;
    this.publishing = false;
    this.lastFailure = 0;
    this.reachable = null;
    await this.close();
  }

  private connect(): Promise<SfuConnection | null> {
    if (this.connecting !== null) {
      return this.connecting;
    }
    const access = this.access;
    if (access === null) {
      return Promise.resolve(null);
    }
    const generation = this.generation;
    this.connecting = this.open(access, generation).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async open(access: SfuAccess, generation: number): Promise<SfuConnection | null> {
    try {
      const connection = await this.connector(access, {
        onScreens: (screens) => {
          if (generation === this.generation) {
            this.screens = screens;
            this.host.onScreens(screens);
          }
        },
        onClosed: () => {
          if (generation === this.generation) {
            this.handleClosed(connection);
          }
        },
      });
      if (generation !== this.generation) {
        await connection.disconnect();
        return null;
      }
      this.connection = connection;
      this.setReachable(true);
      return connection;
    } catch {
      this.lastFailure = Date.now();
      this.setReachable(false);
      return null;
    }
  }

  private handleClosed(closed: SfuConnection | null): void {
    if (closed !== null && this.connection !== closed) {
      return;
    }
    const wasPublishing = this.publishing;
    this.connection = null;
    this.publishing = false;
    this.lastFailure = Date.now();
    this.setReachable(false);
    if (wasPublishing) {
      this.host.onPublishLost();
    }
  }

  private setReachable(value: boolean): void {
    if (this.reachable !== value) {
      this.reachable = value;
      this.host.reportCapable(value);
    }
  }

  private async close(): Promise<void> {
    const connection = this.connection;
    this.connection = null;
    if (this.screens.size > 0) {
      this.screens = new Map();
      this.host.onScreens(this.screens);
    }
    await connection?.disconnect();
  }
}
