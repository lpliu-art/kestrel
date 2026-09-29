import { createRequire } from "node:module";
import { defineConfig } from "tsup";

const require = createRequire(import.meta.url);

export default defineConfig({
  entry: { index: "src/cli/index.ts" },
  format: ["cjs"],
  platform: "node",
  target: "node22",
  outDir: "dist/sea",
  clean: false,
  splitting: false,
  treeshake: false,
  dts: false,
  sourcemap: false,
  shims: false,
  noExternal: [/.*/],
  esbuildOptions(options) {
    options.alias = {
      ...options.alias,
      "web-tree-sitter": require.resolve("web-tree-sitter"),
    };
    options.define = {
      ...options.define,
      "import.meta.url": "importMetaUrl",
    };
    options.inject = [
      ...(options.inject ?? []),
      "scripts/sea/import-meta-shim.mjs",
    ];
  },
});
