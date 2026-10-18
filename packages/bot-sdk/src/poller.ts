import type { BotPollResult } from "./types.js";

export interface PollerOptions {
  readonly intervalMs: number;
  readonly backoffMs: number;
  readonly poll: (cursor: number | null, signal: AbortSignal) => Promise<BotPollResult>;
  readonly onResult: (result: BotPollResult) => void;
  readonly onError: (error: unknown) => void;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/**
 * Sequential polling loop: the next poll is scheduled only after the previous
 * one settles, so two polls are never in flight. Failures back off instead of
 * hammering the deployment, and `stop()` clears the timer and aborts any
 * in-flight request.
 */
export class EventPoller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private cursor: number | null = null;
  private running = false;

  constructor(private readonly options: PollerOptions) {}

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.controller?.abort();
    this.controller = null;
  }

  private schedule(delay: number): void {
    if (!this.running) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, delay);
  }

  private async tick(): Promise<void> {
    if (!this.running) {
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    try {
      const result = await this.options.poll(this.cursor, controller.signal);
      if (!this.running) {
        return;
      }
      this.cursor = result.cursor;
      this.options.onResult(result);
      this.schedule(this.options.intervalMs);
    } catch (error) {
      if (!this.running || isAbortError(error)) {
        return;
      }
      this.options.onError(error);
      this.schedule(this.options.backoffMs);
    } finally {
      if (this.controller === controller) {
        this.controller = null;
      }
    }
  }
}
