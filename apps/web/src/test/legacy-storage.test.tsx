import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
});
function mockDatabase(texts: string[], blocked = false) {
  const deleteDatabase = vi.fn(() => {
    const request = {} as IDBOpenDBRequest;
    queueMicrotask(() =>
      blocked ? request.onblocked?.({} as never) : request.onsuccess?.({} as never),
    );
    return request;
  });
  const open = vi.fn(() => {
    const read = { result: texts.map((text) => ({ text })) };
    const transaction = { objectStore: () => ({ getAll: () => read }), oncomplete: () => {} };
    const request = {
      result: {
        objectStoreNames: { contains: () => true },
        close: vi.fn(),
        transaction: () => {
          queueMicrotask(() => transaction.oncomplete());
          return transaction;
        },
      },
      onsuccess: () => {},
    };
    queueMicrotask(() => request.onsuccess());
    return request;
  });
  vi.stubGlobal("indexedDB", { open, deleteDatabase });
  return { deleteDatabase, open };
}
it("preserves queued text and drafts before purging, leaving scoped stores intact", async () => {
  const { deleteDatabase } = mockDatabase(["queued"]);
  localStorage.setItem("aulora.draft.v1:c", "draft");
  localStorage.setItem("aulora.draft.v2:account:c", "scoped");
  const { purgeLegacyStorage, legacyRecovery, dismissLegacyRecovery } = await import(
    "../lib/legacy-storage"
  );
  await purgeLegacyStorage("account-a");
  expect(legacyRecovery("account-a")).toEqual(["queued", "draft"]);
  expect(localStorage.getItem("aulora.draft.v1:c")).toBeNull();
  expect(localStorage.getItem("aulora.draft.v2:account:c")).toBe("scoped");
  expect(localStorage.getItem("aulora.storage.legacy-purged.v1")).toBe("1");
  await purgeLegacyStorage("account-a");
  expect(deleteDatabase).toHaveBeenCalledTimes(1);
  dismissLegacyRecovery("account-a");
  expect(legacyRecovery("account-a")).toEqual([]);
  expect(sessionStorage.getItem("aulora.storage.legacy-recovery.v1")).toBeNull();
});
it("only marks the purge after success and retries a blocked deletion", async () => {
  mockDatabase(["queued"], true);
  const { purgeLegacyStorage, legacyRecovery } = await import("../lib/legacy-storage");
  await purgeLegacyStorage("account-a");
  expect(legacyRecovery("account-a")).toContain("queued");
  expect(localStorage.getItem("aulora.storage.legacy-purged.v1")).toBeNull();
  mockDatabase([]);
  await purgeLegacyStorage("account-a");
  expect(localStorage.getItem("aulora.storage.legacy-purged.v1")).toBe("1");
});
it("shows recoverable messages with Copy and removes them on dismissal", async () => {
  mockDatabase(["recover this"]);
  const copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
  const { LegacyRecoveryNotice } = await import("../components/LegacyRecoveryNotice");
  render(<LegacyRecoveryNotice scope="account-a" />);
  await screen.findByText("recover this");
  fireEvent.click(screen.getByText("Copy"));
  expect(copy).toHaveBeenCalledWith("recover this");
  fireEvent.click(screen.getByText("Dismiss"));
  await waitFor(() => expect(screen.queryByText("recover this")).toBeNull());
});
it("shows no banner without pending text", async () => {
  mockDatabase([]);
  const { LegacyRecoveryNotice } = await import("../components/LegacyRecoveryNotice");
  const { container } = render(<LegacyRecoveryNotice scope="account-a" />);
  await waitFor(() => expect(localStorage.getItem("aulora.storage.legacy-purged.v1")).toBe("1"));
  expect(container).toBeEmptyDOMElement();
});

it("isolates account switches in one module and survives a new tab module", async () => {
  mockDatabase(["private queue"]);
  const storage = await import("../lib/legacy-storage");
  await storage.purgeLegacyStorage("account-a");
  expect(storage.legacyRecovery("account-b")).toEqual([]);
  await storage.purgeLegacyStorage("account-b");
  expect(storage.legacyRecovery("account-b")).toEqual([]);
  expect(storage.legacyRecovery("account-a")).toEqual(["private queue"]);
  // A tab close destroys sessionStorage and module state but retains localStorage.
  sessionStorage.clear();
  vi.resetModules();
  const newTab = await import("../lib/legacy-storage");
  expect(newTab.legacyRecovery("account-a")).toEqual(["private queue"]);
  expect(newTab.legacyRecovery("account-b")).toEqual([]);
});
it("retains sources if the durable recovery write fails", async () => {
  const { deleteDatabase, open } = mockDatabase(["queue"]);
  localStorage.setItem("aulora.draft.v1:c", "draft");
  const original = Storage.prototype.setItem;
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key,
    value,
  ) {
    if (key.startsWith("aulora.storage.legacy-recovery")) throw new Error("quota");
    original.call(this, key, value);
  });
  const { purgeLegacyStorage } = await import("../lib/legacy-storage");
  await purgeLegacyStorage("account-a");
  expect(localStorage.getItem("aulora.draft.v1:c")).toBe("draft");
  expect(deleteDatabase).not.toHaveBeenCalled();
  await purgeLegacyStorage("account-a");
  expect(open).toHaveBeenCalledTimes(1);
  const { LegacyRecoveryNotice } = await import("../components/LegacyRecoveryNotice");
  render(<LegacyRecoveryNotice scope="account-a" />);
  await screen.findByText(/Couldn’t copy your old drafts/);
  write.mockRestore();
});
it("announces successful copying after failure and returns Dismiss focus to main", async () => {
  mockDatabase([]);
  localStorage.setItem("aulora.storage.legacy-purged.v1", "1");
  localStorage.setItem(
    "aulora.storage.legacy-recovery.v1:account-a",
    JSON.stringify(["duplicate", "duplicate"]),
  );
  const copy = vi.fn().mockRejectedValueOnce(new Error("denied")).mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
  const { LegacyRecoveryNotice } = await import("../components/LegacyRecoveryNotice");
  render(
    <>
      <LegacyRecoveryNotice scope="account-a" />
      <main>Conversation</main>
    </>,
  );
  expect(screen.getAllByText("duplicate")).toHaveLength(2);
  fireEvent.click(screen.getAllByText("Copy").at(0) as HTMLElement);
  await screen.findByRole("alert");
  fireEvent.click(screen.getAllByText("Copy").at(0) as HTMLElement);
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(screen.getByRole("status")).toHaveTextContent("Copied");
  fireEvent.click(screen.getByText("Dismiss"));
  expect(screen.getByRole("main")).toHaveFocus();
  expect(localStorage.getItem("aulora.storage.legacy-recovery.v1:account-a")).toBeNull();
});
it("lets only one tab claim the private queue during interleaved migration", async () => {
  mockDatabase(["private queue"]);
  const tabA = await import("../lib/legacy-storage");
  vi.resetModules();
  const tabB = await import("../lib/legacy-storage");
  await Promise.all([tabA.purgeLegacyStorage("a"), tabB.purgeLegacyStorage("b")]);
  expect(
    [tabA.legacyRecovery("a"), tabB.legacyRecovery("b")].filter((rows) => rows.length),
  ).toHaveLength(1);
});
it("migrates local drafts when IndexedDB is unavailable", async () => {
  vi.stubGlobal("indexedDB", undefined);
  localStorage.setItem("aulora.draft.v1:c", "draft");
  const storage = await import("../lib/legacy-storage");
  await storage.purgeLegacyStorage("a");
  expect(storage.legacyRecovery("a")).toEqual(["draft"]);
});
it("does not restore dismissed text after an in-flight read", async () => {
  mockDatabase(["private"]);
  const storage = await import("../lib/legacy-storage");
  const migration = storage.purgeLegacyStorage("a");
  storage.dismissLegacyRecovery("a");
  await migration;
  expect(storage.legacyRecovery("a")).toEqual([]);
});
it("synchronizes dismissal from another tab and handles a missing clipboard", async () => {
  mockDatabase([]);
  localStorage.setItem("aulora.storage.legacy-purged.v1", "1");
  localStorage.setItem("aulora.storage.legacy-recovery.v1:a", JSON.stringify(["recover"]));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  const { LegacyRecoveryNotice } = await import("../components/LegacyRecoveryNotice");
  render(<LegacyRecoveryNotice scope="a" />);
  fireEvent.click(screen.getByText("Copy"));
  expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t copy");
  const storage = await import("../lib/legacy-storage");
  storage.dismissLegacyRecovery("a");
  fireEvent(window, new StorageEvent("storage"));
  await waitFor(() => expect(screen.queryByText("recover")).toBeNull());
});
it("keeps oversized sources instead of silently truncating them", async () => {
  mockDatabase([]);
  localStorage.setItem("aulora.draft.v1:c", "x".repeat(10001));
  const storage = await import("../lib/legacy-storage");
  await storage.purgeLegacyStorage("a");
  expect(storage.legacyRecoveryFailed("a")).toBe(true);
  expect(localStorage.getItem("aulora.draft.v1:c")).toHaveLength(10001);
});
