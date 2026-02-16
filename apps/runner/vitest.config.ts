import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/__tests__/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@openstarry/sdk": resolve(__dirname, "../../packages/sdk/src"),
      "@openstarry/core": resolve(__dirname, "../../packages/core/src"),
      "@openstarry/shared": resolve(__dirname, "../../packages/shared/src"),
    },
  },
});
