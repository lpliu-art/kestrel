import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/program.ts";
import { defaultConfig } from "../../src/config/defaults.ts";
import { explainFinding } from "../../src/explain/run.ts";
import { fileFromSource } from "../../src/git/unified-diff.ts";
import { postGitLabReview } from "../../src/gitlab/post.ts";
import {
  incrementalSince,
  writeIncremental,
} from "../../src/incremental/state.ts";
import { BudgetGuard } from "../../src/jev/budget.ts";
import { createMockProvider } from "../../src/jev/mock.ts";
import type { JevProvider } from "../../src/jev/types.ts";
import { judgePullRequest } from "../../src/judge/pull-request.ts";
import {
  clipFileToLines,
  reviewSlices,
  vueBlocks,
} from "../../src/lang/vue-sfc.ts";
import { completeNarration } from "../../src/narrate/client.ts";
import { parseRewrite } from "../../src/narrate/parse.ts";
import { narrateFindings } from "../../src/narrate/run.ts";
import { keepRewrite } from "../../src/narrate/verify.ts";
import { judgeUnit } from "../../src/pipeline/judge-unit.ts";
import { runReview } from "../../src/pipeline/review.ts";
import { buildReviewState } from "../../src/pipeline/state.ts";
import { rustPlugin } from "../../src/plugins/builtin/rust/index.ts";
import { loadPlugins } from "../../src/plugins/loader.ts";
import type { Finding } from "../../src/report/model.ts";
import { loadRules } from "../../src/rules/load.ts";
import { testRules } from "../../src/rules/test-runner.ts";
import { scanFiles } from "../../src/scan/files.ts";
import {
  clearGrammarFailureForTests,
  forceGrammarFailureForTests,
} from "../../src/treesitter/runtime.ts";
import { buildUnits } from "../../src/units/build.ts";
import { cleanEnv, git, initRepo, write } from "../helpers/git-repo.ts";

const VUE = `<template>\n  <div v-html="userHtml"></div>\n</template>\n<script setup lang="ts">\nconst { count } = props;\n</script>\n`;
const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
});

describe("narrator", () => {
  it("keeps a verified rewrite and leaves the judgment unchanged", async () => {
    const finding = await oneFinding();
    const before = identity(finding);
    let called = 0;
    const fetchImpl = (async () => {
      called += 1;
      return json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                explanation: "Polished: the query is concatenated.",
                suggestion: {
                  code: "use a bound parameter",
                  startLine: 9,
                  endLine: 9,
                },
              }),
            },
          },
        ],
      });
    }) as typeof fetch;
    const result = await narrateFindings({
      findings: [finding],
      settings: settings(),
      env: { KESTREL_LLM_API_KEY: "test-key" },
      provider: answering(0.91, 0.1, 0.1),
      model: "jev-1.13.0",
      fetchImpl,
    });
    const next = result.findings[0];
    expect(called).toBe(1);
    expect(next?.message).toBe("Polished: the query is concatenated.");
    expect(next?.fix.hint).toBe("use a bound parameter");
    expect(next?.location.startLine).toBe(before.line);
    expect(identity(next as Finding)).toEqual(before);
    expect(result.narration).toEqual({
      enabled: true,
      attempted: 1,
      kept: 1,
      fallback: 0,
      verifyFailed: 0,
    });
  });

  it("falls back when verification or the provider fails", async () => {
    const finding = await oneFinding();
    const fetchImpl = (async () =>
      json({
        choices: [
          {
            message: {
              content: '{"explanation":"Rewritten","suggestion":{"code":"x"}}',
            },
          },
        ],
      })) as typeof fetch;
    const rejected = await narrateFindings({
      findings: [finding],
      settings: settings(),
      env: { KESTREL_LLM_API_KEY: "test-key" },
      provider: answering(0.1, 0.9, 0.9),
      model: "jev-1.13.0",
      fetchImpl,
    });
    expect(rejected.findings[0]?.message).toBe(finding.message);
    expect(rejected.narration?.fallback).toBe(1);
    expect(rejected.narration?.verifyFailed).toBe(1);
    expect(keepRewrite({})).toEqual({ keep: false, verifyFailed: true });

    const thrown = await narrateFindings({
      findings: [finding],
      settings: settings(),
      env: { KESTREL_LLM_API_KEY: "test-key" },
      provider: {
        name: "stub",
        isAI: true,
        async ask() {
          throw new Error("down");
        },
      },
      model: "jev-1.13.0",
      fetchImpl,
    });
    expect(thrown.narration?.verifyFailed).toBe(1);
    expect(thrown.findings[0]?.severity).toBe(finding.severity);
  });

  it("falls back on HTTP errors, bad JSON, and a missing key", async () => {
    const finding = await oneFinding();
    const failed = await narrateFindings({
      findings: [finding],
      settings: settings(),
      env: { KESTREL_LLM_API_KEY: "test-key" },
      provider: answering(0.9, 0.1, 0.1),
      model: "jev-1.13.0",
      fetchImpl: (async () =>
        new Response("no", { status: 500 })) as typeof fetch,
    });
    expect(failed.narration?.fallback).toBe(1);
    expect(failed.narration?.kept).toBe(0);

    const bad = await narrateFindings({
      findings: [finding],
      settings: settings(),
      env: { KESTREL_LLM_API_KEY: "test-key" },
      provider: answering(0.9, 0.1, 0.1),
      model: "jev-1.13.0",
      fetchImpl: (async () =>
        json({
          choices: [{ message: { content: "not-json" } }],
        })) as typeof fetch,
    });
    expect(bad.findings[0]?.message).toBe(finding.message);
    expect(
      parseRewrite('```json\n{"explanation":"ok"}\n```')?.explanation,
    ).toBe("ok");
    expect(parseRewrite("[]")).toBeUndefined();

    let called = 0;
    const missing = await narrateFindings({
      findings: [finding],
      settings: settings(),
      env: {},
      provider: answering(0.9, 0.1, 0.1),
      model: "jev-1.13.0",
      fetchImpl: (async () => {
        called += 1;
        return json({});
      }) as typeof fetch,
    });
    expect(called).toBe(0);
    expect(missing.warning).toMatch(/KESTREL_LLM_API_KEY/);
    expect(missing.findings[0]).toBe(finding);

    const off = await narrateFindings({
      findings: [finding],
      settings: { ...settings(), enabled: false },
      env: { KESTREL_LLM_API_KEY: "test-key" },
      provider: answering(0.9, 0.1, 0.1),
      model: "jev-1.13.0",
    });
    expect(off.narration).toBeUndefined();
    expect(off.findings[0]).toBe(finding);
  });

  it("talks to an Anthropic-compatible endpoint and can skip verification", async () => {
    const finding = await oneFinding();
    const urls: string[] = [];
    const result = await narrateFindings({
      findings: [finding, { ...finding, id: "f_other", band: "uncertain" }],
      settings: {
        ...settings(),
        protocol: "anthropic",
        baseURL: "https://llm.example/v1/",
        verifyWithJev: false,
        maxFindings: 1,
      },
      env: { KESTREL_LLM_API_KEY: "test-key" },
      provider: answering(0.1, 0.9, 0.9),
      model: "jev-1.13.0",
      fetchImpl: (async (url: string) => {
        urls.push(String(url));
        return json({
          content: [{ text: '{"explanation":"Anthropic text"}' }],
        });
      }) as typeof fetch,
    });
    expect(urls).toEqual(["https://llm.example/v1/messages"]);
    expect(result.narration?.attempted).toBe(1);
    expect(result.findings[0]?.message).toBe("Anthropic text");
    expect(result.findings[0]?.fix.hint).toBe(finding.fix.hint);
    expect(result.findings[1]?.band).toBe("uncertain");
    await expect(
      completeNarration({
        protocol: "openai",
        baseURL: "https://llm.example",
        model: "m",
        apiKey: "k",
        prompt: "p",
        fetchImpl: (async () => json({})) as typeof fetch,
      }),
    ).rejects.toThrow(/expected JSON/);
    const anthropic = await completeNarration({
      protocol: "anthropic",
      baseURL: "https://llm.example",
      model: "m",
      apiKey: "k",
      prompt: "p",
      fetchImpl: (async (url: string) => {
        expect(String(url)).toBe("https://llm.example/v1/messages");
        return json({ content: [{ text: '{"explanation":"from root"}' }] });
      }) as typeof fetch,
    });
    expect(anthropic.explanation).toBe("from root");
    await expect(
      completeNarration({
        protocol: "anthropic",
        baseURL: "https://llm.example/v1",
        model: "m",
        apiKey: "k",
        prompt: "p",
        fetchImpl: (async () => json({ content: "nope" })) as typeof fetch,
      }),
    ).rejects.toThrow(/expected JSON/);
  });

  it("uses templates when a review enables the narrator without a passing verification", async () => {
    const cwd = await initRepo();
    await write(
      cwd,
      "src/user.ts",
      'export async function getUser(id: string) {\n  const sql = "SELECT * FROM users WHERE id = " + id;\n  return sql;\n}\n',
    );
    const env = cleanEnv(cwd, { KESTREL_LLM_API_KEY: "test-key" });
    const result = await runReview({
      cwd,
      provider: "mock",
      providerExplicit: true,
      noCache: true,
      lang: "en",
      llm: true,
      env,
      fetchImpl: (async () =>
        json({
          choices: [
            {
              message: {
                content:
                  '{"explanation":"Should not stick","suggestion":{"code":"bind"}}',
              },
            },
          ],
        })) as typeof fetch,
    });
    expect(result.report.narration?.fallback).toBeGreaterThan(0);
    expect(result.report.narration?.kept).toBe(0);
    expect(
      result.report.findings.some((finding) =>
        finding.message.includes("Should not stick"),
      ),
    ).toBe(false);
    expect(result.report.pullRequest?.conclusion).toMatch(/Pull request risk/);
    expect(explainFinding(result.report, "pr")).toMatch(/pr\.risk/);
    expect(result.markdown).toMatch(/Pull request/);
  });
});

describe("vue sfc and scan", () => {
  it("reports v-html on the original file line", async () => {
    const blocks = vueBlocks(VUE);
    const template = blocks.find((block) => block.kind === "template");
    const script = blocks.find((block) => block.kind === "script");
    expect(template?.startLine).toBe(2);
    expect(script?.languageId).toBe("typescript");
    const file = fileFromSource("src/App.vue", VUE);
    const clipped = clipFileToLines(
      file,
      template?.startLine ?? 1,
      template?.endLine ?? 1,
    );
    expect(clipped?.addedLineNumbers).toContain(2);
    const config = defaultConfig();
    const registry = await loadPlugins(config, process.cwd(), true);
    const rules = await loadRules(registry.plugins, config, process.cwd());
    const rule = rules.find((item) => item.id === "vue.security.v-html");
    expect(rule).toBeDefined();
    const units = buildUnits(
      clipped ?? file,
      VUE.split("\n"),
      "vue",
      "typescript",
      { maxAddedLinesPerUnit: 120 },
      { frameworks: ["vue"] },
    );
    const unit = units[0];
    expect(unit).toBeDefined();
    if (!unit || !rule) return;
    const judged = await judgeUnit({
      unit,
      rules: [rule],
      state: buildReviewState({
        unit,
        rules: [rule],
        redact: true,
      }),
      provider: createMockProvider([rule]),
      budget: new BudgetGuard(2_000_000),
      model: "jev-1.13.0",
      profile: "balanced",
      language: "en",
      strategy: "two-pass",
      maxRules: 40,
      warnings: [],
    });
    const finding = judged.findings.find(
      (item) => item.ruleId === "vue.security.v-html",
    );
    expect(finding?.location.startLine).toBe(2);
    expect(vueBlocks("<script></script>\n").length).toBe(0);
    expect(
      vueBlocks('<script lang="tsx">\nconst x = 1;\n</script>\n')[0]
        ?.languageId,
    ).toBe("tsx");
    expect(reviewSlices(file, "typescript", VUE)).toEqual([
      { file, languageId: "typescript" },
    ]);
    expect(clipFileToLines(file, 80, 90)).toBeUndefined();
  });

  it("walks a directory and skips vendored and binary files", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "kestrel-walk-"));
    await write(cwd, "src/nested/app.ts", "export const n = 1;\n");
    await write(cwd, "node_modules/pkg/index.js", "module.exports = 1;\n");
    await writeFile(join(cwd, "blob.bin"), Buffer.from([0, 1, 2]));
    const files = await scanFiles({ cwd, paths: ["."] });
    expect(files.map((file) => file.path).sort()).toEqual([
      "src/nested/app.ts",
    ]);
    await expect(scanFiles({ cwd, paths: ["missing.ts"] })).rejects.toThrow(
      /Cannot read missing.ts/,
    );
    const facts = await rustPlugin.facts?.detect({
      root: cwd,
      async readFile() {
        return undefined;
      },
      async listFiles() {
        return [];
      },
    });
    expect(facts).toEqual([]);
    await write(cwd, "Cargo.toml", 'tokio = "1"\n');
    const withTokio = await rustPlugin.facts?.detect({
      root: cwd,
      async readFile(path) {
        return readFile(join(cwd, path), "utf8");
      },
      async listFiles() {
        return [];
      },
    });
    expect(withTokio).toEqual(["tokio"]);
  });

  it("chunks a large scan and skips units that exceed the budget", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "kestrel-scan-"));
    const lines = Array.from(
      { length: 300 },
      (_, index) => `console.log(${index});`,
    );
    await write(cwd, "src/big.ts", `${lines.join("\n")}\n`);
    const preview = await runReview({
      cwd,
      mode: "scan",
      paths: ["src/big.ts"],
      provider: "mock",
      providerExplicit: true,
      preview: true,
      noCache: true,
      lang: "en",
      env: cleanEnv(cwd),
    });
    expect(preview.report.run.mode).toBe("scan");
    expect(preview.report.summary.units).toBeGreaterThan(1);
    const tight = await runReview({
      cwd,
      mode: "scan",
      paths: ["src/big.ts"],
      provider: "mock",
      providerExplicit: true,
      noCache: true,
      budgetTokens: 1,
      lang: "en",
      env: cleanEnv(cwd),
    });
    expect(tight.report.run.status).toBe("partial");
    expect(tight.report.skipped.some((item) => item.reason === "budget")).toBe(
      true,
    );
    await expect(
      runReview({
        cwd,
        mode: "scan",
        paths: [],
        provider: "mock",
        providerExplicit: true,
        env: cleanEnv(cwd),
      }),
    ).rejects.toThrow(/at least one path/);
  });
});

describe("incremental review", () => {
  it("requests only the hunks added after the previous head", async () => {
    const cwd = await initRepo();
    git(cwd, ["checkout", "-b", "feature"]);
    await write(cwd, "src/a.ts", "console.log('a');\n");
    git(cwd, ["add", "src/a.ts"]);
    git(cwd, ["commit", "-m", "a"]);
    const first = await runReview({
      cwd,
      mode: "range",
      from: "main",
      provider: "mock",
      providerExplicit: true,
      noCache: true,
      incremental: true,
      lang: "en",
      env: cleanEnv(cwd),
    });
    expect(first.report.files.map((file) => file.path)).toContain("src/a.ts");
    const stored = JSON.parse(
      await readFile(join(cwd, ".kestrel/incremental.json"), "utf8"),
    ) as { head: string };
    expect(stored.head).toBe(git(cwd, ["rev-parse", "HEAD"]).trim());
    await write(cwd, "src/b.ts", "console.log('b');\n");
    git(cwd, ["add", "src/b.ts"]);
    git(cwd, ["commit", "-m", "b"]);
    const second = await runReview({
      cwd,
      mode: "range",
      from: "main",
      provider: "mock",
      providerExplicit: true,
      noCache: true,
      incremental: true,
      lang: "en",
      env: cleanEnv(cwd),
    });
    expect(second.report.files.map((file) => file.path)).toEqual(["src/b.ts"]);
    expect(second.report.run.requests).toBeGreaterThan(0);
    expect(second.report.files.some((file) => file.path === "src/a.ts")).toBe(
      false,
    );
    await writeIncremental(cwd, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const forced = await incrementalSince(cwd, "HEAD");
    expect(forced.warning).toMatch(/not an ancestor/);
    expect(forced.since).toBeUndefined();
  });
});

describe("gitlab post", () => {
  it("posts discussions, skips fingerprints, and survives API failure", async () => {
    const report = await sampleReport();
    const finding = report.findings.find((item) => item.band === "report");
    expect(finding).toBeDefined();
    const calls: string[] = [];
    const versions = [
      {
        base_commit_sha: "a".repeat(40),
        start_commit_sha: "b".repeat(40),
        head_commit_sha: "c".repeat(40),
        diffs: [
          {
            new_path: finding?.location.path,
            diff: `@@ -0,0 +${finding?.location.startLine} @@\n+added\n`,
          },
        ],
      },
    ];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (String(url).endsWith("/versions")) return json(versions);
      if (
        String(url).endsWith("/discussions") &&
        (init?.method ?? "GET") === "GET"
      )
        return json([{ notes: [{ body: "old" }] }]);
      if (String(url).endsWith("/notes") && (init?.method ?? "GET") === "GET")
        return json([]);
      if (init?.method === "POST") return json({ id: 1 });
      return new Response("no", { status: 500 });
    }) as typeof fetch;
    const posted = await postGitLabReview({
      report,
      summaryBody: "<!-- kestrel:summary -->\nsummary",
      project: "group/app",
      mr: 7,
      token: "glpat",
      summaryOnly: false,
      strict: false,
      fetchImpl,
    });
    expect(posted.postedComments).toBeGreaterThan(0);
    expect(posted.exitCode).toBe(0);
    expect(calls.some((call) => call.includes("group%2Fapp"))).toBe(true);

    const again = await postGitLabReview({
      report,
      summaryBody: "<!-- kestrel:summary -->\nsummary",
      project: "group/app",
      mr: 7,
      token: "glpat",
      summaryOnly: false,
      strict: false,
      fetchImpl: (async (url: string, init?: RequestInit) => {
        if (String(url).endsWith("/versions")) return json(versions);
        if ((init?.method ?? "GET") === "GET") {
          return json([
            {
              id: 9,
              body: `<!-- kestrel:summary -->\n<!-- kestrel:fp=${finding?.fingerprint} -->`,
            },
          ]);
        }
        if (init?.method === "PUT") return json({ id: 9 });
        return json({ id: 2 });
      }) as typeof fetch,
    });
    expect(again.skippedDuplicates).toBeGreaterThan(0);
    expect(again.postedComments).toBe(0);

    const broken = await postGitLabReview({
      report,
      summaryBody: "summary",
      project: "group/app",
      mr: 7,
      token: "glpat",
      summaryOnly: false,
      strict: true,
      fetchImpl: (async () => {
        throw new Error("offline");
      }) as typeof fetch,
    });
    expect(broken.exitCode).toBe(4);
    const soft = await postGitLabReview({
      report,
      summaryBody: "summary",
      project: "group/app",
      mr: 7,
      token: "glpat",
      summaryOnly: true,
      strict: false,
      fetchImpl: (async () =>
        new Response("no", { status: 503 })) as typeof fetch,
    });
    expect(soft.exitCode).toBe(0);
  });
});

describe("pull request judgment", () => {
  it("explains risk and the test gap in both languages", async () => {
    const high = await judgePullRequest({
      provider: scores(0.9, 0.8),
      model: "jev-1.13.0",
      files: ["src/a.ts"],
      testsChanged: [],
      language: "en",
    });
    expect(high.conclusion).toMatch(/risk high/);
    expect(high.conclusion).toMatch(/do not cover/);
    const mid = await judgePullRequest({
      provider: scores(0.6, 0.2),
      model: "jev-1.13.0",
      files: ["src/a.ts"],
      testsChanged: ["src/a.test.ts"],
      language: "zh-CN",
    });
    expect(mid.conclusion).toMatch(/风险中/);
    expect(mid.conclusion).toMatch(/a.test.ts/);
    const low = await judgePullRequest({
      provider: scores(0.2, 0.1),
      model: "jev-1.13.0",
      files: [],
      testsChanged: [],
      language: "en",
    });
    expect(low.conclusion).toMatch(/risk low/);
    const missing = await judgePullRequest({
      provider: {
        name: "stub",
        isAI: true,
        async ask() {
          return {
            model: "jev-1.13.0",
            answers: {},
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      },
      model: "jev-1.13.0",
      files: ["src/a.ts"],
      testsChanged: [],
      language: "zh-CN",
    });
    expect(missing.risk).toBe(0);
    expect(missing.conclusion).toMatch(/风险低/);
  });
});

describe("scan and gitlab commands", () => {
  it("scans a file and refuses to post without a token", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "kestrel-cli-"));
    await write(cwd, "src/app.ts", "console.log(1);\n");
    const scanned = await runCaptured(
      ["scan", "src/app.ts", "--provider", "mock", "--lang", "en"],
      cwd,
    );
    expect(scanned.code).toBe(0);
    expect(scanned.out).toMatch(/core\.debug\.leftover/);
    expect(scanned.out).toMatch(/Pull request risk/);
    const denied = await runCaptured(
      [
        "gitlab",
        "post",
        "--report",
        "missing.json",
        "--project",
        "g/a",
        "--mr",
        "1",
      ],
      cwd,
    );
    expect(denied.code).toBe(2);
    expect(denied.err).toMatch(/GITLAB_TOKEN/);
  });
});

describe("rust grammar fallback", () => {
  it("still reports an unsafe block when the grammar is forced down", async () => {
    forceGrammarFailureForTests("p2");
    try {
      const config = defaultConfig();
      const registry = await loadPlugins(config, process.cwd(), true);
      const rules = (
        await loadRules(registry.plugins, config, process.cwd())
      ).filter((rule) => rule.id === "rust.unsafe.block");
      const tested = await testRules(rules, "en");
      expect(tested.failed).toEqual([]);
    } finally {
      clearGrammarFailureForTests();
    }
  });
});

function settings() {
  return {
    enabled: true,
    protocol: "openai" as const,
    baseURL: "https://llm.example/v1",
    model: "demo",
    apiKeyEnv: "KESTREL_LLM_API_KEY",
    maxFindings: 10,
    verifyWithJev: true,
  };
}

function scores(risk: number, testGap: number): JevProvider {
  return {
    name: "stub",
    isAI: true,
    async ask() {
      return {
        model: "jev-1.13.0",
        answers: {
          "pr.risk": { type: "noul", noul: risk },
          "pr.tests": { type: "noul", noul: testGap },
        },
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    },
  };
}

function answering(
  addresses: number,
  unrelated: number,
  contradicts: number,
): JevProvider {
  return {
    name: "stub",
    isAI: true,
    async ask() {
      return {
        model: "jev-1.13.0",
        answers: {
          "v.addresses": { type: "noul", noul: addresses },
          "v.unrelated": { type: "noul", noul: unrelated },
          "v.contradicts": { type: "noul", noul: contradicts },
        },
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    },
  };
}

function identity(finding: Finding) {
  return {
    id: finding.id,
    fingerprint: finding.fingerprint,
    ruleId: finding.ruleId,
    severity: finding.severity,
    band: finding.band,
    probability: finding.probability,
    pEff: finding.pEff,
    line: finding.location.startLine,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function oneFinding(): Promise<Finding> {
  const report = await sampleReport();
  const finding = report.findings.find((item) => item.band === "report");
  if (!finding) throw new Error("expected a report finding");
  return finding;
}

async function runCaptured(
  args: string[],
  cwd: string,
): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    err.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  process.chdir(cwd);
  const previous = process.env.GITLAB_TOKEN;
  delete process.env.GITLAB_TOKEN;
  delete process.env.CI_JOB_TOKEN;
  try {
    const code = await runCli(["node", "kestrel", ...args]);
    return { code, out: out.join(""), err: err.join("") };
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
    if (previous === undefined) delete process.env.GITLAB_TOKEN;
    else process.env.GITLAB_TOKEN = previous;
  }
}

async function sampleReport() {
  const cwd = await mkdtemp(join(tmpdir(), "kestrel-p2-"));
  await writeFile(join(cwd, "a.ts"), "console.log(1);\n");
  const result = await runReview({
    cwd,
    mode: "scan",
    paths: ["a.ts"],
    provider: "mock",
    providerExplicit: true,
    noCache: true,
    lang: "en",
    env: cleanEnv(cwd),
  });
  return result.report;
}
