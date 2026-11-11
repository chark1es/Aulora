import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setupEnv.ts"],
    // The suite runs ~1,000 tests across one worker per file; the heavier setup and transcription
    // cases exceed vitest's 5s default on shared CI runners even though they take under 1s locally.
    testTimeout: 20_000,
  },
});
