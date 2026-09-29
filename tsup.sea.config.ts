import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/cli/index.ts" },
  format: ["cjs"],
  platform: "node",
  target: "node22",
  outDir: "dist/sea",
  clean: false,
  splitting: false,
  dts: false,
  sourcemap: false,
  noExternal: [/.*/],
});
