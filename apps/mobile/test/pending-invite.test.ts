import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindPendingInvite,
  clearPendingInvite,
  getPendingInvite,
  setPendingInvite,
  subscribePendingInvite,
} from "../src/lib/pending-invite";

describe("pending invite", () => {
  beforeEach(() => {
    clearPendingInvite();
    bindPendingInvite(null);
  });

  it("holds a trimmed code and tells listeners once per change", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePendingInvite(listener);

    setPendingInvite("  ABCD-EFGH-JKMN ");
    expect(getPendingInvite()).toBe("ABCD-EFGH-JKMN");
    setPendingInvite("ABCD-EFGH-JKMN");
    expect(listener).toHaveBeenCalledTimes(1);

    setPendingInvite("   ");
    expect(getPendingInvite()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    setPendingInvite("later");
    expect(listener).toHaveBeenCalledTimes(2);
    setPendingInvite(null);
  });

  it("keeps an unclaimed code across the unauthenticated sign-in flow", () => {
    setPendingInvite("CODE-1234-ABCD");
    bindPendingInvite(null);
    expect(getPendingInvite()).toBe("CODE-1234-ABCD");

    bindPendingInvite("user-a");
    expect(getPendingInvite()).toBe("CODE-1234-ABCD");
  });

  it("drops a code when a different account signs in", () => {
    bindPendingInvite("user-a");
    setPendingInvite("CODE-1234-ABCD");

    bindPendingInvite("user-b");
    expect(getPendingInvite()).toBeNull();
  });

  it("clears a code on sign-out of the owning account", () => {
    bindPendingInvite("user-a");
    setPendingInvite("CODE-1234-ABCD");

    bindPendingInvite(null);
    expect(getPendingInvite()).toBeNull();
  });

  it("keeps the same account's code without notifying listeners", () => {
    bindPendingInvite("user-a");
    setPendingInvite("CODE-1234-ABCD");

    const listener = vi.fn();
    const unsubscribe = subscribePendingInvite(listener);
    bindPendingInvite("user-a");

    expect(getPendingInvite()).toBe("CODE-1234-ABCD");
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
