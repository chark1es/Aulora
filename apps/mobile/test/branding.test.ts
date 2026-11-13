import { describe, expect, it, vi } from "vitest";
import { fetchBranding } from "../src/lib/branding";

const NO_BRANDING = { description: "", logoUrl: null, serverId: null };

describe("fetchBranding", () => {
  it("reads the description, logo and mobile wake identity", async () => {
    const close = vi.fn();
    const query = vi.fn(async () => ({
      description: "Acme chat",
      logoUrl: "https://a.test/l.png",
      pushRelay: { serverId: "6b1a0f8e-6a1f-4f4b-8c4d-2f6f6d2f5a11" },
    }));

    await expect(
      fetchBranding("https://convex.acme.test", () => ({ query, close }), "publicConfig"),
    ).resolves.toEqual({
      description: "Acme chat",
      logoUrl: "https://a.test/l.png",
      serverId: "6b1a0f8e-6a1f-4f4b-8c4d-2f6f6d2f5a11",
    });
    expect(query).toHaveBeenCalledWith("publicConfig", {});
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("degrades to no branding when the client refuses the address", async () => {
    // `new ConvexReactClient("chat.acme.com")` throws "Provided address was not
    // an absolute URL."; a well-known document only promises a non-empty
    // string, so this used to reject out of the connect screen's handler.
    const thrown = () => {
      throw new Error("Provided address was not an absolute URL.");
    };

    await expect(fetchBranding("chat.acme.com", thrown, "publicConfig")).resolves.toEqual(
      NO_BRANDING,
    );
  });

  it("degrades when the query fails and still closes the client", async () => {
    const close = vi.fn();
    const query = vi.fn(async () => {
      throw new Error("could not reach the deployment");
    });

    await expect(
      fetchBranding("https://convex.acme.test", () => ({ query, close }), "publicConfig"),
    ).resolves.toEqual(NO_BRANDING);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("coerces a malformed answer instead of passing it to the view", async () => {
    const close = vi.fn();
    const query = vi.fn(async () => ({ description: 7, logoUrl: "" }));

    await expect(
      fetchBranding("https://convex.acme.test", () => ({ query, close }), "publicConfig"),
    ).resolves.toEqual(NO_BRANDING);
  });

  it("resolves when close throws", async () => {
    const close = () => {
      throw new Error("already closed");
    };
    const query = vi.fn(async () => ({ description: "Acme", logoUrl: null }));

    await expect(
      fetchBranding("https://convex.acme.test", () => ({ query, close }), "publicConfig"),
    ).resolves.toEqual({ description: "Acme", logoUrl: null, serverId: null });
  });
});
