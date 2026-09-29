import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/program.ts";
import { cleanEnv, git, initRepo, write } from "../helpers/git-repo.ts";

const originalCwd = process.cwd();
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

afterEach(() => {
  process.chdir(originalCwd);
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  globalThis.fetch = originalFetch;
});

async function cli(
  args: string[],
  cwd: string,
  extra: NodeJS.ProcessEnv = {},
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
  const env = cleanEnv(cwd, extra);
  for (const key of [
    "GITHUB_TOKEN",
    "GITHUB_REPOSITORY",
    "GITHUB_EVENT_PATH",
  ]) {
    if (!(key in extra)) delete env[key];
  }
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
  try {
    const code = await runCli(["node", "kestrel", ...args]);
    return { code, out: out.join(""), err: err.join("") };
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
  }
}

describe("kestrel commands", () => {
  it("prints help, version, and usage errors without exiting the process", async () => {
    const cwd = await initRepo();
    const help = await cli(["--help"], cwd);
    expect(help.code).toBe(0);
    expect(help.out).toMatch(/review/);
    const version = await cli(["--version"], cwd);
    expect(version.code).toBe(0);
    expect(version.out).toMatch(/\d+\.\d+\.\d+/);
    const unknown = await cli(["nope"], cwd);
    expect(unknown.code).not.toBe(0);
    const provider = await cli(["review", "--provider", "guess"], cwd);
    expect(provider.code).toBe(2);
    expect(provider.err).toMatch(/Invalid --provider/);
    const budget = await cli(["review", "--budget-tokens", "nope"], cwd);
    expect(budget.code).toBe(2);
    expect(budget.err).toMatch(/integer/);
  });

  it("reviews a commit, explains a finding, and writes every format", async () => {
    const cwd = await initRepo();
    await write(
      cwd,
      "src/user.ts",
      [
        'const key = "AKIAIOSFODNN7EXAMPLE";',
        'const sql = "SELECT * FROM users WHERE id = " + id;',
        "debugger;",
        "",
      ].join("\n"),
    );
    await write(
      cwd,
      "reports/eslint.sarif.json",
      JSON.stringify({
        version: "2.1.0",
        runs: [
          {
            tool: { driver: { name: "ESLint" } },
            results: [
              {
                ruleId: "no-eval",
                level: "error",
                message: { text: "eval can be harmful." },
                locations: [
                  {
                    physicalLocation: {
                      artifactLocation: { uri: "src/user.ts" },
                      region: { startLine: 3 },
                    },
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    git(cwd, ["add", "src/user.ts", "reports/eslint.sarif.json"]);
    git(cwd, ["commit", "-m", "add user"]);
    const review = await cli(
      [
        "review",
        "--commit",
        "HEAD",
        "--provider",
        "mock",
        "--lang",
        "en",
        "--show-uncertain",
        "expanded",
        "--format",
        "terminal,json,sarif,markdown",
        "--out-json",
        "kestrel.json",
        "--out-sarif",
        "kestrel.sarif",
        "--out-md",
        "kestrel.md",
        "--sarif-in",
        "reports/*.sarif.json",
        "--gate",
        "--fail-on",
        "high",
      ],
      cwd,
    );
    expect(review.out).toMatch(/MOCK/);
    expect(review.code === 0 || review.code === 1).toBe(true);
    const report = JSON.parse(
      await readFile(join(cwd, "kestrel.json"), "utf8"),
    ) as {
      findings: Array<{ id: string; ruleId: string }>;
      static?: { imported: number };
      verdict: { decision: string };
    };
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.static?.imported).toBe(1);
    expect(await readFile(join(cwd, "kestrel.sarif"), "utf8")).toMatch(/sarif/);
    expect(await readFile(join(cwd, "kestrel.md"), "utf8")).toMatch(
      /kestrel:summary/,
    );
    const finding = report.findings[0];
    expect(finding).toBeDefined();
    if (!finding) return;
    const explained = await cli(
      ["explain", finding.id, "--report", "kestrel.json"],
      cwd,
    );
    expect(explained.code).toBe(0);
    expect(explained.out).toMatch(new RegExp(finding.ruleId));
    const missing = await cli(
      ["explain", "f_missing", "--report", "kestrel.json"],
      cwd,
    );
    expect(missing.code).toBe(2);
    await writeFile(join(cwd, "bad.json"), "{");
    const broken = await cli(["explain", "f", "--report", "bad.json"], cwd);
    expect(broken.code).toBe(2);
    const preview = await cli(
      [
        "review",
        "--commit",
        "HEAD",
        "--provider",
        "mock",
        "--preview",
        "--show-payload",
        "--lang",
        "zh-CN",
        "--format",
        "json",
        "--out",
        "preview.json",
      ],
      cwd,
    );
    expect(preview.code).toBe(0);
    const previewReport = JSON.parse(
      await readFile(join(cwd, "preview.json"), "utf8"),
    ) as { preview?: { payloads: unknown[] } };
    expect(previewReport.preview?.payloads.length).toBeGreaterThan(0);
  });

  it("runs rules, plugins, config, cache, and doctor", async () => {
    const cwd = await initRepo();
    const listed = await cli(["rules", "list", "--lang", "typescript"], cwd);
    expect(listed.code).toBe(0);
    expect(listed.out).toMatch(/ts\./);
    const shown = await cli(["rules", "show", "core.debug.leftover"], cwd);
    expect(shown.code).toBe(0);
    expect(shown.out).toMatch(/debugger|TODO|leftover/i);
    const unknown = await cli(["rules", "show", "no.such.rule"], cwd);
    expect(unknown.code).toBe(2);
    const lint = await cli(["rules", "lint"], cwd);
    expect(lint.code).toBe(0);
    expect(lint.out).toMatch(/clean/);
    const check = await cli(["rules", "check"], cwd);
    expect(check.code).toBe(0);
    const created = await cli(["rules", "new", "local.security.my-rule"], cwd);
    expect(created.out).toMatch(/local.security.my-rule/);
    const tested = await cli(["rules", "test"], cwd);
    expect(tested.code).toBe(0);
    expect(tested.out).toMatch(/passed/);
    await mkdir(join(cwd, "cassettes"));
    const replay = await cli(
      ["rules", "test", "--replay", "cassettes", "--pack", "rules/*.yml"],
      cwd,
    );
    expect(replay.code).toBe(0);
    const live = await cli(["rules", "test", "--live"], cwd);
    expect(live.code).toBe(3);
    expect(live.err).toMatch(/TYPESAFE_API_KEY/);
    const plugins = await cli(["plugins", "list"], cwd);
    expect(plugins.out).toMatch(/typescript/);
    const info = await cli(["plugins", "info", "python"], cwd);
    expect(info.code).toBe(0);
    expect(info.out).toMatch(/python/);
    expect((await cli(["plugins", "info", "missing"], cwd)).code).toBe(2);
    const init = await cli(["config", "init"], cwd);
    expect(init.code).toBe(0);
    expect(await readFile(join(cwd, ".kestrel.yml"), "utf8")).toMatch(
      /profile/,
    );
    expect((await cli(["config", "init"], cwd)).code).toBe(2);
    const printed = await cli(["config", "print"], cwd, {
      TYPESAFE_API_KEY: "secret-value",
    });
    expect(printed.out).toMatch(/\(set\)/);
    expect(printed.out).not.toMatch(/secret-value/);
    expect((await cli(["config", "validate"], cwd)).out).toMatch(/valid/);
    const stats = await cli(["cache", "stats"], cwd);
    expect(stats.code).toBe(0);
    expect((await cli(["cache", "clear"], cwd)).out).toMatch(/cleared/);
    const doctor = await cli(["doctor"], cwd);
    expect(doctor.code).toBe(0);
    expect(doctor.out).toMatch(/node/);
    const outside = await cli(["review", "--provider", "mock"], cwd);
    expect(outside.code).toBe(0);
  });

  it("posts a review with a stubbed GitHub API and reports API failures", async () => {
    const cwd = await initRepo();
    await write(cwd, "src/user.ts", "debugger;\n");
    git(cwd, ["add", "src/user.ts"]);
    git(cwd, ["commit", "-m", "debug"]);
    await cli(
      [
        "review",
        "--commit",
        "HEAD",
        "--provider",
        "mock",
        "--lang",
        "en",
        "--format",
        "json",
        "--out",
        "kestrel.json",
      ],
      cwd,
    );
    const calls: string[] = [];
    globalThis.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/pulls/7/reviews") && init?.method === "POST") {
        return new Response("not permitted to request changes", {
          status: 422,
        });
      }
      if (url.endsWith("/pulls/7/files")) {
        return Response.json([
          {
            filename: "src/user.ts",
            patch: "@@ -0,0 +1 @@\n+debugger;",
          },
        ]);
      }
      if (url.includes("/issues/7/comments") && init?.method === "POST") {
        return Response.json({ id: 1 });
      }
      return Response.json([]);
    }) as typeof fetch;
    const missingToken = await cli(
      ["github", "post", "--report", "kestrel.json", "--pr", "7"],
      cwd,
    );
    expect(missingToken.code).toBe(2);
    const missingRepo = await cli(
      ["github", "post", "--report", "kestrel.json", "--pr", "7"],
      cwd,
      { GITHUB_TOKEN: "token" },
    );
    expect(missingRepo.err).toMatch(/GITHUB_REPOSITORY/);
    const badEvent = await cli(
      ["github", "post", "--report", "kestrel.json", "--event", "APPROVE"],
      cwd,
      { GITHUB_TOKEN: "token", GITHUB_REPOSITORY: "acme/app" },
    );
    expect(badEvent.code).toBe(2);
    const posted = await cli(
      [
        "github",
        "post",
        "--report",
        "kestrel.json",
        "--pr",
        "7",
        "--sticky",
        "--event",
        "REQUEST_CHANGES",
      ],
      cwd,
      { GITHUB_TOKEN: "token", GITHUB_REPOSITORY: "acme/app" },
    );
    expect(posted.code).toBe(0);
    expect(posted.out).toMatch(/downgraded=COMMENT/);
    expect(calls.some((call) => call.startsWith("POST"))).toBe(true);
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const failed = await cli(
      ["github", "post", "--report", "kestrel.json", "--pr", "7", "--strict"],
      cwd,
      { GITHUB_TOKEN: "token", GITHUB_REPOSITORY: "acme/app" },
    );
    expect(failed.code).toBe(4);
    expect(failed.err).toMatch(/network down/);
    await writeFile(
      join(cwd, "event.json"),
      JSON.stringify({ pull_request: { number: 9 } }),
    );
    globalThis.fetch = (async () => Response.json([])) as typeof fetch;
    const fromEvent = await cli(
      ["github", "post", "--report", "kestrel.json", "--summary-only"],
      cwd,
      {
        GITHUB_TOKEN: "token",
        GITHUB_REPOSITORY: "acme/app",
        GITHUB_EVENT_PATH: join(cwd, "event.json"),
      },
    );
    expect(fromEvent.code).toBe(0);
    await writeFile(join(cwd, "event.json"), "{}");
    const noNumber = await cli(
      ["github", "post", "--report", "kestrel.json"],
      cwd,
      {
        GITHUB_TOKEN: "token",
        GITHUB_REPOSITORY: "acme/app",
        GITHUB_EVENT_PATH: join(cwd, "event.json"),
      },
    );
    expect(noNumber.code).toBe(2);
    const noPr = await cli(
      ["github", "post", "--report", "kestrel.json"],
      cwd,
      { GITHUB_TOKEN: "token", GITHUB_REPOSITORY: "acme/app" },
    );
    expect(noPr.code).toBe(2);
  });

  it("rejects a review outside a repository and an unknown revision", async () => {
    const cwd = await initRepo();
    const plain = await mkdtemp(join(tmpdir(), "kestrel-not-git-"));
    const outside = await cli(["review", "--provider", "mock"], plain);
    expect(outside.code).toBe(2);
    expect(outside.err).toMatch(/Not a git repository/);
    const revision = await cli(
      ["review", "--commit", "no-such", "--provider", "mock"],
      cwd,
    );
    expect(revision.code).toBe(2);
  });
});
