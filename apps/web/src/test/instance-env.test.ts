import { describe, expect, it } from "vitest";
import {
  buildOidcEntries,
  discoveryUrlError,
  EMPTY_OIDC_FORM,
  type EnvVariable,
  envFieldMeta,
  envGroupSummaries,
  envManagedReason,
  envSourceLabel,
  envSourceTone,
  envValueError,
  envValueLabel,
  firstEnvGroup,
  oidcFormFromVariables,
  parseEnvList,
  prettyJson,
  selectEnvBlocks,
  serializeEnvList,
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
    expect(envSourceLabel("environment")).toBe("Deployment");
    expect(envSourceLabel("ui")).toBe("Overridden");
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
      "••••••",
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

describe("envFieldMeta", () => {
  it("mirrors catalog bounds and formats by key", () => {
    const passwordLength = envFieldMeta(variable({ key: "AUTH_MIN_PASSWORD_LENGTH" }));
    expect(passwordLength.min).toBe(1);
    expect(passwordLength.max).toBe(128);
    expect(passwordLength.defaultValue).toBe("8");
    expect(envFieldMeta(variable({ key: "OIDC_GROUP_ROLE_MAP" })).format).toBe("group-role-map");
    expect(envFieldMeta(variable({ key: "AULORA_ICE_SERVERS" })).format).toBe("ice-servers");
    expect(envFieldMeta(variable({ key: "GITHUB_CLIENT_ID" })).format).toBeNull();
  });
});

describe("envValueError", () => {
  it("checks URLs, numbers, booleans and enums", () => {
    const url = variable({ key: "OIDC_ISSUER", type: "url" });
    expect(envValueError(url, "https://idp.example")).toBeNull();
    expect(envValueError(url, "not a url")).toContain("absolute");

    const number = variable({ key: "AUTH_MIN_PASSWORD_LENGTH", type: "number" });
    expect(envValueError(number, "12")).toBeNull();
    expect(envValueError(number, "0")).toContain("at least 1");
    expect(envValueError(number, "200")).toContain("at most 128");
    expect(envValueError(number, "1.5")).toContain("whole number");

    const boolean = variable({ key: "AUTH_LOCAL_ENABLED", type: "boolean" });
    expect(envValueError(boolean, "true")).toBeNull();
    expect(envValueError(boolean, "maybe")).toContain("Enabled");

    const enumm = variable({
      key: "AULORA_EMAIL_PROVIDER",
      type: "enum",
      enumValues: ["none", "resend", "smtp"],
    });
    expect(envValueError(enumm, "smtp")).toBeNull();
    expect(envValueError(enumm, "carrier-pigeon")).toContain("none, resend, smtp");
  });

  it("checks list and structured JSON formats", () => {
    const list = variable({ key: "OIDC_SCOPES", type: "list" });
    expect(envValueError(list, "openid profile email")).toBeNull();
    expect(envValueError(list, "   ")).toContain("Enter a value");

    const groupRoleMap = variable({ key: "OIDC_GROUP_ROLE_MAP", type: "json" });
    expect(envValueError(groupRoleMap, '{"admins":"Admin"}')).toBeNull();
    expect(envValueError(groupRoleMap, '["Admin"]')).toContain("mapping groups");
    expect(envValueError(groupRoleMap, "{nope}")).toContain("valid JSON");

    const ice = variable({ key: "AULORA_ICE_SERVERS", type: "json" });
    expect(envValueError(ice, '[{"urls":["stun:stun.example.com:3478"]}]')).toBeNull();
    expect(envValueError(ice, "{}")).toContain("array");
  });
});

describe("list and JSON helpers", () => {
  it("splits and joins display lists", () => {
    expect(parseEnvList("openid, profile  email")).toEqual(["openid", "profile", "email"]);
    expect(serializeEnvList(["openid", "profile"])).toBe("openid profile");
    expect(parseEnvList("   ")).toEqual([]);
  });

  it("pretty-prints valid JSON only", () => {
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyJson("{oops}")).toBeNull();
  });
});

describe("environment grouping and filtering", () => {
  const groups = [
    { id: "auth-providers" as const, label: "Auth providers" },
    { id: "oidc" as const, label: "Single sign-on (OIDC)" },
  ];
  const alpha = variable({
    key: "A",
    group: "auth-providers",
    label: "Alpha",
    source: "ui",
    value: "x",
  });
  const beta = variable({ key: "B", group: "auth-providers", overridable: false });
  const gamma = variable({ key: "C", group: "oidc", label: "Gamma" });

  it("summarises per-group totals and overrides", () => {
    const summaries = envGroupSummaries(groups, [alpha, beta, gamma]);
    expect(summaries).toEqual([
      { id: "auth-providers", label: "Auth providers", total: 2, overridden: 1 },
      { id: "oidc", label: "Single sign-on (OIDC)", total: 1, overridden: 0 },
    ]);
    expect(firstEnvGroup(summaries)).toBe("auth-providers");
    expect(firstEnvGroup([{ id: "empty", label: "Empty", total: 0, overridden: 0 }])).toBe("empty");
  });

  it("shows one group by default and widens when searching", () => {
    const base = {
      groups,
      variables: [alpha, beta, gamma],
      activeGroup: "auth-providers",
      filter: "all" as const,
    };
    const only = selectEnvBlocks({ ...base, query: "" });
    expect(only.map((block) => block.id)).toEqual(["auth-providers"]);
    expect(only[0]?.variables.map((entry) => entry.key)).toEqual(["A", "B"]);

    const searched = selectEnvBlocks({ ...base, query: "gamma" });
    expect(searched.map((block) => block.id)).toEqual(["oidc"]);
  });

  it("filters by override state across groups", () => {
    const base = {
      groups,
      variables: [alpha, beta, gamma],
      activeGroup: "auth-providers",
      query: "",
    };
    const overridden = selectEnvBlocks({ ...base, filter: "overridden" });
    expect(overridden.flatMap((block) => block.variables).map((entry) => entry.key)).toEqual(["A"]);
    const readOnly = selectEnvBlocks({ ...base, filter: "read-only" });
    expect(readOnly.flatMap((block) => block.variables).map((entry) => entry.key)).toEqual(["B"]);
    const overridable = selectEnvBlocks({ ...base, filter: "overridable" });
    expect(overridable.flatMap((block) => block.variables).map((entry) => entry.key)).toEqual([
      "A",
      "C",
    ]);
  });
});
