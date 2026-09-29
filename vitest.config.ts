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
        lines: 91,
        statements: 88,
        functions: 92,
        branches: 74,
        "src/rules/": {
          lines: 95,
        },
        "src/git/": {
          lines: 95,
        },
        "src/judge/": {
          lines: 99,
        },
      },
    },
  },
});
