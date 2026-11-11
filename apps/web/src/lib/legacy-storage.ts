let pending: Promise<void> | undefined;
const MARKER = "aulora.storage.legacy-purged.v1";
const RECOVERY = "aulora.storage.legacy-recovery.v1";
const DISMISSED = "aulora.storage.legacy-dismissed.v1";
const FAILED = "aulora.storage.legacy-failed.v1";
const failed = new Set<string>();
export function legacyRecoveryFailed(scope: string): boolean {
  try {
    if (localStorage.getItem(`${DISMISSED}:${scope}`)) return false;
    return failed.has(scope) || localStorage.getItem(`${FAILED}:${scope}`) === "1";
  } catch {
    return failed.has(scope);
  }
}

const OWNER = "aulora.storage.legacy-owner.v1";

// No plaintext module cache: switching accounts cannot reuse another account's list.
export function legacyRecovery(scope: string): readonly string[] {
  try {
    if (localStorage.getItem(`${DISMISSED}:${scope}`)) return [];
    const stored: unknown = JSON.parse(localStorage.getItem(`${RECOVERY}:${scope}`) ?? "[]");
    return Array.isArray(stored)
      ? stored
          .filter((text): text is string => typeof text === "string")
          .slice(0, 100)
          .map((text) => text.slice(0, 10000))
      : [];
  } catch {
    return [];
  }
}
export function dismissLegacyRecovery(scope: string): void {
  localStorage.setItem(`${DISMISSED}:${scope}`, "1");
  localStorage.removeItem(`${RECOVERY}:${scope}`);
  failed.delete(scope);
  localStorage.removeItem(`${FAILED}:${scope}`);
}
function preserve(scope: string, texts: string[]): void {
  if (localStorage.getItem(`${DISMISSED}:${scope}`)) return;
  const recovery = [
    ...new Set([...legacyRecovery(scope), ...texts.filter((text) => text.trim().length > 0)]),
  ];
  if (recovery.length > 100 || recovery.some((text) => text.length > 10000)) {
    throw new Error("Legacy recovery exceeds the local copy limit");
  }
  // Throw on quota/security failures. Sources must remain until this succeeds.
  localStorage.setItem(`${RECOVERY}:${scope}`, JSON.stringify(recovery));
}

async function readLegacyOutbox(): Promise<string[]> {
  if (typeof indexedDB === "undefined") return [];
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("aulora-outbox");
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Legacy outbox is open in another tab"));
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("sends")) {
        db.close();
        resolve([]);
        return;
      }
      const transaction = db.transaction("sends", "readonly");
      const read = transaction.objectStore("sends").getAll();
      transaction.oncomplete = () => {
        db.close();
        resolve(
          read.result.flatMap((item: { text?: unknown }) =>
            typeof item.text === "string" ? [item.text] : [],
          ),
        );
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
      transaction.onabort = () => {
        db.close();
        reject(transaction.error);
      };
    };
  });
}

/** Cooperative bakery lock: localStorage has no atomic read/modify/write CAS.
 * Each contender owns a unique key, then yields to lower tickets. A crashed
 * contender blocks recovery rather than exposing its private text to a rival.
 */
async function fallbackLock(run: () => Promise<void>): Promise<void> {
  const prefix = `${OWNER}:claim:`;
  const nonce = crypto.randomUUID();
  const key = `${prefix}${nonce}`;
  const contenders = () => {
    const entries: { nonce: string; ticket: number }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const entry = localStorage.key(i);
      if (entry?.startsWith(prefix))
        entries.push({
          nonce: entry.slice(prefix.length),
          ticket: Number(localStorage.getItem(entry)),
        });
    }
    return entries;
  };
  localStorage.setItem(key, "0"); // Choosing a ticket.
  try {
    const ticket = Math.max(0, ...contenders().map((entry) => entry.ticket)) + 1;
    localStorage.setItem(key, String(ticket));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (localStorage.getItem(key) !== String(ticket)) return;
    // ifAvailable: the losing tab may retry on its next mount.
    if (
      contenders().some(
        (entry) =>
          entry.nonce !== nonce &&
          (entry.ticket === 0 ||
            entry.ticket < ticket ||
            (entry.ticket === ticket && entry.nonce < nonce)),
      )
    )
      return;
    await run();
  } finally {
    localStorage.removeItem(key);
  }
}

/** Preserve unsent text locally before removing pre-account-scoping stores. */
export function purgeLegacyStorage(scope: string): Promise<void> {
  if (pending) return pending.then(() => purgeLegacyStorage(scope));
  const migrate = async () => {
    if (localStorage.getItem(MARKER) === "1" || legacyRecoveryFailed(scope)) return;
    const owner = localStorage.getItem(OWNER);
    if (owner !== null && owner !== scope) return;
    localStorage.setItem(OWNER, scope);
    const texts = await readLegacyOutbox();
    if (localStorage.getItem(OWNER) !== scope) return;
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith("aulora.draft.v1:")) {
        keys.push(key);
        const draft = localStorage.getItem(key);
        if (draft) texts.push(draft);
      }
    }
    try {
      preserve(scope, texts);
    } catch {
      failed.add(scope);
      try {
        localStorage.setItem(`${FAILED}:${scope}`, "1");
      } catch {
        /* Storage unavailable. */
      }
      return;
    }
    for (const key of keys) localStorage.removeItem(key);
    if (typeof indexedDB !== "undefined")
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase("aulora-outbox");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("Legacy outbox deletion blocked"));
      });
    localStorage.setItem(MARKER, "1");
  };
  pending = (
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request(
          "aulora-legacy-storage-v1",
          { mode: "exclusive", ifAvailable: true },
          async (lock) => {
            if (lock) await migrate();
          },
        )
      : fallbackLock(migrate)
  )
    .then(() => undefined)
    .catch(() => {
      // Reading/deletion failures may be transient; durable-copy failures above
      // keep their own failure marker and never retry on every mount.
    })
    .finally(() => {
      pending = undefined;
    });
  return pending;
}
