import { describe, expect, it, vi } from "vitest";
import {
  notifyAuthChanged,
  notifyAuthError,
  subscribeAuthChanged,
  subscribeAuthError,
} from "../lib/auth-events";

describe("auth events", () => {
  it("notifies every subscriber until it unsubscribes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = subscribeAuthChanged(first);
    const offSecond = subscribeAuthChanged(second);

    notifyAuthChanged();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    offFirst();
    notifyAuthChanged();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);

    offSecond();
    notifyAuthChanged();
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("allows a listener to unsubscribe during the notification", () => {
    const second = vi.fn();
    const offSecond = subscribeAuthChanged(second);
    subscribeAuthChanged(() => {
      offSecond();
    });

    expect(() => notifyAuthChanged()).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("notifies stored-error subscribers separately from session changes", () => {
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
