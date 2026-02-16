import { defineConfig } from "vitest/config";

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
  },
});
