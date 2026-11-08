import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useQuery } = vi.hoisted(() => ({ useQuery: vi.fn() }));
vi.mock("convex/react", () => ({ useQuery }));

import { useFeatureFlag } from "../lib/use-feature-flag";

beforeEach(() => {
  useQuery.mockReset();
});

describe("useFeatureFlag", () => {
  it("keeps a feature available until the config loads", () => {
    useQuery.mockReturnValue(undefined);
    expect(renderHook(() => useFeatureFlag("disablePipVideo")).result.current).toBe(false);
  });

  it("returns the server-advertised kill switch", () => {
    useQuery.mockReturnValue({ features: { disablePipVideo: true } });
    expect(renderHook(() => useFeatureFlag("disablePipVideo")).result.current).toBe(true);
  });

  it("defaults missing or malformed flags to enabled", () => {
    useQuery.mockReturnValue({ features: { disablePipVideo: "yes" } });
    expect(renderHook(() => useFeatureFlag("disablePipVideo")).result.current).toBe(false);
    useQuery.mockReturnValue({});
    expect(renderHook(() => useFeatureFlag("disableNewCallTransport")).result.current).toBe(false);
  });
});
