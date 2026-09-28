import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: "./tests/setup.ts",
    maxWorkers: 2,
    testTimeout: 15_000
  }
});
