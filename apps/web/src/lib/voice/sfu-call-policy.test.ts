import { describe, expect, it } from "vitest";
import {
  capabilitiesOf,
  decideTransport,
  SFU_CALL_CAPABILITY,
  SFU_CALL_THRESHOLD,
} from "./sfu-call-policy";

const ABLE = [SFU_CALL_CAPABILITY];
const UNABLE: readonly string[] = [];

function capable(count: number): readonly (readonly string[])[] {
  return Array.from({ length: count }, () => ABLE);
}

describe("decideTransport", () => {
  it("keeps a call at or below the threshold on the mesh", () => {
    expect(
      decideTransport({
        participants: SFU_CALL_THRESHOLD,
        sfuConfigured: true,
        capabilities: capable(SFU_CALL_THRESHOLD),
      }),
    ).toBe("mesh");
  });

  it("moves a larger, fully capable call to the streaming server", () => {
    expect(
      decideTransport({
        participants: SFU_CALL_THRESHOLD + 1,
        sfuConfigured: true,
        capabilities: capable(SFU_CALL_THRESHOLD + 1),
      }),
    ).toBe("sfu");
  });

  it("keeps the mesh when the workspace has no streaming server", () => {
    expect(
      decideTransport({
        participants: 8,
        sfuConfigured: false,
        capabilities: capable(8),
      }),
    ).toBe("mesh");
  });

  it("keeps the whole call on the mesh when one client cannot use the SFU", () => {
    const capabilities = [...capable(7), UNABLE];
    expect(decideTransport({ participants: 8, sfuConfigured: true, capabilities })).toBe("mesh");
  });

  it("keeps the mesh when a capability row is missing", () => {
    expect(
      decideTransport({
        participants: 6,
        sfuConfigured: true,
        // A stale roster can lag the participant count by one update.
        capabilities: capable(5),
      }),
    ).toBe("mesh");
  });

  it("uses an explicit threshold when one is given", () => {
    expect(
      decideTransport({
        participants: 3,
        sfuConfigured: true,
        capabilities: capable(3),
        threshold: 2,
      }),
    ).toBe("sfu");
    expect(
      decideTransport({
        participants: 3,
        sfuConfigured: true,
        capabilities: capable(3),
        threshold: 4,
      }),
    ).toBe("mesh");
  });
});

describe("capabilitiesOf", () => {
  it("advertises the capability only for an explicit true flag", () => {
    expect(capabilitiesOf([{ sfuCall: true }, { sfuCall: false }, {}, { sfuCall: true }])).toEqual([
      ABLE,
      UNABLE,
      UNABLE,
      ABLE,
    ]);
  });
});
