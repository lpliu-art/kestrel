import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const binaryName = process.platform === "win32" ? "kestrel.exe" : "kestrel";
const built = join(root, "dist", "sea", binaryName);
const languages = [
  "typescript",
  "tsx",
  "javascript",
  "python",
  "java",
  "go",
  "rust",
  "csharp",
];

const standalone = mkdtempSync(join(tmpdir(), "kestrel-sea-"));
const binary = join(standalone, binaryName);
cpSync(built, binary);
cpSync(join(root, "dist", "sea", "payload"), join(standalone, "payload"), {
  recursive: true,
});
if (process.platform !== "win32") {
  spawnSync("chmod", ["755", binary], { stdio: "inherit" });
}

const isolated = createRequire(binary);
try {
  isolated.resolve("web-tree-sitter");
  fail(
    "the standalone directory can resolve web-tree-sitter; it is not isolated from node_modules",
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("Cannot find module")) throw error;
}

const env = { ...process.env, TYPESAFE_API_KEY: "", KESTREL_PROVIDER: "" };

const version = run(binary, ["--version"], tmpdir());
if (!/^\d+\.\d+\.\d+/.test(version.stdout.trim())) {
  fail(`unexpected version output:\n${version.stdout}`);
}

const doctor = run(binary, ["doctor"], standalone);
process.stdout.write(doctor.stdout);
if (doctor.stderr.trim()) process.stderr.write(doctor.stderr);
for (const language of languages) {
  const line = `parser: tree-sitter (${language})`;
  if (!doctor.stdout.includes(line)) fail(`doctor did not report ${line}`);
}
if (doctor.stdout.includes("regex-fallback")) {
  fail("doctor reported regex-fallback");
}

const repo = mkdtempSync(join(tmpdir(), "kestrel-sea-repo-"));
git(repo, ["init", "-b", "main"]);
git(repo, ["config", "user.email", "kestrel@example.com"]);
git(repo, ["config", "user.name", "Kestrel"]);
writeFileSync(join(repo, ".gitignore"), ".kestrel/\n");
writeFileSync(join(repo, "README.md"), "base\n");
git(repo, ["add", ".gitignore", "README.md"]);
git(repo, ["commit", "-m", "init"]);
mkdirSync(join(repo, "src"));
writeFileSync(
  join(repo, "src", "user.ts"),
  "export function loadUser(id: string) {\n  return eval(id);\n}\n",
);

const review = run(
  binary,
  ["review", "--provider", "mock", "--format", "json", "--show-payload"],
  repo,
);
if (review.stderr.includes("regex triggers")) {
  fail(`review fell back to regex triggers:\n${review.stderr}`);
}
if (review.stderr.includes("failed to initialize")) {
  fail(`tree-sitter failed to initialize:\n${review.stderr}`);
}
if (!review.stdout.includes('"kind": "function_declaration"')) {
  fail(
    `review JSON did not include a syntax-level function_declaration unit:\n${review.stdout.slice(0, 2000)}`,
  );
}
process.stdout.write("sea smoke ok\n");

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8" });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) {
    fail(
      `${command} ${args.join(" ")} exited ${result.status}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    fail(`git ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
