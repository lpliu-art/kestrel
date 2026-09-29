import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runApply } from "../../scripts/apply-thresholds.ts";
import { runCalibrate } from "../../scripts/calibrate.ts";
import { verifyTag } from "../../scripts/release/verify-tag.ts";
import { renderCalibrationMarkdown } from "../../src/eval/markdown.ts";
import {
  caseCountExceeds,
  filterDataset,
  prefixesFor,
} from "../../src/eval/plugins.ts";
import { runEval } from "../../src/eval/run.ts";
import {
  MISSING_API_KEY_MESSAGE,
  needsApiKey,
  redactSecret,
} from "../../src/eval/secrets.ts";
import {
  applyThresholds,
  applyThresholdsToDir,
} from "../../src/eval/thresholds.ts";
import {
  changelogSection,
  tagMatchesPackageVersion,
} from "../../src/release/notes.ts";
import { cleanEnv } from "../helpers/git-repo.ts";

const PY_SOURCE =
  'def get_user(user_id):\n    cursor.execute(f"SELECT * FROM t WHERE id={user_id}")\n';

const stdoutWrite = process.stdout.write.bind(process.stdout);
const stderrWrite = process.stderr.write.bind(process.stderr);

afterEach(() => {
  process.stdout.write = stdoutWrite;
  process.stderr.write = stderrWrite;
});

describe("release notes", () => {
  it("matches a v tag to package.json and extracts one changelog section", () => {
    expect(tagMatchesPackageVersion("v0.4.3", "0.4.3")).toBe(true);
    expect(tagMatchesPackageVersion("refs/tags/v0.4.3", "0.4.3")).toBe(true);
    expect(tagMatchesPackageVersion("v0.4.4", "0.4.3")).toBe(false);
    expect(verifyTag(undefined, "0.4.3")).toMatch(/Pass the git tag/);
    expect(verifyTag("v0.4.4", "0.4.3")).toMatch(/does not match/);
    expect(verifyTag("v0.4.3", "0.4.3")).toBe("");
    const notes = changelogSection(
      "# Changelog\n\n## 0.4.3\n\nAuth and docs.\n\n## 0.4.2\n\nEmbedded rules.\n",
      "0.4.3",
    );
    expect(notes).toBe("## 0.4.3\n\nAuth and docs.\n");
    expect(notes).not.toMatch(/0\.4\.2/);
    expect(() => changelogSection("# Changelog\n", "9.9.9")).toThrow(
      /no section/,
    );
  });
});

describe("calibration helpers", () => {
  it("filters plugin cases and redacts a key without printing it", () => {
    expect(prefixesFor("typescript")).toEqual(["ts.", "react.", "vue."]);
    expect(() => prefixesFor("nope")).toThrow(/Unknown plugin filter nope/);
    const filtered = filterDataset(
      {
        name: "mix",
        cases: [
          {
            id: "py",
            labels: [{ ruleId: "py.security.sql-format" }],
          },
          {
            id: "ts",
            labels: [{ ruleId: "ts.security.dynamic-code" }],
          },
        ],
      },
      "python",
    );
    expect(filtered.cases.map((item) => item.id)).toEqual(["py"]);
    expect(caseCountExceeds(2, 1)).toBe(true);
    expect(caseCountExceeds(1, 1)).toBe(false);
    expect(caseCountExceeds(1, undefined)).toBe(false);
    expect(needsApiKey("typesafe")).toBe(true);
    expect(needsApiKey("mock")).toBe(false);
    const secret = "sk-live-do-not-print";
    expect(redactSecret(`token ${secret} end`, secret)).toBe(
      "token [redacted] end",
    );
    expect(redactSecret("plain", undefined)).toBe("plain");
    expect(MISSING_API_KEY_MESSAGE).not.toMatch(/sk-/);
  });

  it("inserts and replaces thresholds without touching other rules", () => {
    const inserted = applyThresholds(
      "rules:\n  - id: py.security.sql-format\n    message:\n      en:\n        body: sql\n",
      { prefixes: ["py."], report: 0.8, uncertain: 0.6 },
    );
    expect(inserted.ids).toEqual(["py.security.sql-format"]);
    expect(inserted.yaml).toMatch(/report: 0\.8\n {6}uncertain: 0\.6/);
    expect(inserted.yaml).toMatch(/message:/);
    const replaced = applyThresholds(
      "  - id: py.security.sql-format\n    thresholds:\n      report: 0.1\n      uncertain: 0.1\n    message:\n      en:\n        body: sql\n  - id: ts.security.dynamic-code\n    message:\n      en:\n        body: eval\n",
      { prefixes: ["py."], report: 0.75, uncertain: 0.55 },
    );
    expect(replaced.ids).toEqual(["py.security.sql-format"]);
    expect(replaced.yaml).toMatch(/report: 0\.75/);
    expect(replaced.yaml).toMatch(/ts\.security\.dynamic-code/);
    expect(replaced.yaml).not.toMatch(/report: 0\.1/);
    const appended = applyThresholds("  - id: py.security.sql-format\n", {
      prefixes: ["py."],
      report: 0.7,
      uncertain: 0.5,
    });
    expect(appended.yaml).toMatch(/thresholds:/);
    const filled = applyThresholds(
      "  - id: py.security.sql-format\n    thresholds:\n      other: 1\n",
      { prefixes: ["py."], report: 0.66, uncertain: 0.44 },
    );
    expect(filled.yaml).toMatch(/report: 0\.66/);
    expect(filled.yaml).toMatch(/uncertain: 0\.44/);
  });

  it("writes the same balanced threshold into every builtin pack in a directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kestrel-yaml-"));
    const nested = join(dir, "python");
    await writeFile(
      join(dir, "core.yml"),
      "rules:\n  - id: core.security.eval-call\n    message:\n      en:\n        body: eval\n",
    );
    await mkdir(nested);
    await writeFile(
      join(nested, "core.yml"),
      "rules:\n  - id: py.security.sql-format\n    message:\n      en:\n        body: sql\n",
    );
    const ids = applyThresholdsToDir(dir, { report: 0.81, uncertain: 0.61 });
    expect(ids.sort()).toEqual([
      "core.security.eval-call",
      "py.security.sql-format",
    ]);
    const text = await readFile(join(nested, "core.yml"), "utf8");
    expect(text).toMatch(/report: 0\.81/);
  });
});

describe("eval guards", () => {
  it("scores one plugin and stops at max-requests", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kestrel-cal-"));
    const dataset = join(dir, "dataset.json");
    await writeFile(
      dataset,
      JSON.stringify({
        name: "tiny-py",
        kind: "internal",
        notes: [],
        cases: [
          {
            id: "py",
            path: "app/query.py",
            source: PY_SOURCE,
            labels: [{ ruleId: "py.security.sql-format", positive: true }],
          },
        ],
      }),
    );
    const env = cleanEnv(dir, { KESTREL_LLM_API_KEY: "" });
    const report = await runEval({
      datasetPath: dataset,
      provider: "mock",
      env,
      calibrate: true,
      plugin: "python",
      budgetTokens: 2_000_000,
      maxRequests: 20,
    });
    expect(report.byPlugin.py?.tp).toBe(1);
    expect(report.byPlugin.ts).toBeUndefined();
    const markdown = renderCalibrationMarkdown(report);
    expect(markdown).toMatch(/Mock calibration/);
    expect(markdown).toMatch(/py\.security\.sql-format/);
    expect(markdown).toMatch(/balanced/);
    await expect(
      runEval({
        datasetPath: dataset,
        provider: "mock",
        env,
        maxRequests: 0,
      }),
    ).rejects.toThrow(/max-requests 0 reached/);
    await expect(
      runEval({
        datasetPath: dataset,
        provider: "mock",
        env,
        plugin: "go",
      }),
    ).rejects.toThrow(/No dataset cases match plugin go/);
  }, 90_000);
});

describe("calibrate script", () => {
  it("fails fast when the live key is missing and when the case cap is too small", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kestrel-script-"));
    const dataset = join(dir, "dataset.json");
    await writeFile(
      dataset,
      JSON.stringify({
        name: "two",
        cases: [
          { id: "a", labels: [{ ruleId: "py.security.sql-format" }] },
          { id: "b", labels: [{ ruleId: "py.security.sql-format" }] },
        ],
      }),
    );
    const env = { ...process.env };
    delete env.TYPESAFE_API_KEY;
    const missing = capture(() =>
      runCalibrate(["--dataset", dataset, "--provider", "typesafe"], env),
    );
    expect(missing.code).toBe(1);
    expect(missing.err).toBe(`${MISSING_API_KEY_MESSAGE}\n`);
    expect(missing.err).not.toMatch(/sk-/);
    const capped = capture(() =>
      runCalibrate(
        ["--dataset", dataset, "--provider", "mock", "--max-requests", "1"],
        env,
      ),
    );
    expect(capped.code).toBe(2);
    expect(capped.err).toMatch(/exceed max-requests 1/);
  });

  it("writes a mock report and refuses to edit rule packs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kestrel-mock-cal-"));
    const dataset = join(dir, "dataset.json");
    const out = join(dir, "out");
    await writeFile(
      dataset,
      JSON.stringify({
        name: "tiny-py",
        kind: "internal",
        notes: ["local mock"],
        cases: [
          {
            id: "py",
            path: "app/query.py",
            source: PY_SOURCE,
            labels: [{ ruleId: "py.security.sql-format", positive: true }],
          },
        ],
      }),
    );
    const env = cleanEnv(dir, { KESTREL_LLM_API_KEY: "" });
    delete env.TYPESAFE_API_KEY;
    const result = capture(() =>
      runCalibrate(
        [
          "--dataset",
          dataset,
          "--provider",
          "mock",
          "--plugin",
          "python",
          "--max-requests",
          "20",
          "--budget-tokens",
          "2000000",
          "--out-dir",
          out,
          "--apply-thresholds",
        ],
        env,
      ),
    );
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/not from live Jev/);
    const markdown = await readFile(join(out, "calibration.md"), "utf8");
    expect(markdown).toMatch(/Mock calibration/);
    expect(markdown).toMatch(/precision/);
    const rules = await mkdtemp(join(tmpdir(), "kestrel-rules-"));
    await writeFile(
      join(rules, "core.yml"),
      "rules:\n  - id: py.security.sql-format\n    message:\n      en:\n        body: sql\n",
    );
    const report = JSON.parse(
      await readFile(join(out, "calibration.json"), "utf8"),
    ) as { realModel: boolean; proposals: { balanced: unknown } };
    report.realModel = true;
    const reportPath = join(dir, "live.json");
    await writeFile(reportPath, JSON.stringify(report));
    const applied = capture(() =>
      runApply([
        "--report",
        reportPath,
        "--rules-dir",
        rules,
        "--plugin",
        "python",
      ]),
    );
    expect(applied.code).toBe(0);
    expect(applied.out).toMatch(/updated 1 rules/);
    const yaml = await readFile(join(rules, "core.yml"), "utf8");
    expect(yaml).toMatch(/thresholds:/);
    const refused = capture(() =>
      runApply([
        "--report",
        join(out, "calibration.json"),
        "--rules-dir",
        rules,
      ]),
    );
    expect(refused.code).toBe(2);
    expect(refused.err).toMatch(/not from live Jev/);
  }, 90_000);
});

function capture(fn: () => number): { code: number; out: string; err: string } {
  let out = "";
  let err = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    err += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    const code = fn();
    return { code, out, err };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}
