import { basename } from "node:path";
import {
  DEFAULT_PATH_GLOBS,
  DEFAULT_TEST_GLOBS,
  SECRET_PATH_GLOBS,
} from "../config/defaults.ts";
import { type LoadConfigInput, loadConfig } from "../config/load.ts";
import type { ResolvedConfig } from "../config/schema.ts";
import { runExplore } from "../explore/run.ts";
import {
  type DiffMode,
  type DiffSet,
  loadDiff,
  readNewSource,
} from "../git/diff-provider.ts";
import { type ChangedFile, splitSourceLines } from "../git/unified-diff.ts";
import { incrementalSince, writeIncremental } from "../incremental/state.ts";
import { buildProvider } from "../jev/factory.ts";
import { estimateRequestTokens } from "../jev/tokens.ts";
import { dedupeFindings } from "../judge/dedupe.ts";
import { selectRules } from "../judge/pass1.ts";
import { judgePullRequest } from "../judge/pull-request.ts";
import {
  fileRisks,
  type UnitRisk,
  unitRiskFromDimensions,
} from "../judge/risk.ts";
import { decideVerdict, reviewExitCode } from "../judge/verdict.ts";
import { detectLanguage } from "../lang/detect.ts";
import { reviewSlices } from "../lang/vue-sfc.ts";
import { narrateFindings } from "../narrate/run.ts";
import { exportTelemetry } from "../otel/export.ts";
import { loadPlugins } from "../plugins/loader.ts";
import { renderJson } from "../render/json.ts";
import { renderMarkdown } from "../render/markdown.ts";
import { renderSarif } from "../render/sarif.ts";
import { renderTerminal } from "../render/terminal.ts";
import type { Report } from "../report/model.ts";
import { SessionLog } from "../report/session.ts";
import { needsPass2 } from "../rules/compile.ts";
import { loadRules } from "../rules/load.ts";
import type { LoadedRule } from "../rules/schema.ts";
import { gateFile, isTestPath } from "../select/gates.ts";
import {
  alertsOnDiff,
  judgeStaticAlerts,
  loadSarifAlerts,
} from "../static/sarif-filter.ts";
import { enclosingIdentity } from "../treesitter/context.ts";
import {
  drainGrammarWarnings,
  ensureTreesitter,
} from "../treesitter/runtime.ts";
import { buildUnits, type ReviewUnit } from "../units/build.ts";
import type { JsonValue } from "../util/json.ts";
import { round6 } from "../util/json.ts";
import { toolVersion } from "../util/package.ts";
import { mapPool } from "../util/pool.ts";
import {
  deterministicFindings,
  judgeUnit,
  type RequestTrace,
} from "./judge-unit.ts";
import { questionsForPass, requestsFor } from "./questions.ts";
import { buildReviewState } from "./state.ts";

export interface ReviewOptions {
  cwd?: string;
  mode?: DiffMode;
  commit?: string;
  from?: string;
  to?: string;
  paths?: string[];
  configPath?: string;
  provider?: ResolvedConfig["jev"]["provider"];
  providerExplicit?: boolean;
  model?: string;
  profile?: ResolvedConfig["profile"];
  lang?: ResolvedConfig["output"]["language"];
  formats?: Array<"terminal" | "json" | "sarif" | "markdown">;
  out?: { json?: string; sarif?: string; markdown?: string; terminal?: string };
  audience?: "human" | "agent";
  gate?: boolean;
  failOn?: ResolvedConfig["gate"]["failOn"];
  minP?: number;
  preview?: boolean;
  showPayload?: boolean;
  budgetTokens?: number;
  concurrency?: number;
  noCache?: boolean;
  recordDir?: string;
  replayDir?: string;
  replayFallback?: boolean;
  untrusted?: boolean;
  strict?: boolean;
  showUncertain?: ResolvedConfig["output"]["showUncertain"];
  sarifIncludeUncertain?: boolean;
  sarifIn?: string[];
  logPayload?: boolean;
  llm?: boolean;
  explore?: boolean;
  otel?: string;
  incremental?: boolean;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  tty?: boolean;
  ci?: boolean;
}

export interface ReviewResult {
  report: Report;
  exitCode: number;
  terminal: string;
  json: string;
  sarif: string;
  markdown: string;
  traces: RequestTrace[];
}

interface PlannedUnit {
  unit: ReviewUnit;
  state: JsonValue;
  rules: LoadedRule[];
}

export async function runReview(
  options: ReviewOptions = {},
): Promise<ReviewResult> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const config = loadConfig({
    cwd,
    configPath: options.configPath,
    env,
    cli: cliFrom(options),
  });
  if (options.formats && options.formats.length > 0)
    config.output.formats = options.formats;
  if (options.showUncertain)
    config.output.showUncertain = options.showUncertain;
  if (options.sarifIn && options.sarifIn.length > 0)
    config.static.sarif = [...config.static.sarif, ...options.sarifIn];
  await ensureTreesitter();
  const started = (options.now ?? (() => new Date()))();
  const startedMs = started.getTime();
  const registry = await loadPlugins(config, cwd, options.untrusted ?? false);
  const rules = await loadRules(registry.plugins, config, cwd);
  const mode =
    options.mode ??
    (options.commit ? "commit" : options.from ? "range" : "workspace");
  let since: string | undefined;
  let incrementalWarning: string | undefined;
  if (
    options.incremental &&
    mode !== "scan" &&
    (mode === "range" || mode === "workspace")
  ) {
    const resolved = await incrementalSince(cwd, options.to ?? "HEAD");
    since = resolved.since;
    incrementalWarning = resolved.warning;
  }
  const diff = await loadDiff({
    cwd,
    mode,
    commit: options.commit,
    from: options.from,
    to: options.to,
    paths: options.paths,
    since,
  });
  const facts = await detectFacts(registry, cwd);
  const planned = await planFiles(diff, cwd, config, registry, rules, facts);
  const warnings = [...config.warnings, ...drainGrammarWarnings()];
  if (incrementalWarning) warnings.push(incrementalWarning);
  if (options.untrusted && config.static.sarif.length > 0) {
    warnings.push(
      "Untrusted mode: static tools are not executed; reading SARIF input only.",
    );
  }
  const previewPayloads = options.showPayload
    ? payloadsFor(planned.units, config)
    : undefined;
  const deterministic = planned.units.flatMap((item) =>
    deterministicFindings(item.unit, rules, config.output.language, undefined),
  );

  if (options.preview) {
    const report = assemble({
      config,
      diff,
      planned,
      findings: deterministic,
      warnings,
      started,
      durationMs: Math.max(0, Date.now() - startedMs),
      status: "ok",
      stats: {
        requests: 0,
        cachedRequests: 0,
        inputTokens: 0,
        outputTokens: 0,
      },
      model: config.jev.model,
      isAI: false,
      providerName: "preview",
      payloads: previewPayloads,
      estimatedTokens: (previewPayloads ?? []).reduce(
        (sum, item) => sum + item.tokens,
        0,
      ),
    });
    return finish(report, options, config, []);
  }

  const built = await buildProvider({
    config,
    rules,
    cwd,
    env,
    providerExplicit: options.providerExplicit ?? false,
    tty: options.tty ?? false,
    ci: options.ci ?? env.CI === "true",
    replayDir: options.replayDir,
    replayFallback: options.replayFallback,
    recordDir: options.recordDir,
    fetchImpl: options.fetchImpl,
    warnings,
  });
  const session = await SessionLog.open(
    cwd,
    started,
    options.logPayload ?? false,
  );
  let providerFailures = 0;
  let providerSuccesses = 0;
  let attempted = 0;
  let partial = false;
  const traces: RequestTrace[] = [];
  const judgements = await mapPool(
    planned.units,
    config.jev.concurrency,
    async (item) => {
      attempted += 1;
      try {
        const judged = await judgeUnit({
          unit: item.unit,
          rules,
          state: item.state,
          provider: built.provider,
          budget: built.budget,
          model: config.jev.model,
          profile: config.profile,
          language: config.output.language,
          strategy: config.jev.strategy,
          maxRules: config.limits.maxRulesPerUnit,
          warnings,
          onRateLimit: () => built.limiter.penalize(),
        });
        if (judged.skipped) {
          partial = true;
          planned.skipped.push({
            path: item.unit.path,
            reason: "budget",
            unitId: item.unit.id,
          });
        } else if (judged.failed) {
          providerFailures += 1;
          partial = true;
        } else {
          providerSuccesses += 1;
          if (judged.degraded) partial = true;
        }
        traces.push(...judged.traces);
        await session?.write({
          type: "unit",
          unitId: item.unit.id,
          path: item.unit.path,
          skipped: judged.skipped ?? null,
          failed: judged.failed,
          model: judged.model ?? null,
          ...(options.logPayload ? { state: item.state } : {}),
        });
        for (const [index, trace] of judged.traces.entries()) {
          const request = judged.requests[index];
          await session?.write({
            type: "request",
            unitId: trace.unitId,
            path: trace.path,
            pass: trace.pass,
            questionKeys: trace.questionKeys,
            answers: trace.answers,
            usage: trace.usage,
            latencyMs: trace.latencyMs,
            model: trace.model,
            cached: trace.cached,
            ...(options.logPayload
              ? { state: item.state, questions: request?.questions ?? null }
              : {}),
          });
        }
        return judged;
      } catch (error) {
        providerFailures += 1;
        throw error;
      }
    },
  );
  planned.skipped.sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      (a.unitId ?? "").localeCompare(b.unitId ?? ""),
  );
  if (
    attempted > 0 &&
    providerSuccesses === 0 &&
    providerFailures === attempted
  ) {
    const { KestrelError } = await import("../util/errors.ts");
    throw new KestrelError(
      "Every review unit failed after retries.",
      3,
      "provider",
    );
  }
  const findings = dedupeFindings(judgements.flatMap((item) => item.findings));
  let staticSummary: Report["static"];
  if (config.static.sarif.length > 0) {
    const imported = await loadSarifAlerts(config.static.sarif, cwd);
    const onDiff = alertsOnDiff(imported, diff.files, config.static.filterMode);
    const judged = await judgeStaticAlerts({
      alerts: onDiff,
      units: planned.units.map((item) => item.unit),
      provider: built.provider,
      model: config.jev.model,
      config,
      language: config.output.language,
    });
    findings.push(...judged.findings);
    staticSummary = {
      ...judged.summary,
      imported: imported.length,
      onDiff: onDiff.length,
    };
    if (judged.partial) partial = true;
  }
  const risks: UnitRisk[] = planned.units.map((item, index) => ({
    path: item.unit.path,
    unitRisk: unitRiskFromDimensions(judgements[index]?.dimensions ?? {}),
    priority: judgements[index]?.priority ?? 0,
    dimensions: judgements[index]?.dimensions ?? {},
  }));
  const responseModel =
    judgements.find((item) => item.model)?.model ?? config.jev.model;
  const testsChanged = [
    ...new Set(planned.units.flatMap((item) => item.unit.testsChanged)),
  ].sort();
  const pullRequest = await judgePullRequest({
    provider: built.provider,
    model: config.jev.model,
    files: planned.files.map((file) => file.path),
    testsChanged,
    language: config.output.language,
  });
  const narrated = await narrateFindings({
    findings,
    settings: config.llm,
    env,
    provider: built.provider,
    model: config.jev.model,
    fetchImpl: options.fetchImpl,
  });
  if (narrated.warning) warnings.push(narrated.warning);
  const languages = new Map(
    planned.files.map((file) => [file.path, file.language]),
  );
  const reportPaths = new Set(
    narrated.findings
      .filter((finding) => finding.band === "report")
      .map((finding) => finding.location.path),
  );
  let published = narrated.findings;
  if (options.explore) {
    const explored = await runExplore({
      files: fileRisks(risks, languages, reportPaths).filter(
        (file) => file.deepReview,
      ),
      units: planned.units,
      provider: built.provider,
      model: config.jev.model,
      llm: config.llm,
      env,
      language: config.output.language,
      fetchImpl: options.fetchImpl,
    });
    if (explored.warning) warnings.push(explored.warning);
    published = [...narrated.findings, ...explored.findings];
  }
  const report = assemble({
    config,
    diff,
    planned,
    findings: published,
    warnings,
    started,
    durationMs: Math.max(0, Date.now() - startedMs),
    status: partial ? "partial" : "ok",
    stats: built.stats,
    model: responseModel,
    isAI: built.provider.isAI,
    providerName: built.provider.name,
    payloads: previewPayloads,
    risks,
    staticSummary,
    narration: narrated.narration,
    pullRequest,
  });
  if (options.incremental && report.run.status === "ok" && diff.head) {
    await writeIncremental(cwd, diff.head);
  }
  const endpoint = options.otel || env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (endpoint) {
    const failure = await exportTelemetry({
      endpoint,
      traces,
      report,
      fetchImpl: options.fetchImpl,
    });
    if (failure) report.warnings.push(failure);
  }
  return finish(report, options, config, traces);
}

function finish(
  report: Report,
  options: ReviewOptions,
  config: ResolvedConfig,
  traces: RequestTrace[],
): ReviewResult {
  const show = options.showUncertain ?? config.output.showUncertain;
  return {
    report,
    exitCode: reviewExitCode(report.verdict, report.run.status, {
      gate: options.gate ?? false,
      strict: options.strict ?? false,
    }),
    terminal: renderTerminal(report, show),
    json: renderJson(report),
    sarif: renderSarif(report, {
      includeUncertain: options.sarifIncludeUncertain ?? false,
    }),
    markdown: renderMarkdown(report, show),
    traces,
  };
}

function cliFrom(options: ReviewOptions): LoadConfigInput["cli"] {
  return {
    provider: options.provider,
    model: options.model,
    profile: options.profile,
    lang: options.lang,
    budgetTokens: options.budgetTokens,
    concurrency: options.concurrency,
    noCache: options.noCache,
    failOn: options.failOn,
    minP: options.minP,
    llm: options.llm,
  };
}

async function detectFacts(
  registry: Awaited<ReturnType<typeof loadPlugins>>,
  cwd: string,
): Promise<string[]> {
  const facts = new Set<string>();
  for (const plugin of registry.plugins) {
    if (!plugin.facts) continue;
    const found = await plugin.facts.detect({
      root: cwd,
      async readFile(path) {
        const { readFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        try {
          return await readFile(join(cwd, path), "utf8");
        } catch {
          return undefined;
        }
      },
      async listFiles() {
        return [];
      },
    });
    for (const fact of found) facts.add(fact);
  }
  return [...facts].sort();
}

async function planFiles(
  diff: DiffSet,
  cwd: string,
  config: ResolvedConfig,
  registry: Awaited<ReturnType<typeof loadPlugins>>,
  rules: LoadedRule[],
  facts: string[],
): Promise<{
  units: PlannedUnit[];
  skipped: Report["skipped"];
  files: Array<{ path: string; language: string }>;
  diff: DiffSet;
}> {
  const languages = registry.languageList();
  const testGlobs = [
    ...DEFAULT_TEST_GLOBS,
    ...registry.plugins.flatMap((plugin) => plugin.fileClasses?.test ?? []),
  ];
  const generated = registry.plugins.flatMap(
    (plugin) => plugin.fileClasses?.generated ?? [],
  );
  const extraExclude = registry.plugins.flatMap(
    (plugin) => plugin.fileClasses?.exclude ?? [],
  );
  const testPaths = diff.files
    .filter((file) => isTestPath(file.path, testGlobs))
    .map((file) => file.path)
    .sort();
  const units: PlannedUnit[] = [];
  const skipped: Report["skipped"] = [];
  const files: Array<{ path: string; language: string }> = [];
  for (const file of diff.files) {
    const source = await readNewSource(cwd, file, diff);
    const head = source?.slice(0, 2048);
    const languageId = detectLanguage(
      file.path,
      head,
      languages,
      config.languages.overrides,
    );
    const decision = gateFile(file, {
      include: config.files.include,
      exclude: [...config.files.exclude, ...extraExclude],
      reviewTests: config.files.reviewTests,
      maxAddedLinesPerFile: config.limits.maxAddedLinesPerFile,
      secretGlobs: SECRET_PATH_GLOBS,
      defaultGlobs: [...DEFAULT_PATH_GLOBS, ...generated],
      testGlobs,
      generatedGlobs: generated,
      languageId,
    });
    if (decision.decision === "skip" || !languageId) {
      skipped.push({
        path: file.path,
        reason: decision.reason ?? "unsupported",
      });
      continue;
    }
    const sourceLines =
      source === undefined ? sourceFromHunks(file) : splitSourceLines(source);
    const sourceText = sourceLines.join("\n");
    const slices = reviewSlices(file, languageId, sourceText);
    files.push({ path: file.path, language: languageId });
    for (const slice of slices) {
      const plugin = registry.pluginForLanguage(slice.languageId);
      const built = buildUnits(
        slice.file,
        sourceLines,
        slice.languageId,
        plugin?.id ?? "core",
        config.limits,
        {
          frameworks: facts,
          testsChanged: relatedTests(file.path, testPaths),
          enclosingAt: (line) =>
            enclosingIdentity(sourceText, slice.languageId, line),
        },
      );
      for (const unit of built) {
        const selected = selectRules(
          unit,
          rules,
          config.limits.maxRulesPerUnit,
        ).selected;
        const context = plugin?.context
          ? await plugin.context.build({
              languageId: slice.languageId,
              file: { path: file.path, newSource: source },
              unit: {
                startLine: unit.startLine,
                endLine: unit.endLine,
                addedLines: unit.addedLineNumbers,
              },
              maxEnclosingLines: config.privacy.maxEnclosingLines,
            })
          : undefined;
        const state = buildReviewState({
          unit,
          rules: selected,
          context,
          redact: config.privacy.redactSecrets,
        });
        units.push({ unit, state, rules: selected });
      }
    }
  }
  skipped.sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      (a.unitId ?? "").localeCompare(b.unitId ?? ""),
  );
  return { units, skipped, files, diff };
}

function sourceFromHunks(file: ChangedFile): string[] {
  const max = file.addedLineNumbers.reduce(
    (value, line) => Math.max(value, line),
    0,
  );
  const lines = Array.from({ length: max }, () => "");
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.newNo !== undefined) lines[line.newNo - 1] = line.text;
    }
  }
  return lines;
}

function relatedTests(path: string, testPaths: string[]): string[] {
  const stem = basename(path).replace(/\.[^.]+$/, "");
  return testPaths.filter(
    (item) => item !== path && basename(item).includes(stem),
  );
}

function payloadsFor(
  units: PlannedUnit[],
  config: ResolvedConfig,
): NonNullable<Report["preview"]>["payloads"] {
  const payloads: NonNullable<NonNullable<Report["preview"]>["payloads"]> = [];
  for (const item of units) {
    const anchors = new Map(
      item.rules.map((rule) => [
        rule.id,
        [] as import("../rules/trigger.ts").Anchor[],
      ]),
    );
    const selection = selectRules(
      item.unit,
      item.rules,
      config.limits.maxRulesPerUnit,
    );
    for (const [id, match] of selection.matches) anchors.set(id, match.anchors);
    const pass1 = requestsFor(
      config.jev.model,
      item.state,
      questionsForPass({
        rules: selection.selected,
        anchors,
        addedLineNumbers: item.unit.addedLineNumbers,
        strategy: config.jev.strategy,
        pass: 1,
      }),
    );
    for (const request of pass1) {
      payloads.push({
        unitId: item.unit.id,
        path: item.unit.path,
        state: request.state,
        questions: request.questions,
        tokens: estimateRequestTokens(request.state, request.questions),
      });
    }
    const pass2Rules = selection.selected.filter((rule) =>
      needsPass2(rule, anchors.get(rule.id) ?? []),
    );
    if (config.jev.strategy === "two-pass" && pass2Rules.length > 0) {
      const pass2 = requestsFor(
        config.jev.model,
        item.state,
        questionsForPass({
          rules: pass2Rules,
          anchors,
          addedLineNumbers: item.unit.addedLineNumbers,
          strategy: config.jev.strategy,
          pass: 2,
        }),
      );
      for (const request of pass2) {
        payloads.push({
          unitId: `${item.unit.id}#pass2`,
          path: item.unit.path,
          state: request.state,
          questions: request.questions,
          tokens: estimateRequestTokens(request.state, request.questions),
        });
      }
    }
  }
  return payloads;
}

function assemble(input: {
  config: ResolvedConfig;
  diff: DiffSet;
  planned: {
    units: PlannedUnit[];
    skipped: Report["skipped"];
    files: Array<{ path: string; language: string }>;
  };
  findings: Report["findings"];
  warnings: string[];
  started: Date;
  durationMs: number;
  status: "ok" | "partial";
  stats: {
    requests: number;
    cachedRequests: number;
    inputTokens: number;
    outputTokens: number;
  };
  model: string;
  isAI: boolean;
  providerName: string;
  payloads?: NonNullable<Report["preview"]>["payloads"];
  estimatedTokens?: number;
  risks?: UnitRisk[];
  staticSummary?: Report["static"];
  narration?: Report["narration"];
  pullRequest?: Report["pullRequest"];
}): Report {
  const findings = dedupeFindings(input.findings);
  const reportPaths = new Set(
    findings
      .filter((finding) => finding.band === "report")
      .map((finding) => finding.location.path),
  );
  const languages = new Map(
    input.planned.files.map((file) => [file.path, file.language]),
  );
  const risks =
    input.risks ??
    input.planned.units.map((item) => ({
      path: item.unit.path,
      unitRisk: 0,
      priority: 0,
      dimensions: {},
    }));
  const fileRows = fileRisks(risks, languages, reportPaths);
  const bySeverity = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const finding of findings) {
    if (finding.band === "report") bySeverity[finding.severity] += 1;
  }
  const price = input.config.jev.price.inputPerMTok;
  const estimatedTokens = input.estimatedTokens ?? input.stats.inputTokens;
  const verdict = decideVerdict(findings, input.config.gate);
  const report: Report = {
    schemaVersion: 1,
    tool: { name: "kestrel", version: toolVersion() },
    provider: {
      name: input.providerName,
      model: input.model,
      isAI: input.isAI,
    },
    run: {
      mode: input.diff.mode,
      ...(input.diff.base ? { base: input.diff.base } : {}),
      ...(input.diff.head ? { head: input.diff.head } : {}),
      startedAt: input.started.toISOString(),
      durationMs: input.durationMs,
      status: input.status,
      requests: input.stats.requests,
      cachedRequests: input.stats.cachedRequests,
      tokens: {
        input: input.stats.inputTokens,
        output: input.stats.outputTokens,
      },
      costUSD: round6((input.stats.inputTokens * price) / 1_000_000),
      profile: input.config.profile,
      language: input.config.output.language,
    },
    verdict,
    summary: {
      filesChanged: input.diff.files.length,
      filesReviewed: input.planned.files.length,
      units: input.planned.units.length,
      findings: {
        report: findings.filter((finding) => finding.band === "report").length,
        uncertain: findings.filter((finding) => finding.band === "uncertain")
          .length,
      },
      bySeverity,
    },
    findings,
    files: fileRows.map((file) => ({
      path: file.path,
      language: file.language,
      risk: file.risk,
      units: file.units,
    })),
    skipped: input.planned.skipped,
    handoff: {
      deepReview: fileRows
        .filter((file) => file.deepReview)
        .map((file) => ({
          path: file.path,
          risk: file.risk,
          dimensions: file.dimensions,
        })),
    },
    warnings: [...new Set(input.warnings)],
    ...(input.staticSummary ? { static: input.staticSummary } : {}),
    ...(input.narration ? { narration: input.narration } : {}),
    ...(input.pullRequest ? { pullRequest: input.pullRequest } : {}),
  };
  if (input.payloads) {
    report.preview = {
      estimatedTokens,
      estimatedCostUSD: round6((estimatedTokens * price) / 1_000_000),
      files: [
        ...input.planned.files.map((file) => ({
          path: file.path,
          decision: "review" as const,
          language: file.language,
          addedLines:
            input.diff.files.find((item) => item.path === file.path)
              ?.addedLineNumbers ?? [],
          units: input.planned.units.filter(
            (item) => item.unit.path === file.path,
          ).length,
        })),
        ...input.planned.skipped.map((file) => ({
          path: file.path,
          decision: "skip" as const,
          reason: file.reason,
          addedLines: [] as number[],
          units: 0,
        })),
      ],
      payloads: input.payloads,
    };
  }
  return report;
}
