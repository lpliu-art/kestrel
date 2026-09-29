import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text"],
      include: ["src/**/*.ts"],
      thresholds: {
        lines: 65,
        statements: 60,
        functions: 70,
        branches: 45,
        "src/judge/": {
          lines: 90,
        },
      },
    },
  },
});
