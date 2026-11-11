import { describe, expect, it, vi } from "vitest";
import { notifyAuthError, subscribeAuthChanged, subscribeAuthError } from "../src/index";

describe("mobile auth events", () => {
  it("keeps the stored-error signal separate from session changes", () => {
    const error = vi.fn();
    const session = vi.fn();
    const offError = subscribeAuthError(error);
    subscribeAuthChanged(session);

    notifyAuthError();
    expect(error).toHaveBeenCalledTimes(1);
    expect(session).not.toHaveBeenCalled();

    offError();
    notifyAuthError();
    expect(error).toHaveBeenCalledTimes(1);
  });
});
