import { defineConfig } from "vitest/config";
import { assertionCoverageReporter } from "./packages/core/src/testing/assertion-coverage-reporter.js";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/__tests__/**/*.test.ts",
      "apps/*/__tests__/**/*.test.ts",
      "../openstarry_plugin/*/src/**/*.test.ts",
      "../openstarry_plugin/*/__tests__/**/*.test.ts",
    ],
    environment: "node",
    globals: false,
    testTimeout: 10000,
    reporters: ["default", assertionCoverageReporter],
  },
});
