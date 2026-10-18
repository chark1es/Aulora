export type EventListener<T> = (payload: T) => void | Promise<void>;

function isPromise(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && "then" in value;
}

/**
 * Minimal typed emitter. Handler failures are reported to the sink (the bot's
 * `error` event) and never escape, so an async handler cannot crash the process.
 */
export class TypedEmitter<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<EventListener<never>>>();

  constructor(private readonly onListenerError: (error: unknown) => void) {}

  on<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): () => void {
    const existing = this.listeners.get(event);
    const set = existing ?? new Set<EventListener<never>>();
    set.add(listener as EventListener<never>);
    this.listeners.set(event, set);
    return () => {
      set.delete(listener as EventListener<never>);
    };
  }

  off<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): void {
    this.listeners.get(event)?.delete(listener as EventListener<never>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (set === undefined) {
      return;
    }
    for (const listener of [...set]) {
      try {
        const result = (listener as EventListener<Events[K]>)(payload);
        if (isPromise(result)) {
          result.catch((error: unknown) => this.onListenerError(error));
        }
      } catch (error) {
        this.onListenerError(error);
      }
    }
  }
}
