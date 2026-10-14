import { describe, expect, it } from "vitest";
import {
  buildOidcEntries,
  discoveryUrlError,
  EMPTY_OIDC_FORM,
  type EnvVariable,
  envManagedReason,
  envSourceLabel,
  envSourceTone,
  envValueLabel,
  oidcFormFromVariables,
} from "../lib/instance-env";

type EnvVariableOverrides = Partial<EnvVariable> & { readonly key: string };

function variable(overrides: EnvVariableOverrides): EnvVariable {
  const base: EnvVariable = {
    key: overrides.key,
    group: "oidc",
    label: "Label",
    description: "Description",
    type: "string",
    enumValues: null,
    secret: false,
    overridable: true,
    managedInSection: null,
    source: "environment",
    isSet: true,
  };
  return Object.assign(base, overrides);
}

describe("environment labels", () => {
  it("labels and tones each source", () => {
    expect(envSourceLabel("environment")).toBe("Environment");
    expect(envSourceLabel("ui")).toBe("Overridden in UI");
    expect(envSourceLabel("unset")).toBe("Not set");
    expect(envSourceTone("ui")).toBe("accent");
    expect(envSourceTone("environment")).toBe("secondary");
    expect(envSourceTone("unset")).toBe("muted");
  });

  it("never renders a deployment value", () => {
    expect(envValueLabel(variable({ key: "GITHUB_CLIENT_ID" }))).toBe(
      "Set by the deployment (value hidden)",
    );
    expect(
      envValueLabel(variable({ key: "GITHUB_CLIENT_ID", source: "unset", isSet: false })),
    ).toBe("Not set");
    expect(envValueLabel(variable({ key: "OIDC_CLIENT_ID", source: "ui", value: "ui-id" }))).toBe(
      "ui-id",
    );
    expect(envValueLabel(variable({ key: "OIDC_CLIENT_SECRET", secret: true, source: "ui" }))).toBe(
      "Set (hidden)",
    );
  });

  it("explains why a row is read-only", () => {
    expect(envManagedReason(variable({ key: "GITHUB_CLIENT_ID" }))).toBeNull();
    expect(
      envManagedReason(
        variable({ key: "PUSH_RELAY_URL", overridable: false, managedInSection: "Push relay" }),
      ),
    ).toContain("Push relay");
    expect(envManagedReason(variable({ key: "SITE_URL", overridable: false }))).toContain(
      "lock everyone out",
    );
  });
});

describe("discoveryUrlError", () => {
  it("accepts an https discovery document", () => {
    expect(
      discoveryUrlError("https://idp.example.com/.well-known/openid-configuration"),
    ).toBeNull();
  });

  it("allows http only on localhost", () => {
    expect(discoveryUrlError("http://localhost:8080/.well-known/openid-configuration")).toBeNull();
    expect(discoveryUrlError("http://idp.example.com/.well-known/openid-configuration")).toContain(
      "https",
    );
  });

  it("requires the well-known suffix and a parseable URL", () => {
    expect(discoveryUrlError("https://idp.example.com/")).toContain("openid-configuration");
    expect(discoveryUrlError("not a url")).toContain("absolute");
    expect(discoveryUrlError("")).toContain("Enter");
  });
});

describe("OIDC form helpers", () => {
  it("builds only non-empty entries", () => {
    const entries = buildOidcEntries({
      ...EMPTY_OIDC_FORM,
      issuer: "https://idp.example.com",
      discoveryUrl: "https://idp.example.com/.well-known/openid-configuration",
      clientId: "client",
      clientSecret: "secret",
    });
    expect(entries.map((entry) => entry.key)).toEqual([
      "OIDC_ISSUER",
      "OIDC_DISCOVERY_URL",
      "OIDC_CLIENT_ID",
      "OIDC_CLIENT_SECRET",
      "OIDC_SCOPES",
    ]);
  });

  it("prefills from UI-saved values but never a secret", () => {
    const values = oidcFormFromVariables([
      variable({ key: "OIDC_ISSUER", source: "ui", value: "https://ui-idp.example" }),
      variable({ key: "OIDC_CLIENT_ID", source: "ui", value: "ui-client" }),
      variable({ key: "OIDC_CLIENT_SECRET", secret: true, source: "ui" }),
    ]);
    expect(values.issuer).toBe("https://ui-idp.example");
    expect(values.clientId).toBe("ui-client");
    expect(values.clientSecret).toBe("");
    expect(values.scopes).toBe("openid profile email");
  });
});
