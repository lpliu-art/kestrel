import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaults.ts";
import { loadConfig } from "../../src/config/load.ts";
import { runDoctor } from "../../src/doctor/run.ts";
import { explainFinding } from "../../src/explain/run.ts";
import type { ChangedFile } from "../../src/git/unified-diff.ts";
import {
  addedLinesInPatch,
  chooseEvent,
  downgradeEvent,
  planPost,
  postGitHubReview,
} from "../../src/github/post.ts";
import { compareBands } from "../../src/jev/drift.ts";
import { runReview } from "../../src/pipeline/review.ts";
import { loadPlugins } from "../../src/plugins/loader.ts";
import { compileChecks } from "../../src/rules/checks.ts";
import { compileRuleQuestions } from "../../src/rules/compile.ts";
import { lintRules } from "../../src/rules/lint.ts";
import { loadRules } from "../../src/rules/load.ts";
import { testRules } from "../../src/rules/test-runner.ts";
import { parseSarif } from "../../src/static/sarif-filter.ts";
import {
  enclosingIdentity,
  readEnclosing,
} from "../../src/treesitter/context.ts";
import {
  clearGrammarFailureForTests,
  ensureTreesitter,
  forceGrammarFailureForTests,
} from "../../src/treesitter/runtime.ts";
import { buildUnits } from "../../src/units/build.ts";
import { cleanEnv, initRepo, write } from "../helpers/git-repo.ts";

afterEach(() => {
  clearGrammarFailureForTests();
});

describe("tree-sitter context", () => {
  it("names the enclosing function on fixture lines", async () => {
    await ensureTreesitter();
    const cases: Array<{
      language: string;
      source: string;
      line: number;
      kind: string;
      name?: string;
    }> = [
      {
        language: "typescript",
        source: "export function outer(a: number) {\n  return a;\n}\n",
        line: 2,
        kind: "function_declaration",
        name: "outer",
      },
      {
        language: "typescript",
        source: "const inner = () => {\n  return 1;\n};\n",
        line: 2,
        kind: "arrow_function",
        name: "inner",
      },
      {
        language: "typescript",
        source: "class Box {\n  method(x: number) { return x; }\n}\n",
        line: 2,
        kind: "method_definition",
        name: "method",
      },
      {
        language: "tsx",
        source: "export function Foo() {\n  return <div />;\n}\n",
        line: 2,
        kind: "function_declaration",
        name: "Foo",
      },
      {
        language: "javascript",
        source: "function outer(a) {\n  debugger;\n}\n",
        line: 2,
        kind: "function_declaration",
        name: "outer",
      },
      {
        language: "javascript",
        source: "const inner = () => {\n  return 1;\n};\n",
        line: 2,
        kind: "arrow_function",
        name: "inner",
      },
      {
        language: "python",
        source: "def outer(a):\n    return a\n",
        line: 2,
        kind: "function_definition",
        name: "outer",
      },
      {
        language: "python",
        source: "def outer(a):\n    def inner():\n        return a\n",
        line: 3,
        kind: "function_definition",
        name: "inner",
      },
      {
        language: "python",
        source: "class Box:\n    def method(self, x):\n        return x\n",
        line: 3,
        kind: "function_definition",
        name: "method",
      },
      {
        language: "java",
        source: "class Box {\n  int method(int x) { return x; }\n}\n",
        line: 2,
        kind: "method_declaration",
        name: "method",
      },
      {
        language: "java",
        source: "class Box {\n  Box() { }\n}\n",
        line: 2,
        kind: "constructor_declaration",
        name: "Box",
      },
      {
        language: "go",
        source: "package main\nfunc outer(a int) int {\n  return a\n}\n",
        line: 3,
        kind: "function_declaration",
        name: "outer",
      },
      {
        language: "go",
        source: "package main\nfunc (b *Box) method(x int) int { return x }\n",
        line: 2,
        kind: "method_declaration",
        name: "method",
      },
      {
        language: "go",
        source:
          "package main\nfunc outer(a int) int {\n  f := func() int { return a }\n  return f()\n}\n",
        line: 3,
        kind: "func_literal",
      },
      {
        language: "typescript",
        source:
          "export function outer() {\n  class Box {\n    method() { return 1; }\n  }\n}\n",
        line: 3,
        kind: "method_definition",
        name: "method",
      },
      {
        language: "python",
        source: "class Box:\n    x = 1\n",
        line: 2,
        kind: "class_definition",
        name: "Box",
      },
      {
        language: "java",
        source: "class Box {\n  int x;\n}\n",
        line: 2,
        kind: "class_declaration",
        name: "Box",
      },
      {
        language: "javascript",
        source: "class Box {\n  method() { return 1; }\n}\n",
        line: 2,
        kind: "method_definition",
        name: "method",
      },
      {
        language: "tsx",
        source: "const View = () => {\n  return <span />;\n};\n",
        line: 2,
        kind: "arrow_function",
        name: "View",
      },
      {
        language: "typescript",
        source:
          "function nested() {\n  function inner() {\n    return 1;\n  }\n}\n",
        line: 3,
        kind: "function_declaration",
        name: "inner",
      },
    ];
    let correct = 0;
    for (const item of cases) {
      const found = readEnclosing(item.source, item.language, item.line);
      const kindOk = found?.kind === item.kind;
      const nameOk = item.name === undefined || found?.name === item.name;
      if (kindOk && nameOk) correct += 1;
    }
    expect(correct / cases.length).toBeGreaterThanOrEqual(0.95);
  });

  it("falls back when grammars fail to load", async () => {
    forceGrammarFailureForTests("spike");
    await ensureTreesitter();
    expect(
      readEnclosing("def outer():\n    return 1\n", "python", 2),
    ).toBeUndefined();
    const key = enclosingIdentity("def outer():\n    return 1\n", "python", 2);
    expect(key).toContain("heuristic:");
    expect(key).toContain("outer");
  });

  it("merges hunks only inside the same enclosing function", async () => {
    await ensureTreesitter();
    const split = sourceFile(
      "function a() {\n  return 1;\n}\nfunction b() {\n  return 2;\n}\n",
      [2, 5],
    );
    const units = buildUnits(
      split.file,
      split.lines,
      "javascript",
      "typescript",
      {
        maxAddedLinesPerUnit: 120,
      },
      {
        enclosingAt: (line) =>
          enclosingIdentity(split.text, "javascript", line),
      },
    );
    expect(units).toHaveLength(2);
    const same = sourceFile(
      "function a() {\n  return 1;\n  return 2;\n}\n",
      [2, 3],
    );
    const merged = buildUnits(
      same.file,
      same.lines,
      "javascript",
      "typescript",
      {
        maxAddedLinesPerUnit: 120,
      },
      {
        enclosingAt: (line) => enclosingIdentity(same.text, "javascript", line),
      },
    );
    expect(merged).toHaveLength(1);
  });
});

describe("checks, explain, doctor, drift", () => {
  it("compiles a team check into a Noul question", async () => {
    const config = defaultConfig();
    config.checks = [
      {
        id: "team.api.validate-body",
        paths: ["src/api/**"],
        ask: "Request handlers must validate the body before use",
        expect: true,
        severity: "high",
        examples: {
          positive: [{ code: "db.insert(req.body)\n" }],
          negative: [{ code: "const body = schema.parse(req.body)\n" }],
        },
      },
    ];
    const rule = compileChecks(config, config.warnings)[0];
    if (!rule) throw new Error("check was not compiled");
    expect(rule.question.question).toBe(
      "Does `hunk` violate this team rule: Request handlers must validate the body before use?",
    );
    const questions = compileRuleQuestions(rule);
    expect(questions["r.team.api.validate-body"]?.type).toBe("noul");
    expect(lintRules([rule])).toEqual([]);
    const tested = await testRules([rule], "en");
    expect(tested.failed).toEqual([]);
  });

  it("explains a mock finding with probabilities", async () => {
    const cwd = await initRepo();
    await write(
      cwd,
      "src/user.ts",
      'export function load(id: string) {\n  return db.query("SELECT " + id);\n}\n',
    );
    const result = await runReview({
      cwd,
      provider: "mock",
      providerExplicit: true,
      env: cleanEnv(cwd),
      tty: false,
      ci: true,
    });
    const finding = result.report.findings.find(
      (item) => item.band === "report",
    );
    if (!finding) throw new Error("expected a report finding");
    const text = explainFinding(result.report, finding.id);
    expect(text).toContain(`rule ${finding.ruleId}`);
    expect(text).toContain("noul=");
    expect(text).toContain("model mock-1");
    expect(text).toContain("Do the added lines");
  });

  it("doctor reports git, node, a missing key, and a reachable model", async () => {
    const cwd = await initRepo();
    const config = loadConfig({ cwd, env: cleanEnv(cwd) });
    const missing = await runDoctor({ cwd, config, env: cleanEnv(cwd) });
    expect(missing.exitCode).toBe(0);
    expect(missing.text).toContain("TYPESAFE_API_KEY is missing");
    expect(missing.text).toContain("skipped");
    const present = await runDoctor({
      cwd,
      config,
      env: cleanEnv(cwd, { TYPESAFE_API_KEY: "test-key" }),
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });
    expect(present.exitCode).toBe(0);
    expect(present.text).toContain("reachable");
  });

  it("flags band drift above 5 percent", () => {
    const before = Array.from({ length: 20 }, (_, index) => ({
      ruleId: `rule-${index}`,
      model: "jev-1.13.0",
      band: "report" as const,
      probability: 0.9,
    }));
    const one = before.map((sample, index) =>
      index === 0 ? { ...sample, band: "drop" as const } : sample,
    );
    expect(compareBands(before, one).ok).toBe(true);
    const two = before.map((sample, index) =>
      index < 2 ? { ...sample, band: "drop" as const } : sample,
    );
    expect(compareBands(before, two).ok).toBe(false);
    expect(
      compareBands(
        before,
        before.map((sample) => ({ ...sample, model: "jev-1.14.0" })),
      ).reason,
    ).toBe("model versions differ");
  });
});

describe("SARIF filter and GitHub post", () => {
  it("keeps real alerts and drops false positives", async () => {
    const cwd = await initRepo();
    await mkdir(join(cwd, "reports"), { recursive: true });
    for (const name of ["eslint", "ruff", "golangci", "semgrep"]) {
      await writeFile(
        join(cwd, "reports", `${name}.sarif.json`),
        readFileSync(
          join(process.cwd(), "test/fixtures/sarif", `${name}.sarif.json`),
        ),
      );
    }
    await write(
      cwd,
      "src/app.ts",
      "export function run(input: string) {\n  return eval(input);\n  return 1;\n  return input;\n}\n",
    );
    const result = await runReview({
      cwd,
      provider: "mock",
      providerExplicit: true,
      env: cleanEnv(cwd),
      tty: false,
      ci: true,
      sarifIn: ["reports/*.sarif.json"],
      lang: "en",
    });
    const summary = result.report.static;
    expect(summary?.imported).toBe(4);
    expect(summary?.kept).toBeGreaterThan(0);
    expect(summary?.dropped).toBeGreaterThan(0);
    expect(summary?.alerts.every((alert) => alert.probability >= 0)).toBe(true);
    expect(summary?.alerts.some((alert) => alert.decision === "keep")).toBe(
      true,
    );
    expect(summary?.alerts.some((alert) => alert.decision === "drop")).toBe(
      true,
    );
    expect(result.terminal).toContain("Static alerts");
  });

  it("parses sample SARIF tools", () => {
    for (const name of ["eslint", "ruff", "golangci", "semgrep"]) {
      const alerts = parseSarif(
        readFileSync(
          join(process.cwd(), "test/fixtures/sarif", `${name}.sarif.json`),
          "utf8",
        ),
      );
      expect(alerts.length).toBe(1);
      expect(alerts[0]?.ruleId).toBeTruthy();
    }
  });

  it("does not repeat fingerprints and downgrades REQUEST_CHANGES", async () => {
    expect(
      chooseEvent({ requested: "auto", decision: "request_changes" }),
    ).toBe("REQUEST_CHANGES");
    expect(
      downgradeEvent(422, "Can not request changes on your own pull request"),
    ).toBe(true);
    const lines = addedLinesInPatch("@@ -1 +1,2 @@\n context\n+added\n");
    expect(lines.has(2)).toBe(true);
    const cwd = await initRepo();
    await write(
      cwd,
      "src/user.ts",
      'export function load(id: string) {\n  return db.query("SELECT " + id);\n  console.log(id);\n}\n',
    );
    const result = await runReview({
      cwd,
      provider: "mock",
      providerExplicit: true,
      env: cleanEnv(cwd),
      tty: false,
      ci: true,
      lang: "en",
    });
    const finding = result.report.findings.find(
      (item) => item.band === "report",
    );
    if (!finding) throw new Error("expected a report finding");
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? String(init.body) : undefined });
      if (url.endsWith("/files")) {
        return Response.json([
          {
            filename: "src/user.ts",
            patch:
              '@@ -0,0 +1,4 @@\n+export function load(id: string) {\n+  return db.query("SELECT " + id);\n+  console.log(id);\n+}\n',
          },
        ]);
      }
      if (
        url.endsWith("/comments") &&
        (!init || init.method === undefined || init.method === "GET")
      ) {
        return Response.json([
          { id: 1, body: `old\n<!-- kestrel:fp=${finding.fingerprint} -->` },
        ]);
      }
      if (url.endsWith("/reviews") && init?.method === "POST") {
        const body = String(init.body);
        if (body.includes("REQUEST_CHANGES")) {
          return new Response("Can not request changes", { status: 422 });
        }
        return Response.json({ id: 9 });
      }
      if (url.includes("/issues/") && init?.method === "POST")
        return Response.json({ id: 2 });
      if (url.includes("/comments") && init?.method === "PATCH")
        return Response.json({ id: 1 });
      return Response.json([]);
    };
    const posted = await postGitHubReview({
      report: result.report,
      summaryBody: "<!-- kestrel:summary -->\nsummary",
      repository: "lpliu-art/kestrel",
      pr: 7,
      token: "token",
      event: "auto",
      summaryOnly: false,
      sticky: true,
      strict: false,
      fetchImpl,
    });
    expect(posted.downgraded).toBe(true);
    expect(posted.event).toBe("COMMENT");
    expect(posted.skippedDuplicates).toBeGreaterThan(0);
    const reviewBodies = calls
      .filter((call) => call.url.endsWith("/reviews") && call.body)
      .map((call) => call.body ?? "");
    expect(reviewBodies.some((body) => body.includes("REQUEST_CHANGES"))).toBe(
      true,
    );
    expect(
      reviewBodies.some((body) => body.includes('"event":"COMMENT"')),
    ).toBe(true);
    const duplicate = planPost({
      report: result.report,
      existingBodies: result.report.findings.map(
        (item) => `<!-- kestrel:fp=${item.fingerprint} -->`,
      ),
      addedLines: new Map([["src/user.ts", new Set([1, 2, 3, 4])]]),
      summaryOnly: false,
      event: "COMMENT",
      summaryBody: "<!-- kestrel:summary -->",
    });
    expect(duplicate.comments).toEqual([]);
  });
});

describe("action and builtin rules", () => {
  it("keeps PR-controlled values out of run scripts", () => {
    for (const path of [
      "action.yml",
      "examples/github-actions/kestrel.yml",
      ".github/workflows/kestrel.yml",
    ]) {
      for (const block of runBlocks(readFileSync(path, "utf8"))) {
        expect(block.includes("${{")).toBe(false);
      }
    }
  });

  it("gives every MVP plugin at least 12 rules with examples", async () => {
    const config = defaultConfig();
    config.rulePacks = [];
    const registry = await loadPlugins(config, process.cwd(), true);
    const rules = await loadRules(registry.plugins, config, process.cwd());
    expect(lintRules(rules)).toEqual([]);
    const counts = new Map<string, number>();
    for (const rule of rules)
      counts.set(rule.pluginId, (counts.get(rule.pluginId) ?? 0) + 1);
    for (const id of ["core", "typescript", "python", "java", "go"]) {
      expect(counts.get(id) ?? 0).toBeGreaterThanOrEqual(12);
    }
    const tested = await testRules(rules, "en");
    expect(tested.failed).toEqual([]);
  });
});

function runBlocks(yaml: string): string[] {
  const blocks: string[] = [];
  const lines = yaml.split("\n");
  let current: string[] | undefined;
  let indent = 0;
  for (const line of lines) {
    const start = /^(\s*)run:\s*\|\s*$/.exec(line);
    if (start) {
      if (current) blocks.push(current.join("\n"));
      current = [];
      indent = (start[1]?.length ?? 0) + 2;
      continue;
    }
    if (!current) continue;
    if (line.trim() === "") {
      current.push(line);
      continue;
    }
    const width = line.match(/^\s*/)?.[0].length ?? 0;
    if (width < indent) {
      blocks.push(current.join("\n"));
      current = undefined;
    } else {
      current.push(line);
    }
  }
  if (current) blocks.push(current.join("\n"));
  return blocks;
}

function sourceFile(
  source: string,
  added: number[],
): {
  text: string;
  lines: string[];
  file: ChangedFile;
} {
  const lines = source.split("\n");
  if (source.endsWith("\n")) lines.pop();
  return {
    text: lines.join("\n"),
    lines,
    file: {
      path: "src/a.js",
      status: "modified",
      binary: false,
      addedCount: added.length,
      deletedCount: 0,
      addedLineNumbers: added,
      hunks: added.map((line) => ({
        oldStart: line,
        oldLines: 0,
        newStart: line,
        newLines: 1,
        header: `@@ +${line} @@`,
        lines: [
          { kind: "added" as const, text: lines[line - 1] ?? "", newNo: line },
        ],
      })),
    },
  };
}
