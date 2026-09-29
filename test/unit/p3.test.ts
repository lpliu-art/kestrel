import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/program.ts";
import { defaultConfig } from "../../src/config/defaults.ts";
import { datasetFrom } from "../../src/eval/dataset.ts";
import { syntheticFusionStudy } from "../../src/eval/fusion.ts";
import { classify, searchThresholds } from "../../src/eval/metrics.ts";
import { renderEval, runEval } from "../../src/eval/run.ts";
import { runExplore } from "../../src/explore/run.ts";
import { createLlmShimProvider } from "../../src/jev/llm-shim.ts";
import { effectiveProbability } from "../../src/judge/decide.ts";
import { exportTelemetry } from "../../src/otel/export.ts";
import { runReview } from "../../src/pipeline/review.ts";
import { renderTerminal } from "../../src/render/terminal.ts";
import {
  clearGrammarFailureForTests,
  setWasmReaderForTests,
} from "../../src/treesitter/runtime.ts";
import { renderViewer, writeViewer } from "../../src/view/html.ts";
import { cleanEnv, initRepo, write } from "../helpers/git-repo.ts";

const root = process.cwd();

afterEach(() => {
  setWasmReaderForTests(undefined);
  clearGrammarFailureForTests();
});

describe("calibration math", () => {
  it("scores precision, recall, and a threshold proposal", () => {
    const pairs = [
      {
        ruleId: "ts.security.sql-string-concat",
        pluginId: "ts",
        positive: true,
        pEff: 0.9,
      },
      {
        ruleId: "ts.security.sql-string-concat",
        pluginId: "ts",
        positive: false,
        pEff: 0.2,
      },
      {
        ruleId: "py.security.sql-format",
        pluginId: "py",
        positive: true,
        pEff: 0.4,
      },
    ];
    const metrics = classify(pairs, 0.75);
    expect(metrics).toMatchObject({ tp: 1, fp: 0, fn: 1, tn: 1 });
    expect(metrics.precision).toBe(1);
    expect(metrics.falsePositiveRate).toBe(0);
    const proposed = searchThresholds(pairs);
    expect(proposed.balanced.report).toBeGreaterThan(0);
    expect(proposed.chill.report).toBeGreaterThanOrEqual(
      proposed.assertive.report,
    );
  });

  it("keeps the heuristic by default and shows logistic ECE can improve", () => {
    expect(effectiveProbability(0.9, [{ p: 0.2, weight: 1 }])).toBeCloseTo(
      0.72,
      5,
    );
    const fused = effectiveProbability(0.9, [{ p: 0.2, weight: 1 }], {
      bias: 0,
      main: 2,
      guard: -1,
    });
    expect(fused).toBeGreaterThan(0);
    expect(fused).toBeLessThanOrEqual(1);
    const study = syntheticFusionStudy();
    expect(study.realModel).toBe(false);
    expect(study.logistic.f1).toBeGreaterThanOrEqual(study.heuristic.f1 - 1e-9);
    expect(study.logistic.ece).toBeLessThan(study.heuristic.ece);
    expect(study.adopt).toBe(true);
  });
});

describe("datasets", () => {
  it("catalogs an AACR project file without inventing rule scores", () => {
    const dataset = datasetFrom([
      {
        project_main_language: "C++",
        comments: [{ note: "unused" }, { note: "other" }],
      },
    ]);
    expect(dataset.cases).toEqual([]);
    expect(dataset.catalog?.judged).toBe(false);
    expect(dataset.catalog?.comments).toBe(2);
    expect(dataset.notes.join(" ")).toMatch(/Apache-2.0/);
  });

  it("rejects a dataset that is not an object", () => {
    expect(() => datasetFrom("nope")).toThrow(/JSON object/);
  });
});

describe("eval command", () => {
  it("scores the internal set with mock and refuses to apply it", async () => {
    const report = await runEval({
      datasetPath: join(root, "eval/internal/dataset.json"),
      provider: "mock",
      env: cleanEnv("/tmp", { KESTREL_LLM_API_KEY: "" }),
      calibrate: true,
      apply: true,
    });
    expect(report.realModel).toBe(false);
    expect(report.banner).toMatch(/MOCK CALIBRATION/);
    expect(report.applied).toBe(false);
    expect(report.notes.join(" ")).toMatch(/Refusing to apply mock/);
    expect(report.overall.recall).toBe(1);
    expect(report.overall.falsePositiveRate).toBe(0);
    expect(report.byPlugin.rust?.recall).toBe(1);
    expect(report.byPlugin.csharp?.fp).toBe(0);
    const text = renderEval(report);
    expect(text).toMatch(/not from Jev/);
    expect(text).toMatch(/proposed balanced/);
  }, 120_000);

  it("scores the AACR-shaped sample", async () => {
    const report = await runEval({
      datasetPath: join(root, "eval/aacr/sample.json"),
      provider: "mock",
      env: cleanEnv("/tmp", { KESTREL_LLM_API_KEY: "" }),
    });
    expect(report.kind).toBe("aacr");
    expect(report.catalog?.judged).toBe(true);
    expect(report.overall.tp).toBe(1);
    expect(report.overall.fp).toBe(0);
  }, 60_000);
});

describe("session viewer", () => {
  it("embeds state, questions, answers, and latency", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kestrel-view-"));
    const sessions = join(dir, "sessions");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(sessions);
    await writeFile(
      join(sessions, "one.jsonl"),
      `${JSON.stringify({
        type: "request",
        unitId: "u1",
        pass: 1,
        latencyMs: 12,
        questionKeys: ["r.demo"],
        questions: { "r.demo": { type: "noul", instructions: "Is it wrong?" } },
        answers: { "r.demo": { type: "noul", noul: 0.9 } },
        state: { hunk: "SELECT secret" },
      })}\n`,
    );
    const html = renderViewer({
      sessions: [
        {
          file: "one.jsonl",
          events: [
            {
              type: "request",
              unitId: "u1",
              latencyMs: 12,
              questions: { "r.demo": { instructions: "Is it wrong?" } },
              answers: { "r.demo": { type: "noul", noul: 0.9 } },
              state: { hunk: "SELECT secret" },
            },
          ],
        },
      ],
      report: {
        findings: [
          {
            ruleId: "ts.security.sql-string-concat",
            message: "concat",
            location: { path: "src/user.ts", startLine: 2 },
            trace: { model: "mock-1" },
          },
        ],
      },
    });
    expect(html).toContain("SELECT secret");
    expect(html).toContain("Is it wrong?");
    expect(html).toContain("12");
    expect(html).toContain("ts.security.sql-string-concat");
    const out = await writeViewer({
      sessionDir: sessions,
      outPath: join(dir, "view.html"),
    });
    const written = await readFile(out, "utf8");
    expect(written).toContain("u1");
  });
});

describe("explore", () => {
  it("keeps a suspect only when Jev supports it", async () => {
    const cwd = await initRepo();
    await write(
      cwd,
      "src/user.ts",
      'export function getUser(id: string) {\n  const sql = "SELECT * FROM users WHERE id = " + id;\n  return sql;\n}\n',
    );
    const kept = await runReview({
      cwd,
      mode: "scan",
      paths: ["src/user.ts"],
      provider: "mock",
      providerExplicit: true,
      lang: "en",
      noCache: true,
      explore: true,
      env: cleanEnv(cwd, { KESTREL_LLM_API_KEY: "test" }),
      configPath: await llmConfig(cwd),
      fetchImpl: jsonFetch({
        issues: [{ line: 2, issue: "SELECT is built by concatenating id" }],
      }),
      tty: false,
      ci: true,
    });
    const explore = kept.report.findings.find(
      (finding) => finding.source === "explore",
    );
    expect(explore?.message).toMatch(/LLM proposed · Jev verified p=0\.86/);
    expect(explore?.severity).toBe("medium");
    expect(kept.report.verdict.decision).toBe("request_changes");

    const skipped = await runExplore({
      files: [
        {
          path: "src/user.ts",
          language: "typescript",
          risk: 0.9,
          units: 1,
          dimensions: {},
          deepReview: true,
        },
      ],
      units: [],
      provider: kept.report.provider as never,
      model: "jev-1.13.0",
      llm: { ...defaultConfig().llm, model: "demo", enabled: true },
      env: cleanEnv("/tmp", { KESTREL_LLM_API_KEY: "" }),
      language: "en",
    });
    expect(skipped.warning).toMatch(/not set/);
    expect(skipped.findings).toEqual([]);
  }, 60_000);
});

describe("llm-shim and telemetry", () => {
  it("labels shim answers as degraded and not Jev", async () => {
    expect(() =>
      createLlmShimProvider({
        config: defaultConfig(),
        env: {},
      }),
    ).toThrow(/not Jev/);
    const provider = createLlmShimProvider({
      config: {
        ...defaultConfig(),
        llm: { ...defaultConfig().llm, model: "demo", enabled: true },
      },
      env: { KESTREL_LLM_API_KEY: "test" },
      fetchImpl: jsonFetch({
        answers: { "r.demo": { type: "noul", noul: 0.25 } },
      }),
    });
    expect(provider.isAI).toBe(false);
    expect(provider.name).toBe("llm-shim");
    const response = await provider.ask({
      model: "ignored",
      state: { hunk: "const a = 1;\n" },
      questions: {
        "r.demo": { type: "noul", instructions: "Is this a defect?" },
      },
    });
    expect(response.model).toBe("llm-shim:demo");
    expect(response.answers["r.demo"]).toEqual({ type: "noul", noul: 0.25 });
    const cwd = await initRepo();
    await write(cwd, "src/quiet.ts", "export const value = 1;\n");
    const review = await runReview({
      cwd,
      mode: "scan",
      paths: ["src/quiet.ts"],
      provider: "llm-shim",
      providerExplicit: true,
      lang: "en",
      noCache: true,
      configPath: await llmConfig(cwd),
      env: cleanEnv(cwd, { KESTREL_LLM_API_KEY: "test" }),
      fetchImpl: jsonFetch({ answers: {} }),
      tty: false,
      ci: true,
    });
    expect(review.terminal).toMatch(/DEGRADED/);
    expect(review.terminal).not.toMatch(/MOCK —/);
    expect(renderTerminal(review.report, "collapsed")).toMatch(/not by Jev/);
  }, 60_000);

  it("exports spans without source text", async () => {
    let body = "";
    const failure = await exportTelemetry({
      endpoint: "http://collector.example",
      traces: [
        {
          pass: 1,
          unitId: "u1",
          path: "src/user.ts",
          questionKeys: ["r.demo"],
          answers: {},
          usage: { input_tokens: 10, output_tokens: 2 },
          latencyMs: 5,
          model: "mock-1",
          cached: false,
        },
      ],
      report: {
        run: { durationMs: 8, requests: 1, tokens: { input: 10 } },
        summary: { findings: { report: 1, uncertain: 0 } },
        provider: { model: "mock-1" },
        findings: [],
      } as never,
      fetchImpl: (async (_url, init) => {
        body = String(init?.body ?? "");
        return new Response("ok", { status: 200 });
      }) as typeof fetch,
    });
    expect(failure).toBeUndefined();
    expect(body).toContain("review.run");
    expect(body).toContain("unit.pass1");
    expect(body).toContain("render");
    expect(body).not.toContain("src/user.ts");
    const down = await exportTelemetry({
      endpoint: "http://collector.example/",
      traces: [],
      report: {
        run: { durationMs: 1, requests: 0, tokens: { input: 0 } },
        summary: { findings: { report: 0, uncertain: 0 } },
        provider: { model: "mock-1" },
        findings: [],
      } as never,
      fetchImpl: (async () =>
        new Response("no", { status: 503 })) as typeof fetch,
    });
    expect(down).toMatch(/503/);
  });
});

describe("cli", () => {
  it("prints a mock eval and writes a viewer", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "kestrel-cli-"));
    const code = await runCaptured(cwd, [
      "node",
      "kestrel",
      "eval",
      join(root, "eval/internal/dataset.json"),
      "--provider",
      "mock",
      "--calibrate",
    ]);
    expect(code.exit).toBe(0);
    expect(code.stdout).toMatch(/MOCK CALIBRATION/);
    const viewCode = await runCaptured(cwd, [
      "node",
      "kestrel",
      "view",
      "--sessions",
      join(cwd, "missing"),
      "--out",
      join(cwd, "view.html"),
    ]);
    expect(viewCode.exit).toBe(0);
    expect(viewCode.stdout).toMatch(/wrote /);
  }, 120_000);
});

describe("wasm bytes", () => {
  it("accepts grammar bytes and warns on a bad buffer", async () => {
    const { readFileSync } = await import("node:fs");
    const { createRequire } = await import("node:module");
    const require = createRequire(join(root, "package.json"));
    const bytes = readFileSync(
      require.resolve("tree-sitter-javascript/tree-sitter-javascript.wasm"),
    );
    setWasmReaderForTests((name) =>
      name === "tree-sitter-javascript.wasm" ? bytes : undefined,
    );
    const { ensureTreesitter, grammarReady, drainGrammarWarnings } =
      await import("../../src/treesitter/runtime.ts");
    await ensureTreesitter();
    expect(grammarReady("javascript")).toBe(true);
    setWasmReaderForTests((name) =>
      name === "tree-sitter-javascript.wasm"
        ? new Uint8Array([1, 2, 3])
        : undefined,
    );
    await ensureTreesitter();
    expect(drainGrammarWarnings().join(" ")).toMatch(/javascript/);
  });
});

function jsonFetch(payload: unknown): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(payload) } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
}

async function llmConfig(cwd: string): Promise<string> {
  const path = join(cwd, ".kestrel.yml");
  await writeFile(
    path,
    "version: 1\nllm:\n  model: demo\n  apiKeyEnv: KESTREL_LLM_API_KEY\n",
  );
  return path;
}

async function runCaptured(
  cwd: string,
  argv: string[],
): Promise<{ exit: number; stdout: string }> {
  const previous = process.cwd();
  const logs: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    logs.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.chdir(cwd);
  try {
    const exit = await runCli(argv);
    return { exit, stdout: logs.join("") };
  } finally {
    process.stdout.write = write;
    process.chdir(previous);
  }
}
