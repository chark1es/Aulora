import { describe, expect, it } from "vitest";
import {
  isLocalHostname,
  normalizeServerUrl,
  ServerUrlError,
  tryNormalizeServerUrl,
  wellKnownUrl,
} from "../src/server-url";

describe("normalizeServerUrl", () => {
  it("accepts a bare hostname and defaults to https", () => {
    expect(normalizeServerUrl("chat.acme.com")).toBe("https://chat.acme.com");
  });

  it("strips trailing slashes and lower-cases the host", () => {
    expect(normalizeServerUrl("https://chat.acme.com/")).toBe("https://chat.acme.com");
    expect(normalizeServerUrl("https://Chat.ACME.com///")).toBe("https://chat.acme.com");
    expect(normalizeServerUrl("  chat.acme.com  ")).toBe("https://chat.acme.com");
  });

  it("keeps a base path but removes its trailing slash", () => {
    expect(normalizeServerUrl("https://chat.acme.com/aulora/")).toBe(
      "https://chat.acme.com/aulora",
    );
    expect(normalizeServerUrl("https://chat.acme.com/aulora")).toBe("https://chat.acme.com/aulora");
  });

  it("keeps non-default ports and drops default ones", () => {
    expect(normalizeServerUrl("https://chat.acme.com:8443")).toBe("https://chat.acme.com:8443");
    expect(normalizeServerUrl("https://chat.acme.com:443")).toBe("https://chat.acme.com");
    expect(normalizeServerUrl("http://localhost:3210")).toBe("http://localhost:3210");
  });

  it("uses http for localhost and loopback", () => {
    expect(normalizeServerUrl("localhost")).toBe("http://localhost");
    expect(normalizeServerUrl("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeServerUrl("127.0.0.1:3210")).toBe("http://127.0.0.1:3210");
    expect(normalizeServerUrl("http://localhost:3210/")).toBe("http://localhost:3210");
    expect(normalizeServerUrl("https://localhost")).toBe("https://localhost");
    expect(normalizeServerUrl("[::1]:3210")).toBe("http://[::1]:3210");
  });

  it("uses http for RFC 1918 and link-local LAN addresses", () => {
    expect(normalizeServerUrl("10.0.0.5")).toBe("http://10.0.0.5");
    expect(normalizeServerUrl("10.255.255.254:8080")).toBe("http://10.255.255.254:8080");
    expect(normalizeServerUrl("192.168.1.20")).toBe("http://192.168.1.20");
    expect(normalizeServerUrl("172.16.0.9")).toBe("http://172.16.0.9");
    expect(normalizeServerUrl("172.31.255.1")).toBe("http://172.31.255.1");
    expect(normalizeServerUrl("169.254.10.10")).toBe("http://169.254.10.10");
  });

  it("rejects insecure http for public hosts", () => {
    expect(() => normalizeServerUrl("http://chat.acme.com")).toThrow(ServerUrlError);
    expect(() => normalizeServerUrl("http://172.15.0.1")).toThrow(ServerUrlError);
    expect(() => normalizeServerUrl("http://8.8.8.8")).toThrow(ServerUrlError);
  });

  it("still allows https for LAN hosts", () => {
    expect(normalizeServerUrl("https://192.168.1.20")).toBe("https://192.168.1.20");
  });

  it("rejects empty, whitespace and non-http(s) input", () => {
    expect(() => normalizeServerUrl("")).toThrow(ServerUrlError);
    expect(() => normalizeServerUrl("   ")).toThrow(ServerUrlError);
    expect(() => normalizeServerUrl("not a url")).toThrow(ServerUrlError);
    expect(() => normalizeServerUrl("ftp://chat.acme.com")).toThrow(ServerUrlError);
    expect(() => normalizeServerUrl("http://")).toThrow(ServerUrlError);
  });

  it("rejects credentials, query strings and fragments", () => {
    expect(() => normalizeServerUrl("https://user:pass@chat.acme.com")).toThrow(ServerUrlError);
    expect(() => normalizeServerUrl("https://chat.acme.com?x=1")).toThrow(ServerUrlError);
    expect(() => normalizeServerUrl("https://chat.acme.com#frag")).toThrow(ServerUrlError);
  });

  it("exposes a non-throwing helper", () => {
    expect(tryNormalizeServerUrl("chat.acme.com")).toBe("https://chat.acme.com");
    expect(tryNormalizeServerUrl("")).toBeNull();
    expect(tryNormalizeServerUrl("http://evil.example")).toBeNull();
  });

  it("builds the well-known URL from a base", () => {
    expect(wellKnownUrl("chat.acme.com")).toBe("https://chat.acme.com/.well-known/aulora.json");
    expect(wellKnownUrl("localhost:3211/")).toBe("http://localhost:3211/.well-known/aulora.json");
  });
});

describe("isLocalHostname", () => {
  it("classifies loopback, LAN and public hosts", () => {
    expect(isLocalHostname("localhost")).toBe(true);
    expect(isLocalHostname("app.localhost")).toBe(true);
    expect(isLocalHostname("127.0.0.1")).toBe(true);
    expect(isLocalHostname("10.1.2.3")).toBe(true);
    expect(isLocalHostname("172.20.0.1")).toBe(true);
    expect(isLocalHostname("192.168.0.10")).toBe(true);
    expect(isLocalHostname("[::1]")).toBe(true);
    expect(isLocalHostname("172.32.0.1")).toBe(false);
    expect(isLocalHostname("chat.acme.com")).toBe(false);
    expect(isLocalHostname("8.8.8.8")).toBe(false);
    expect(isLocalHostname("999.1.1.1")).toBe(false);
  });
});
