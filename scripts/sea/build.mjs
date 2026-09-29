import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "package.json"));
const outDir = join(root, "dist/sea");
mkdirSync(outDir, { recursive: true });

function run(command, args, extra = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env },
    // npx is npx.cmd on Windows and does not spawn without a shell.
    shell: process.platform === "win32" && command === "npx",
    ...extra,
  });
  if (result.error) {
    process.stderr.write(`${command} failed: ${result.error.message}\n`);
  }
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(String(result.stderr));
    if (result.stdout) process.stderr.write(String(result.stdout));
    process.exit(result.status ?? 1);
  }
  return result;
}

run("npx", ["tsup", "--config", "tsup.sea.config.ts"]);

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
let wasmBytes = 0;
for (const [name, path] of grammars) {
  const dest = join(outDir, name);
  copyFileSync(path, dest);
  assets[name] = dest;
  wasmBytes += statSync(path).size;
}
let ruleBytes = 0;
const addRules = (dir, keyPrefix) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const key = `${keyPrefix}/${entry.name}`;
    if (entry.isDirectory()) addRules(abs, key);
    else if (entry.name.endsWith(".yml")) {
      assets[key] = abs;
      ruleBytes += statSync(abs).size;
    }
  }
};
addRules(join(root, "src", "plugins", "builtin"), "builtin");
const packageJson = join(root, "package.json");
assets["package.json"] = packageJson;
ruleBytes += statSync(packageJson).size;

const config = {
  main: join(outDir, "index.cjs"),
  output: join(outDir, "sea-prep.blob"),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  assets,
};
writeFileSync(join(outDir, "sea-config.json"), JSON.stringify(config, null, 2));

run(process.execPath, [
  "--experimental-sea-config",
  join(outDir, "sea-config.json"),
]);

const binaryName = process.platform === "win32" ? "kestrel.exe" : "kestrel";
const binary = join(outDir, binaryName);
copyFileSync(process.execPath, binary);
// macOS arm64 kills binaries whose signature no longer matches, so drop
// node's signature before injecting and ad-hoc sign the result afterwards.
if (process.platform === "darwin") {
  run("codesign", ["--remove-signature", binary]);
}
run("npx", [
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
]);
if (process.platform !== "win32") chmodSync(binary, 0o755);
if (process.platform === "darwin") {
  run("codesign", ["--sign", "-", "--force", binary]);
  run("codesign", ["--verify", "--strict", binary]);
}
rmSync(join(outDir, "payload"), { recursive: true, force: true });

const version = run(binary, ["--version"], { stdio: "pipe", encoding: "utf8" });
process.stdout.write(
  `sea ${binary} ${version.stdout.trim()} binary=${statSync(binary).size} wasm=${wasmBytes} rules=${ruleBytes}\n`,
);
