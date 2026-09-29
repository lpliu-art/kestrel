import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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
writeFileSync(binary, readFileSync(built));
if (process.platform !== "win32") {
  spawnSync("chmod", ["755", binary], { stdio: "inherit" });
}
const alone = readdirSync(standalone);
if (alone.length !== 1 || alone[0] !== binaryName) {
  fail(`isolated directory is not a single file: ${alone.join(", ")}`);
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
const packageVersion = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
).version;

const version = run(binary, ["--version"], standalone);
if (version.stdout.trim() !== packageVersion) {
  fail(`version ${version.stdout.trim()} != package ${packageVersion}`);
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

const packageRules = run(
  process.execPath,
  [join(root, "bin", "kestrel.mjs"), "rules", "list"],
  root,
);
const binaryRules = run(binary, ["rules", "list"], standalone);
const packageIds = lines(packageRules.stdout);
const binaryIds = lines(binaryRules.stdout);
if (packageIds.length === 0 || packageIds.join("\n") !== binaryIds.join("\n")) {
  fail(
    `builtin rule list mismatch package=${packageIds.length} binary=${binaryIds.length}`,
  );
}
process.stdout.write(`builtin rules ${binaryIds.length}\n`);

const repo = mkdtempSync(join(tmpdir(), "kestrel-sea-repo-"));
git(repo, ["init", "-b", "main"]);
git(repo, ["config", "user.email", "kestrel@example.com"]);
git(repo, ["config", "user.name", "Kestrel"]);
writeFileSync(join(repo, ".gitignore"), ".kestrel/\n");
writeFileSync(
  join(repo, ".kestrel.yml"),
  "version: 1\nchecks:\n  - id: team.sea.marker\n    ask: Added lines must keep the team marker\n    severity: low\n",
);
writeFileSync(join(repo, "README.md"), "base\n");
git(repo, ["add", ".gitignore", ".kestrel.yml", "README.md"]);
git(repo, ["commit", "-m", "init"]);
mkdirSync(join(repo, "src"));
writeFileSync(
  join(repo, "src", "user.ts"),
  "export function loadUser(id: string) {\n  return eval(id);\n}\n",
);
writeFileSync(
  join(repo, "src", "user.py"),
  'def load_user(user_id):\n    cursor.execute(f"SELECT * FROM t WHERE id={user_id}")\n',
);

const custom = run(binary, ["rules", "list"], repo);
if (!custom.stdout.includes("team.sea.marker")) {
  fail("custom check from .kestrel.yml was not listed");
}
if (!custom.stdout.includes("ts.security.dynamic-code")) {
  fail("builtin rules were hidden by the project config");
}

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
  fail("review JSON did not include a syntax-level function_declaration unit");
}
for (const ruleId of ["core.security.eval-call", "py.security.sql-format"]) {
  if (!review.stdout.includes(`"ruleId": "${ruleId}"`)) {
    fail(`review did not fire builtin rule ${ruleId}`);
  }
}
if (!review.stdout.includes("team.sea.marker")) {
  fail("review did not pick up the custom .kestrel.yml check");
}

const sessions = join(repo, "sessions");
mkdirSync(sessions);
writeFileSync(
  join(sessions, "one.jsonl"),
  '{"type":"review","unitId":"u-sea","path":"src/user.ts"}\n',
);
const view = run(
  binary,
  ["view", "--sessions", sessions, "--out", join(repo, "view.html")],
  repo,
);
if (!view.stdout.includes("wrote "))
  fail(`view did not write HTML:\n${view.stdout}`);
const html = readFileSync(join(repo, "view.html"), "utf8");
if (
  !html.includes("<!DOCTYPE html") ||
  !html.includes("Kestrel session viewer")
) {
  fail("viewer HTML is missing the embedded page");
}
if (!html.includes("u-sea"))
  fail("viewer HTML did not include the session event");
process.stdout.write("sea smoke ok\n");

function lines(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

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
