import type { OutboxItem, OutboxStore } from "@aulora/core";

interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Queue storage is isolated by server and account, including after a restart. */
export function mobileOutboxStore(
  storage: Storage,
  serverUrl: string,
  userId: string,
): OutboxStore {
  const key = `aulora/outbox/${encodeURIComponent(serverUrl)}/${encodeURIComponent(userId)}`;
  let pending = Promise.resolve();
  async function read(): Promise<readonly OutboxItem[]> {
    const raw = await storage.getItem(key);
    if (raw === null) return [];
    const items: OutboxItem[] = JSON.parse(raw);
    // A process can exit while sending; these items must be retried on reopen.
    return items.map((item) => (item.status === "sending" ? { ...item, status: "pending" } : item));
  }
  function write(update: (items: readonly OutboxItem[]) => readonly OutboxItem[]): Promise<void> {
    const result = pending.then(async () => {
      await storage.setItem(key, JSON.stringify(update(await read())));
    });
    pending = result.catch(() => undefined);
    return result;
  }
  return {
    async readAll() {
      await pending;
      return read();
    },
    put(item) {
      return write((items) => [...items.filter((entry) => entry.id !== item.id), item]);
    },
    delete(id) {
      return write((items) => items.filter((entry) => entry.id !== id));
    },
  };
}
