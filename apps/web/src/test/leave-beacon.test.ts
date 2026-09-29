import { jsonToConvex } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendLeaveBeacon } from "../lib/voice/leave-beacon";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendLeaveBeacon", () => {
  it("sends nothing without a token", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    sendLeaveBeacon({ convexUrl: "https://chat.example.com", token: null, callId: "abc" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts calls.leave over HTTP with keepalive and the caller's token", () => {
    const fetchMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetchMock);

    sendLeaveBeacon({ convexUrl: "https://chat.example.com", token: "jwt", callId: "call-1" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://chat.example.com/api/mutation");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt");

    const body = JSON.parse(init.body as string) as {
      path: string;
      format: string;
      args: unknown[];
    };
    expect(body.path).toBe("calls:leave");
    expect(body.format).toBe("convex_encoded_json");
    expect(jsonToConvex(body.args[0] as never)).toEqual({ callId: "call-1" });
  });
});
