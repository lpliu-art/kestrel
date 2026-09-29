import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "package.json"));
const outDir = join(root, "dist/sea");
mkdirSync(outDir, { recursive: true });

const bundle = spawnSync("npx", ["tsup", "--config", "tsup.sea.config.ts"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env },
});
if (bundle.status !== 0) process.exit(bundle.status ?? 1);

const grammars = [
  ["tree-sitter.wasm", require.resolve("web-tree-sitter/tree-sitter.wasm")],
  [
    "tree-sitter-typescript.wasm",
    require.resolve("tree-sitter-typescript/tree-sitter-typescript.wasm"),
  ],
  [
    "tree-sitter-tsx.wasm",
    require.resolve("tree-sitter-typescript/tree-sitter-tsx.wasm"),
  ],
  [
    "tree-sitter-javascript.wasm",
    require.resolve("tree-sitter-javascript/tree-sitter-javascript.wasm"),
  ],
  [
    "tree-sitter-python.wasm",
    require.resolve("tree-sitter-python/tree-sitter-python.wasm"),
  ],
  [
    "tree-sitter-java.wasm",
    require.resolve("tree-sitter-java/tree-sitter-java.wasm"),
  ],
  [
    "tree-sitter-go.wasm",
    require.resolve("tree-sitter-go/tree-sitter-go.wasm"),
  ],
  [
    "tree-sitter-rust.wasm",
    require.resolve("tree-sitter-rust/tree-sitter-rust.wasm"),
  ],
  [
    "tree-sitter-c_sharp.wasm",
    require.resolve("tree-sitter-c-sharp/tree-sitter-c_sharp.wasm"),
  ],
];
const assets = {};
for (const [name, path] of grammars) {
  const dest = join(outDir, name);
  copyFileSync(path, dest);
  assets[name] = dest;
}

const config = {
  main: join(outDir, "index.cjs"),
  output: join(outDir, "sea-prep.blob"),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  assets,
};
writeFileSync(join(outDir, "sea-config.json"), JSON.stringify(config, null, 2));

const sea = spawnSync(
  process.execPath,
  ["--experimental-sea-config", join(outDir, "sea-config.json")],
  {
    cwd: root,
    stdio: "inherit",
  },
);
if (sea.status !== 0) process.exit(sea.status ?? 1);

const binaryName = process.platform === "win32" ? "kestrel.exe" : "kestrel";
const binary = join(outDir, binaryName);
copyFileSync(process.execPath, binary);
const postject = spawnSync(
  "npx",
  [
    "--yes",
    "postject",
    binary,
    "NODE_SEA_BLOB",
    join(outDir, "sea-prep.blob"),
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
    ...(process.platform === "darwin"
      ? ["--macho-segment-name", "NODE_SEA"]
      : []),
  ],
  { cwd: root, stdio: "inherit" },
);
if (postject.status !== 0) process.exit(postject.status ?? 1);
if (process.platform !== "win32") chmodSync(binary, 0o755);
const payload = join(outDir, "payload");
mkdirSync(payload, { recursive: true });
copyFileSync(join(root, "package.json"), join(payload, "package.json"));
cpSync(
  join(root, "src", "plugins", "builtin"),
  join(payload, "src", "plugins", "builtin"),
  {
    recursive: true,
    filter: (source) => source.endsWith(".yml") || !source.includes("."),
  },
);

const version = spawnSync(binary, ["--version"], { encoding: "utf8" });
if (version.status !== 0) {
  process.stderr.write(
    version.stderr || version.stdout || "sea binary failed\n",
  );
  process.exit(version.status ?? 1);
}
process.stdout.write(`sea ${binary} ${version.stdout}`);
