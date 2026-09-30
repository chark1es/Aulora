import { expect, test } from "bun:test";
import { mobileVersion, releasePlan } from "./release.mjs";

const baseline = {
  eventName: "push",
  ref: "refs/heads/main",
  version: "1.0.0",
  previousVersion: "0.1.0",
  alreadyReleased: false,
};

test("only a new main version starts an automatic release", () => {
  expect(releasePlan(baseline)).toEqual({ version: "1.0.0", build: true, publish: true });
  expect(releasePlan({ ...baseline, previousVersion: "1.0.0" }).build).toBe(false);
  expect(releasePlan({ ...baseline, alreadyReleased: true }).build).toBe(false);
  expect(() => releasePlan({ ...baseline, ref: "refs/heads/feature" })).toThrow("main");
  expect(() => releasePlan({ ...baseline, version: "v1.0.0" })).toThrow();
  expect(() => releasePlan({ ...baseline, previousVersion: "2.0.0" })).toThrow("increase");
  expect(releasePlan({ ...baseline, version: "1.10.0", previousVersion: "1.9.0" }).build).toBe(
    true,
  );
});

test("manual main builds are candidates unless publishing is requested", () => {
  expect(
    releasePlan({ ...baseline, eventName: "workflow_dispatch", alreadyReleased: true }),
  ).toEqual({ version: "1.0.0", build: true, publish: false });
  expect(releasePlan({ ...baseline, eventName: "workflow_dispatch", publish: true }).publish).toBe(
    true,
  );
  expect(() =>
    releasePlan({
      ...baseline,
      eventName: "workflow_dispatch",
      publish: true,
      alreadyReleased: true,
    }),
  ).toThrow("already published");
});

test("native mobile versions share a validated release version and build number", () => {
  expect(mobileVersion("1.2.3", "42")).toEqual({ version: "1.2.3", buildNumber: 42 });
  for (const number of ["0", "-1", "abc", "1.5", "2100000001"])
    expect(() => mobileVersion("1.2.3", number)).toThrow();
});
