import { describe, expect, it, vi } from "vitest";
import {
  getPendingInvite,
  setPendingInvite,
  subscribePendingInvite,
} from "../src/lib/pending-invite";

describe("pending invite", () => {
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
});
