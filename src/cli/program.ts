import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command, CommanderError } from "commander";
import { CONFIG_TEMPLATE } from "../config/defaults.ts";
import { loadConfig, maskConfig } from "../config/load.ts";
import { FileCache } from "../jev/cache.ts";
import { missingKeyMessage } from "../jev/factory.ts";
import { type ReviewOptions, runReview } from "../pipeline/review.ts";
import { loadPlugins } from "../plugins/loader.ts";
import { lintRules, RULE_SCAFFOLD } from "../rules/lint.ts";
import { loadRules } from "../rules/load.ts";
import { testRules } from "../rules/test-runner.ts";
import { isKestrelError, KestrelError } from "../util/errors.ts";
import { stableStringify } from "../util/json.ts";
import { toolVersion } from "../util/package.ts";

export const program = new Command();
program.exitOverride();
program
  .name("kestrel")
  .description(
    "Kestrel Review — calibrated code review. Judgments from Jev, comments from rule templates.",
  )
  .version(toolVersion());

const formats = ["terminal", "json", "sarif", "markdown"] as const;
type Format = (typeof formats)[number];

program
  .command("review")
  .description("Review a git diff")
  .argument("[paths...]")
  .option("--staged", "Review the index")
  .option("--commit <rev>", "Review one commit")
  .option("--from <rev>", "Review from the merge-base with this revision")
  .option("--to <rev>", "Head revision for --from (default HEAD)")
  .option("--provider <name>", "typesafe | http | mock | replay")
  .option("--model <model>")
  .option("--profile <name>", "chill | balanced | assertive")
  .option("--lang <lang>", "zh-CN | en")
  .option(
    "--format <format>",
    "terminal, json, sarif, or markdown (repeatable)",
    collectFormat,
    [] as string[],
  )
  .option("--out <file>", "Write the primary format to this file")
  .option("--out-json <file>")
  .option("--out-sarif <file>")
  .option("--out-md <file>")
  .option("--audience <audience>", "human | agent")
  .option("--gate", "Exit 1 when the verdict is request_changes")
  .option("--fail-on <severity>", "low | medium | high | critical")
  .option(
    "--min-p <n>",
    "Minimum probability for a blocking finding",
    parseFloat,
  )
  .option("--preview", "Do not call a provider")
  .option("--show-payload", "Include redacted requests in the report")
  .option("--budget-tokens <n>", "Input-token budget", parseIntArg)
  .option("--concurrency <n>", "Parallel unit reviews", parseIntArg)
  .option("--no-cache", "Disable the response cache")
  .option("--record <dir>", "Write a replay cassette")
  .option("--replay <dir>", "Read replay cassettes")
  .option("--replay-fallback", "On a cassette miss, use the mock provider")
  .option("--untrusted", "Do not load third-party code plugins")
  .option("--strict", "Exit 4 when the run is partial")
  .option("--show-uncertain <mode>", "hidden | collapsed | expanded")
  .option("--sarif-include-uncertain")
  .option(
    "--sarif-in <glob>",
    "Read static-analyzer SARIF and filter it (repeatable)",
    collectString,
    [] as string[],
  )
  .option("--log-payload", "Store raw state in the session log")
  .option("--config <path>")
  .action(async (paths: string[], opts: Record<string, unknown>) => {
    const chosen = (opts.format as string[]).filter((item): item is Format =>
      (formats as readonly string[]).includes(item),
    );
    const provider = opts.provider as ReviewOptions["provider"] | undefined;
    if (
      provider &&
      !["typesafe", "http", "mock", "replay"].includes(provider)
    ) {
      fail(2, `Invalid --provider ${provider}`);
    }
    const result = await runReview({
      cwd: process.cwd(),
      paths,
      mode: opts.staged
        ? "staged"
        : opts.commit
          ? "commit"
          : opts.from
            ? "range"
            : "workspace",
      commit: opts.commit as string | undefined,
      from: opts.from as string | undefined,
      to: opts.to as string | undefined,
      provider,
      providerExplicit: Boolean(provider),
      model: opts.model as string | undefined,
      profile: opts.profile as ReviewOptions["profile"],
      lang: opts.lang as ReviewOptions["lang"],
      formats: chosen.length > 0 ? chosen : undefined,
      audience: opts.audience as ReviewOptions["audience"],
      gate: Boolean(opts.gate),
      failOn: opts.failOn as ReviewOptions["failOn"],
      minP: opts.minP as number | undefined,
      preview: Boolean(opts.preview),
      showPayload: Boolean(opts.showPayload),
      budgetTokens: opts.budgetTokens as number | undefined,
      concurrency: opts.concurrency as number | undefined,
      noCache: opts.cache === false,
      recordDir: opts.record as string | undefined,
      replayDir: opts.replay as string | undefined,
      replayFallback: Boolean(opts.replayFallback),
      untrusted: Boolean(opts.untrusted),
      strict: Boolean(opts.strict),
      showUncertain: opts.showUncertain as ReviewOptions["showUncertain"],
      sarifIncludeUncertain: Boolean(opts.sarifIncludeUncertain),
      sarifIn: (opts.sarifIn as string[] | undefined) ?? [],
      logPayload: Boolean(opts.logPayload),
      configPath: opts.config as string | undefined,
      tty: Boolean(process.stdout.isTTY),
      ci: process.env.CI === "true",
      env: process.env,
    });
    const list =
      chosen.length > 0
        ? chosen
        : result.report.run
          ? await formatsFromConfig(opts.config as string | undefined)
          : ["terminal" as Format];
    await emit(result, list.length > 0 ? list : ["terminal"], {
      terminal:
        opts.out && list[0] === "terminal" ? (opts.out as string) : undefined,
      json:
        (opts.outJson as string | undefined) ??
        (list.length === 1 && list[0] === "json"
          ? (opts.out as string | undefined)
          : undefined),
      sarif:
        (opts.outSarif as string | undefined) ??
        (list.length === 1 && list[0] === "sarif"
          ? (opts.out as string | undefined)
          : undefined),
      markdown:
        (opts.outMd as string | undefined) ??
        (list.length === 1 && list[0] === "markdown"
          ? (opts.out as string | undefined)
          : undefined),
    });
    process.exitCode = result.exitCode;
  });

const rules = program
  .command("rules")
  .description("Inspect and test review rules");

rules
  .command("list")
  .option("--lang <language>")
  .option("--config <path>")
  .action(async (opts: { lang?: string; config?: string }) => {
    const loaded = await builtinRules(opts.config);
    const rows = loaded.filter(
      (rule) =>
        !opts.lang ||
        !rule.applies?.languages ||
        rule.applies.languages.includes(opts.lang),
    );
    for (const rule of rows) {
      process.stdout.write(
        `${rule.id}\t${rule.title.en}\t${(rule.applies?.languages ?? ["*"]).join(",")}\n`,
      );
    }
  });

rules
  .command("show")
  .argument("<id>")
  .option("--config <path>")
  .action(async (id: string, opts: { config?: string }) => {
    const loaded = await builtinRules(opts.config);
    const rule = loaded.find((item) => item.id === id);
    if (!rule) fail(2, `Unknown rule ${id}`);
    const { compileRuleQuestions } = await import("../rules/compile.ts");
    process.stdout.write(
      stableStringify({ rule, questions: compileRuleQuestions(rule) }),
    );
  });

rules
  .command("lint")
  .option("--config <path>")
  .action(async (opts: { config?: string }) => {
    const issues = lintRules(await builtinRules(opts.config));
    if (issues.length === 0) {
      process.stdout.write("rules lint: clean\n");
      return;
    }
    for (const issue of issues)
      process.stderr.write(`${issue.ruleId}: ${issue.message}\n`);
    process.exitCode = 1;
  });

rules
  .command("check")
  .option("--config <path>")
  .action(async (opts: { config?: string }) => {
    const issues = lintRules(await builtinRules(opts.config));
    if (issues.length === 0) {
      process.stdout.write("rules check: clean\n");
      return;
    }
    for (const issue of issues)
      process.stderr.write(`${issue.ruleId}: ${issue.message}\n`);
    process.exitCode = 1;
  });

rules
  .command("test")
  .option("--live", "Call the real Jev API (requires TYPESAFE_API_KEY)")
  .option("--record <dir>", "Record live responses into a cassette directory")
  .option("--replay <dir>", "Replay cassettes instead of calling Jev")
  .option("--pack <glob>", "Extra rule pack glob")
  .option("--config <path>")
  .option("--lang <lang>", "zh-CN | en")
  .action(
    async (opts: {
      live?: boolean;
      record?: string;
      replay?: string;
      pack?: string;
      config?: string;
      lang?: "zh-CN" | "en";
    }) => {
      if (opts.live && !process.env.TYPESAFE_API_KEY)
        fail(3, missingKeyMessage(opts.lang ?? "zh-CN"));
      const loaded = loadConfig({
        cwd: process.cwd(),
        configPath: opts.config,
      });
      if (opts.pack) loaded.rulePacks = [opts.pack];
      else loaded.rulePacks = [];
      const registry = await loadPlugins(loaded, process.cwd(), true);
      const rules = await loadRules(registry.plugins, loaded, process.cwd());
      let provider: import("../jev/types.ts").JevProvider | undefined;
      if (opts.live || opts.replay) {
        const { buildProvider } = await import("../jev/factory.ts");
        if (opts.replay) loaded.jev.provider = "replay";
        if (opts.live) loaded.jev.provider = "typesafe";
        const built = await buildProvider({
          config: loaded,
          rules,
          cwd: process.cwd(),
          env: process.env,
          providerExplicit: true,
          tty: false,
          ci: true,
          replayDir: opts.replay,
          replayFallback: !opts.live,
          recordDir: opts.record,
          warnings: [],
        });
        provider = built.provider;
      }
      const report = await testRules(rules, opts.lang ?? "en", { provider });
      if (opts.live || opts.replay) {
        for (const sample of report.distribution) {
          process.stdout.write(
            `${sample.ruleId} ${sample.kind}[${sample.index}] p=${sample.probability.toFixed(2)} band=${sample.band}\n`,
          );
        }
      }
      process.stdout.write(
        `rules test: ${report.passed} passed, ${report.failed.length} failed\n`,
      );
      for (const failure of report.failed) {
        process.stderr.write(
          `${failure.ruleId} ${failure.kind}[${failure.index}]: ${failure.message}\n`,
        );
      }
      if (report.failed.length > 0) process.exitCode = 1;
    },
  );

rules
  .command("new")
  .argument("<id>", "Rule id, for example local.security.my-rule")
  .action((id: string) => {
    process.stdout.write(RULE_SCAFFOLD.replace("{{id}}", id));
  });

const plugins = program.command("plugins").description("List language plugins");
plugins.command("list").action(async () => {
  const registry = await loadPlugins(
    loadConfig({ cwd: process.cwd() }),
    process.cwd(),
    true,
  );
  for (const plugin of registry.plugins) {
    process.stdout.write(
      `${plugin.id}\t${plugin.name}\t${plugin.languages.map((language) => language.id).join(",")}\n`,
    );
  }
});
plugins
  .command("info")
  .argument("<id>")
  .action(async (id: string) => {
    const registry = await loadPlugins(
      loadConfig({ cwd: process.cwd() }),
      process.cwd(),
      true,
    );
    const plugin = registry.get(id);
    if (!plugin) fail(2, `Unknown plugin ${id}`);
    process.stdout.write(
      stableStringify({
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        languages: plugin.languages.map((language) => language.id),
        rulePacks: (plugin.rulePacks ?? []).map(
          (pack) => pack.path ?? "(inline)",
        ),
      }),
    );
  });

const config = program.command("config").description("Project configuration");
config.command("init").action(async () => {
  const path = resolve(process.cwd(), ".kestrel.yml");
  const { existsSync } = await import("node:fs");
  if (existsSync(path)) fail(2, `${path} already exists`);
  await writeFile(path, CONFIG_TEMPLATE);
  process.stdout.write(`wrote ${path}\n`);
});
config
  .command("print")
  .option("--config <path>")
  .action((opts: { config?: string }) => {
    const loaded = loadConfig({ cwd: process.cwd(), configPath: opts.config });
    process.stdout.write(stableStringify(maskConfig(loaded)));
  });
config
  .command("validate")
  .option("--config <path>")
  .action((opts: { config?: string }) => {
    loadConfig({ cwd: process.cwd(), configPath: opts.config });
    process.stdout.write("config valid\n");
  });

const cache = program.command("cache").description("Response cache");
cache.command("stats").action(async () => {
  const loaded = loadConfig({ cwd: process.cwd() });
  const store = new FileCache(
    resolve(process.cwd(), loaded.jev.cache.dir),
    loaded.jev.cache.ttlDays * 86400000,
  );
  process.stdout.write(stableStringify(await store.stats()));
});
program
  .command("explain")
  .description(
    "Show the questions, answers, and probabilities behind a finding",
  )
  .argument("<findingId>")
  .requiredOption("--report <file>", "JSON report from kestrel review")
  .action(async (findingId: string, opts: { report: string }) => {
    const { readFile } = await import("node:fs/promises");
    const { parseReport } = await import("../report/model.ts");
    const { explainFinding } = await import("../explain/run.ts");
    let report: ReturnType<typeof parseReport>;
    try {
      report = parseReport(JSON.parse(await readFile(opts.report, "utf8")));
    } catch (error) {
      fail(
        2,
        `Cannot read report ${opts.report}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const text = explainFinding(report, findingId);
    if (!text) fail(2, `Finding ${findingId} is not in ${opts.report}`);
    process.stdout.write(text);
  });

program
  .command("doctor")
  .description(
    "Check git, Node, the API key, model reachability, and the cache",
  )
  .option("--config <path>")
  .action(async (opts: { config?: string }) => {
    const { runDoctor } = await import("../doctor/run.ts");
    const loaded = loadConfig({ cwd: process.cwd(), configPath: opts.config });
    const result = await runDoctor({
      cwd: process.cwd(),
      config: loaded,
      env: process.env,
    });
    process.stdout.write(result.text);
    process.exitCode = result.exitCode;
  });

const github = program
  .command("github")
  .description("GitHub pull request integration");
github
  .command("post")
  .description("Post review comments for a JSON report")
  .requiredOption("--report <file>", "JSON report from kestrel review")
  .option("--pr <n>", "Pull request number", parseIntArg)
  .option("--sticky", "Create or update the summary comment")
  .option("--summary-only", "Do not post inline comments")
  .option("--event <event>", "auto | COMMENT | REQUEST_CHANGES", "auto")
  .option("--strict", "Exit 4 when the GitHub API request fails")
  .action(async (opts: Record<string, unknown>) => {
    const { readFile } = await import("node:fs/promises");
    const { parseReport } = await import("../report/model.ts");
    const { renderMarkdown } = await import("../render/markdown.ts");
    const { postGitHubReview, pullRequestNumber } = await import(
      "../github/post.ts"
    );
    const event = String(opts.event ?? "auto");
    if (!["auto", "COMMENT", "REQUEST_CHANGES"].includes(event))
      fail(2, `Invalid --event ${event}`);
    const token = process.env.GITHUB_TOKEN;
    if (!token) fail(2, "GITHUB_TOKEN is required to post a review.");
    const repository = process.env.GITHUB_REPOSITORY;
    if (!repository) fail(2, "GITHUB_REPOSITORY is required (owner/name).");
    let report: ReturnType<typeof parseReport>;
    try {
      report = parseReport(
        JSON.parse(await readFile(String(opts.report), "utf8")),
      );
    } catch (error) {
      fail(
        2,
        `Cannot read report: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const pr = await pullRequestNumber(
      opts.pr as number | undefined,
      process.env.GITHUB_EVENT_PATH,
    );
    const result = await postGitHubReview({
      report,
      summaryBody: renderMarkdown(report, "collapsed"),
      repository,
      pr,
      token,
      event: event as "auto" | "COMMENT" | "REQUEST_CHANGES",
      summaryOnly: Boolean(opts.summaryOnly),
      sticky: Boolean(opts.sticky),
      strict: Boolean(opts.strict),
    });
    for (const warning of result.warnings) process.stderr.write(`${warning}\n`);
    process.stdout.write(
      `github post: event=${result.event} comments=${result.postedComments} duplicates=${result.skippedDuplicates}${result.downgraded ? " downgraded=COMMENT" : ""}\n`,
    );
    process.exitCode = result.exitCode;
  });

cache.command("clear").action(async () => {
  const loaded = loadConfig({ cwd: process.cwd() });
  const store = new FileCache(
    resolve(process.cwd(), loaded.jev.cache.dir),
    loaded.jev.cache.ttlDays * 86400000,
  );
  await store.clear();
  process.stdout.write("cache cleared\n");
});

export async function runCli(argv: string[]): Promise<number> {
  process.exitCode = undefined;
  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (isKestrelError(error)) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = error.exitCode;
    } else if (error instanceof CommanderError) {
      process.exitCode = error.exitCode;
    } else {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 2;
    }
  }
  return process.exitCode ?? 0;
}

function collectString(value: string, previous: string[]): string[] {
  return previous.concat(value);
}

function collectFormat(value: string, previous: string[]): string[] {
  return previous.concat(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function parseIntArg(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) fail(2, `Expected an integer, got ${value}`);
  return parsed;
}

function fail(code: 2 | 3 | 4, message: string): never {
  throw new KestrelError(message, code, code === 3 ? "auth" : "usage");
}

async function builtinRules(configPath?: string) {
  const loaded = loadConfig({
    cwd: process.cwd(),
    configPath,
    env: { ...process.env, KESTREL_PROVIDER: process.env.KESTREL_PROVIDER },
  });
  loaded.rulePacks = [];
  const registry = await loadPlugins(loaded, process.cwd(), true);
  return loadRules(registry.plugins, loaded, process.cwd());
}

async function formatsFromConfig(configPath?: string): Promise<Format[]> {
  const loaded = loadConfig({ cwd: process.cwd(), configPath });
  return loaded.output.formats;
}

async function emit(
  result: Awaited<ReturnType<typeof runReview>>,
  list: Format[],
  outs: { terminal?: string; json?: string; sarif?: string; markdown?: string },
): Promise<void> {
  const bodies: Record<Format, string> = {
    terminal: result.terminal,
    json: result.json,
    sarif: result.sarif,
    markdown: result.markdown,
  };
  let stdoutUsed = false;
  for (const format of list) {
    const target = outs[format];
    if (target) {
      await writeFile(target, bodies[format]);
      continue;
    }
    if (!stdoutUsed) {
      process.stdout.write(bodies[format]);
      stdoutUsed = true;
      continue;
    }
    process.stderr.write(
      `No output path for ${format}. Pass --out-${format === "markdown" ? "md" : format}.\n`,
    );
  }
}
