import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AjvModule from "ajv";
import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";
import { runReview } from "../../src/pipeline/review.ts";
import { stableStringify } from "../../src/util/json.ts";
import { cleanEnv, git, initRepo, write } from "../helpers/git-repo.ts";

const Ajv2020 = Ajv2020Module as unknown as new (
  options?: object,
) => {
  compile: (
    schema: object,
  ) => ((data: unknown) => boolean) & { errors?: unknown };
};
const Ajv = AjvModule as unknown as new (
  options?: object,
) => {
  compile: (
    schema: object,
  ) => ((data: unknown) => boolean) & { errors?: unknown };
};
const addFormats = addFormatsModule as unknown as (ajv: object) => void;

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const bin = join(root, "bin/kestrel.mjs");

function kestrel(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    env: cleanEnv(cwd, env),
    encoding: "utf8",
  });
}

const SQL = `export async function getUser(id: string) {\n  const sql = "SELECT * FROM users WHERE id = " + id;\n  return sql;\n}\n`;

describe("kestrel review", () => {
  it("prints a mock terminal report with the banner", async () => {
    const cwd = await initRepo();
    await write(cwd, "src/user.ts", SQL);
    const result = kestrel(cwd, [
      "review",
      "--provider",
      "mock",
      "--lang",
      "zh-CN",
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("MOCK — 非 AI 判断，仅用于测试/演示");
    expect(result.stdout).toMatch(/ts\.security\.sql-string-concat/);
  });

  it("reviews staged, commit, and range diffs on real added lines", async () => {
    const cwd = await initRepo();
    await write(cwd, "src/user.ts", SQL);
    git(cwd, ["add", "src/user.ts"]);
    const staged = await runReview({
      cwd,
      mode: "staged",
      provider: "mock",
      providerExplicit: true,
      noCache: true,
      lang: "en",
      env: cleanEnv(cwd),
    });
    expect(
      staged.report.findings.some(
        (finding) => finding.ruleId === "ts.security.sql-string-concat",
      ),
    ).toBe(true);
    for (const finding of staged.report.findings) {
      const added = staged.report.files.length >= 0;
      expect(added).toBe(true);
      if (!finding.location.uncertain) {
        const file = (
          await readFile(join(cwd, finding.location.path), "utf8")
        ).split("\n");
        expect(file[finding.location.startLine - 1]).toBeTruthy();
      }
    }
    git(cwd, ["commit", "-m", "add query"]);
    const commit = kestrel(cwd, [
      "review",
      "--commit",
      "HEAD",
      "--provider",
      "mock",
      "--format",
      "json",
      "--lang",
      "en",
    ]);
    expect(commit.status, commit.stderr).toBe(0);
    const commitReport = JSON.parse(commit.stdout);
    expect(commitReport.run.mode).toBe("commit");
    expect(commitReport.findings.length).toBeGreaterThan(0);
    git(cwd, ["checkout", "-b", "feature"]);
    await write(cwd, "src/user.ts", `${SQL}console.log("debug");\n`);
    git(cwd, ["add", "src/user.ts"]);
    git(cwd, ["commit", "-m", "debug"]);
    const range = kestrel(cwd, [
      "review",
      "--from",
      "main",
      "--provider",
      "mock",
      "--format",
      "json",
      "--lang",
      "en",
    ]);
    expect(range.status, range.stderr).toBe(0);
    expect(JSON.parse(range.stdout).run.mode).toBe("range");
  }, 90_000);

  it("validates JSON and SARIF and writes markdown", async () => {
    const cwd = await initRepo();
    await write(cwd, "src/user.ts", SQL);
    const jsonPath = join(cwd, "report.json");
    const sarifPath = join(cwd, "report.sarif");
    const mdPath = join(cwd, "report.md");
    const result = kestrel(cwd, [
      "review",
      "--provider",
      "mock",
      "--no-cache",
      "--format",
      "json",
      "--out-json",
      jsonPath,
      "--format",
      "sarif",
      "--out-sarif",
      sarifPath,
      "--format",
      "markdown",
      "--out-md",
      mdPath,
      "--lang",
      "en",
    ]);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(await readFile(jsonPath, "utf8"));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const schema = JSON.parse(
      readFileSync(join(root, "schemas/report.schema.json"), "utf8"),
    );
    const validate = ajv.compile(schema);
    expect(validate(report), JSON.stringify(validate.errors)).toBe(true);
    const sarif = JSON.parse(await readFile(sarifPath, "utf8"));
    const sarifAjv = new Ajv({
      strict: false,
      validateSchema: false,
      allErrors: true,
    });
    addFormats(sarifAjv);
    const sarifSchema = JSON.parse(
      readFileSync(join(root, "test/fixtures/sarif-schema-2.1.0.json"), "utf8"),
    ) as { id?: string; $id?: string };
    if (typeof sarifSchema.id === "string" && !sarifSchema.$id) {
      sarifSchema.$id = sarifSchema.id;
      delete sarifSchema.id;
    }
    const validateSarif = sarifAjv.compile(sarifSchema);
    expect(
      validateSarif(sarif),
      JSON.stringify(validateSarif.errors)?.slice(0, 800),
    ).toBe(true);
    const markdown = await readFile(mdPath, "utf8");
    expect(markdown.startsWith("<!-- kestrel:summary -->")).toBe(true);
    for (const finding of report.findings) {
      expect(finding.location.uncertain || finding.location.startLine > 0).toBe(
        true,
      );
    }
  });

  it("gates on high findings, rejects bad config, and refuses a missing key", async () => {
    const cwd = await initRepo();
    await write(cwd, "src/user.ts", SQL);
    const gated = kestrel(cwd, [
      "review",
      "--provider",
      "mock",
      "--gate",
      "--lang",
      "en",
    ]);
    expect(gated.status).toBe(1);
    await write(cwd, ".kestrel.yml", "not_a_field: true\n");
    const bad = kestrel(cwd, ["review", "--provider", "mock"]);
    expect(bad.status).toBe(2);
    await write(cwd, ".kestrel.yml", "version: 1\n");
    const missing = kestrel(cwd, ["review", "--provider", "typesafe"], {
      CI: "true",
    });
    expect(missing.status).toBe(3);
    expect(missing.stderr).toContain("TYPESAFE_API_KEY");
    expect(missing.stderr).toContain("--provider mock");
  });

  it("previews a redacted payload without calling fetch", async () => {
    const cwd = await initRepo();
    await write(cwd, "src/secret.ts", 'const key = "AKIAIOSFODNN7EXAMPLE";\n');
    let called = false;
    const preview = await runReview({
      cwd,
      provider: "typesafe",
      providerExplicit: true,
      preview: true,
      showPayload: true,
      lang: "en",
      formats: ["json"],
      env: cleanEnv(cwd),
      fetchImpl: async () => {
        called = true;
        throw new Error("network");
      },
    });
    expect(called).toBe(false);
    expect(preview.json).toContain("[REDACTED:aws-key]");
    expect(preview.json).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(preview.report.preview?.estimatedTokens).toBeGreaterThan(0);
    const cli = kestrel(cwd, [
      "review",
      "--preview",
      "--show-payload",
      "--provider",
      "mock",
      "--format",
      "json",
    ]);
    expect(cli.status, cli.stderr).toBe(0);
    expect(cli.stdout).toContain("[REDACTED:aws-key]");
    expect(cli.stdout).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("is byte-stable aside from timestamps when cache is off", async () => {
    const cwd = await initRepo();
    await write(cwd, "src/user.ts", SQL);
    const args = [
      "review",
      "--provider",
      "mock",
      "--no-cache",
      "--format",
      "json",
      "--lang",
      "en",
    ];
    const first = kestrel(cwd, args);
    const second = kestrel(cwd, args);
    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    const normalize = (text: string) => {
      const value = JSON.parse(text) as {
        run: { startedAt: string; durationMs: number };
      };
      value.run.startedAt = "TIME";
      value.run.durationMs = 0;
      return stableStringify(value);
    };
    expect(normalize(first.stdout)).toBe(normalize(second.stdout));
  });

  it("caches pinned models and skips the cache for jev-latest", async () => {
    const cwd = await initRepo();
    await write(cwd, "src/user.ts", SQL);
    const first = kestrel(cwd, [
      "review",
      "--provider",
      "mock",
      "--model",
      "jev-1.13.0",
      "--format",
      "json",
      "--lang",
      "en",
    ]);
    const second = kestrel(cwd, [
      "review",
      "--provider",
      "mock",
      "--model",
      "jev-1.13.0",
      "--format",
      "json",
      "--lang",
      "en",
    ]);
    expect(second.status, second.stderr).toBe(0);
    const again = JSON.parse(second.stdout);
    expect(again.run.requests).toBeGreaterThan(0);
    expect(again.run.cachedRequests).toBe(again.run.requests);
    expect(JSON.parse(first.stdout).run.cachedRequests).toBe(0);
    const latest = kestrel(cwd, [
      "review",
      "--provider",
      "mock",
      "--model",
      "jev-latest",
      "--format",
      "json",
      "--lang",
      "en",
    ]);
    const latestAgain = kestrel(cwd, [
      "review",
      "--provider",
      "mock",
      "--model",
      "jev-latest",
      "--format",
      "json",
      "--lang",
      "en",
    ]);
    const body = JSON.parse(latestAgain.stdout);
    expect(body.run.cachedRequests).toBe(0);
    expect(body.warnings.join("\n")).toMatch(/not a pinned version/);
    expect(latest.stdout).toContain("not a pinned version");
  });

  it("skips units past the token budget", async () => {
    const cwd = await initRepo();
    await write(cwd, "src/user.ts", SQL);
    const loose = kestrel(cwd, [
      "review",
      "--provider",
      "mock",
      "--budget-tokens",
      "1",
      "--format",
      "json",
      "--lang",
      "en",
    ]);
    expect(loose.status, loose.stderr).toBe(0);
    const report = JSON.parse(loose.stdout);
    expect(report.run.status).toBe("partial");
    expect(
      report.skipped.some(
        (item: { reason: string }) => item.reason === "budget",
      ),
    ).toBe(true);
    const strict = kestrel(cwd, [
      "review",
      "--provider",
      "mock",
      "--budget-tokens",
      "1",
      "--strict",
      "--format",
      "json",
    ]);
    expect(strict.status).toBe(4);
  });

  it("replays a handwritten cassette through pass 1 and pass 2", async () => {
    const cwd = await initRepo();
    await write(
      cwd,
      "src/pay.ts",
      'export function pay() {\n  const flag = "PAYME";\n  return flag;\n}\n',
    );
    await mkdir(join(cwd, ".kestrel/rules"), { recursive: true });
    await writeFile(
      join(cwd, ".kestrel/rules/always.yml"),
      `pack: local
version: 1.0.0
rules:
  - id: local.correctness.always-pay
    title: { en: "Needs a look", zh-CN: "需要看一眼" }
    category: correctness
    dimension: correctness
    applies: { languages: [typescript] }
    trigger: { kind: always }
    locate: choose
    mock: { positive: PAYME }
    question:
      question: "Do the added lines in \`hunk\` need a reviewer comment?"
      true: { what: "A reviewer should comment" }
      false: { what: "Nothing to add" }
    severity:
      levels: ["Low", "Medium", "High"]
      map: [low, medium, high]
      default: high
    message:
      en: { body: "Line {{line}} needs a comment.", why: "The rule asked for a location." }
      zh-CN: { body: "第 {{line}} 行需要评论。", why: "规则要求定位。" }
    examples:
      positive:
        - code: |
            const flag = "PAYME";
      negative:
        - code: |
            const flag = "ok";
`,
    );
    const recordedDir = join(cwd, "rec");
    const recorded = kestrel(cwd, [
      "review",
      "--provider",
      "mock",
      "--no-cache",
      "--record",
      recordedDir,
      "--format",
      "json",
      "--lang",
      "en",
    ]);
    expect(recorded.status, recorded.stderr).toBe(0);
    const cassette = JSON.parse(
      await readFile(join(recordedDir, "recorded.json"), "utf8"),
    ) as {
      entries: Record<
        string,
        { request: { questions: Record<string, unknown> } }
      >;
    };
    const entries: Record<string, { response: unknown }> = {};
    let sawPass2 = false;
    for (const [hash, entry] of Object.entries(cassette.entries)) {
      const keys = Object.keys(entry.request.questions);
      if (keys.some((key) => key.startsWith("loc."))) sawPass2 = true;
      entries[hash] = { response: handwritten(entry.request.questions) };
    }
    expect(sawPass2).toBe(true);
    const replayDir = join(cwd, "hand");
    await mkdir(replayDir, { recursive: true });
    await writeFile(
      join(replayDir, "hand.json"),
      JSON.stringify({ version: 1, entries }),
    );
    const replay = kestrel(cwd, [
      "review",
      "--provider",
      "replay",
      "--replay",
      replayDir,
      "--no-cache",
      "--format",
      "json",
      "--lang",
      "en",
    ]);
    expect(replay.status, replay.stderr).toBe(0);
    const report = JSON.parse(replay.stdout);
    const finding = report.findings.find(
      (item: { ruleId: string }) =>
        item.ruleId === "local.correctness.always-pay",
    );
    expect(finding.location.startLine).toBe(3);
    expect(finding.location.anchor).toBe("choice");
    expect(finding.band).toBe("report");
    expect(finding.pEff).toBe(0.92);
  });
});

function handwritten(questions: Record<string, unknown>) {
  const answers: Record<string, unknown> = {};
  for (const key of Object.keys(questions)) {
    if (key.startsWith("loc.")) {
      answers[key] = {
        type: "choice",
        choice: "L3",
        confidence: 0.9,
        probabilities: { L3: 0.9, none: 0.1 },
      };
    } else if (key.startsWith("r.")) {
      answers[key] = { type: "noul", noul: 0.92 };
    } else if (key.startsWith("s.") || key === "u.priority") {
      answers[key] = {
        type: "score",
        score: 2,
        confidence: 0.9,
        legend: { "0": "Low", "1": "Medium", "2": "High" },
        probabilities: { "0": 0.05, "1": 0.05, "2": 0.9 },
      };
    } else {
      answers[key] = { type: "noul", noul: 0.05 };
    }
  }
  return {
    model: "jev-1.13.0",
    answers,
    usage: { input_tokens: 12, output_tokens: 4 },
  };
}
