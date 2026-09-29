import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ResolvedConfig } from "../config/schema.ts";
import { profileThresholds } from "../config/schema.ts";
import type { JevAnswer } from "../jev/types.ts";
import { effectiveProbability } from "../judge/decide.ts";
import type { RequestTrace } from "../pipeline/judge-unit.ts";
import { runReview } from "../pipeline/review.ts";
import { KestrelError } from "../util/errors.ts";
import { type EvalDataset, loadDataset } from "./dataset.ts";
import {
  compareFusion,
  type FusionRow,
  syntheticFusionStudy,
} from "./fusion.ts";
import {
  classify,
  groupMetrics,
  reliability,
  type ScorePair,
  searchThresholds,
} from "./metrics.ts";
import { filterDataset } from "./plugins.ts";

export interface EvalReport {
  dataset: string;
  kind: EvalDataset["kind"];
  provider: string;
  model: string;
  realModel: boolean;
  banner: string;
  threshold: number;
  overall: ReturnType<typeof classify>;
  byRule: ReturnType<typeof groupMetrics>;
  byPlugin: ReturnType<typeof groupMetrics>;
  reliability: ReturnType<typeof reliability>;
  proposals: ReturnType<typeof searchThresholds>;
  fusion: ReturnType<typeof compareFusion>;
  study: ReturnType<typeof syntheticFusionStudy>;
  unlabeledReports: number;
  catalog?: EvalDataset["catalog"];
  notes: string[];
  applied: boolean;
}

export async function runEval(options: {
  datasetPath: string;
  cwd?: string;
  provider?: ResolvedConfig["jev"]["provider"];
  model?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  calibrate?: boolean;
  apply?: boolean;
  plugin?: string;
  budgetTokens?: number;
  maxRequests?: number;
}): Promise<EvalReport> {
  let dataset = await loadDataset(options.datasetPath);
  if (options.plugin) {
    dataset = filterDataset(dataset, options.plugin);
    if (dataset.cases.length === 0) {
      throw new KestrelError(
        `No dataset cases match plugin ${options.plugin}.`,
        2,
        "usage",
      );
    }
  }
  const scored = await scoreDataset(dataset, options);
  const threshold = profileThresholds.balanced.report;
  const pairs = scored.pairs;
  const overall = classify(pairs, threshold);
  const realModel = scored.realModel;
  const banner = realModel
    ? `Live Jev calibration for ${scored.model}. These numbers can be recorded and applied.`
    : "MOCK CALIBRATION — these numbers are not from Jev. They describe the deterministic mock provider only.";
  const fusionRows = scored.rows;
  const report: EvalReport = {
    dataset: dataset.name,
    kind: dataset.kind,
    provider: scored.provider,
    model: scored.model,
    realModel,
    banner,
    threshold,
    overall,
    byRule: groupMetrics(pairs, threshold, (pair) => pair.ruleId),
    byPlugin: groupMetrics(pairs, threshold, (pair) => pair.pluginId),
    reliability: reliability(pairs),
    proposals: searchThresholds(pairs),
    fusion: compareFusion(fusionRows, threshold),
    study: syntheticFusionStudy(),
    unlabeledReports: scored.unlabeled,
    ...(dataset.catalog ? { catalog: dataset.catalog } : {}),
    notes: dataset.notes,
    applied: false,
  };
  if (options.calibrate && options.apply) {
    if (!realModel) {
      report.notes = [
        ...report.notes,
        "Refusing to apply mock calibration to profile thresholds.",
      ];
    } else {
      report.applied = true;
      report.notes = [
        ...report.notes,
        `Applied live proposal report=${report.proposals.balanced.report} uncertain=${report.proposals.balanced.uncertain}.`,
      ];
    }
  }
  return report;
}

export function renderEval(report: EvalReport): string {
  const lines = [
    report.banner,
    `dataset ${report.dataset} (${report.kind}) provider=${report.provider} model=${report.model} realModel=${report.realModel}`,
    `threshold ${report.threshold}`,
    `precision ${report.overall.precision.toFixed(3)} recall ${report.overall.recall.toFixed(3)} f1 ${report.overall.f1.toFixed(3)} fpr ${report.overall.falsePositiveRate.toFixed(3)}`,
    `tp ${report.overall.tp} fp ${report.overall.fp} fn ${report.overall.fn} tn ${report.overall.tn} unlabeledReports ${report.unlabeledReports}`,
    `ece ${report.reliability.ece.toFixed(3)}`,
    "by plugin:",
  ];
  for (const [plugin, metrics] of Object.entries(report.byPlugin)) {
    lines.push(
      `  ${plugin} p=${metrics.precision.toFixed(3)} r=${metrics.recall.toFixed(3)} f1=${metrics.f1.toFixed(3)} fp=${metrics.fp}`,
    );
  }
  lines.push("by rule:");
  for (const [rule, metrics] of Object.entries(report.byRule)) {
    lines.push(
      `  ${rule} p=${metrics.precision.toFixed(3)} r=${metrics.recall.toFixed(3)} f1=${metrics.f1.toFixed(3)} fp=${metrics.fp}`,
    );
  }
  const proposed = report.proposals.balanced;
  lines.push(
    `proposed balanced report=${proposed.report} uncertain=${proposed.uncertain} f1=${proposed.f1.toFixed(3)}`,
  );
  lines.push(
    `fusion adopt=${report.fusion.adopt} heuristicF1=${report.fusion.heuristic.f1.toFixed(3)} logisticF1=${report.fusion.logistic.f1.toFixed(3)} heuristicECE=${report.fusion.heuristic.ece.toFixed(3)} logisticECE=${report.fusion.logistic.ece.toFixed(3)}`,
  );
  lines.push(
    `study adopt=${report.study.adopt} heuristicECE=${report.study.heuristic.ece.toFixed(3)} logisticECE=${report.study.logistic.ece.toFixed(3)} (synthetic, not a Jev measurement)`,
  );
  if (report.catalog) {
    lines.push(
      `aacr projects=${report.catalog.projects} comments=${report.catalog.comments} judged=${report.catalog.judged} ${report.catalog.reason}`,
    );
  }
  for (const note of report.notes) lines.push(`note: ${note}`);
  return `${lines.join("\n")}\n`;
}

async function scoreDataset(
  dataset: EvalDataset,
  options: {
    cwd?: string;
    provider?: ResolvedConfig["jev"]["provider"];
    model?: string;
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    plugin?: string;
    budgetTokens?: number;
    maxRequests?: number;
  },
): Promise<{
  pairs: ScorePair[];
  rows: FusionRow[];
  unlabeled: number;
  provider: string;
  model: string;
  realModel: boolean;
}> {
  if (dataset.cases.length === 0) {
    return {
      pairs: [],
      rows: [],
      unlabeled: 0,
      provider: options.provider ?? "mock",
      model: options.model ?? "mock-1",
      realModel: false,
    };
  }
  const root = await mkdtemp(join(tmpdir(), "kestrel-eval-"));
  for (const item of dataset.cases) {
    const file = join(root, item.path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, item.source);
  }
  const result = await runReview({
    cwd: root,
    mode: "scan",
    paths: dataset.cases.map((item) => item.path),
    provider: options.provider ?? "mock",
    providerExplicit: true,
    model: options.model,
    lang: "en",
    noCache: true,
    env: options.env ?? {},
    fetchImpl: options.fetchImpl,
    ...(options.plugin ? { onlyPlugin: options.plugin } : {}),
    ...(options.budgetTokens !== undefined
      ? { budgetTokens: options.budgetTokens }
      : {}),
    ...(options.maxRequests !== undefined
      ? { maxRequests: options.maxRequests }
      : {}),
    tty: false,
    ci: true,
  });
  const traces = result.traces;
  return pairsFrom(dataset, traces, result.report);
}

function pairsFrom(
  dataset: EvalDataset,
  traces: RequestTrace[],
  report: {
    provider: { name: string; model: string; isAI: boolean };
    findings: Array<{ ruleId: string; location: { path: string } }>;
  },
): {
  pairs: ScorePair[];
  rows: FusionRow[];
  unlabeled: number;
  provider: string;
  model: string;
  realModel: boolean;
} {
  const scores = new Map<
    string,
    { pEff: number; pMain: number; guards: FusionRow["guards"] }
  >();
  for (const trace of traces) {
    if (trace.pass !== 1) continue;
    for (const [key, answer] of Object.entries(trace.answers)) {
      if (!key.startsWith("r.") || answer.type !== "noul") continue;
      const ruleId = key.slice(2);
      const guards = guardsFor(ruleId, trace.answers);
      const pEff = effectiveProbability(answer.noul, guards);
      const id = `${trace.path}\0${ruleId}`;
      const prev = scores.get(id);
      if (!prev || pEff > prev.pEff) {
        scores.set(id, { pEff, pMain: answer.noul, guards });
      }
    }
  }
  const labeled = new Set<string>();
  const pairs: ScorePair[] = [];
  const rows: FusionRow[] = [];
  for (const item of dataset.cases) {
    for (const label of item.labels) {
      const id = `${item.path}\0${label.ruleId}`;
      labeled.add(id);
      const score = scores.get(id);
      pairs.push({
        ruleId: label.ruleId,
        pluginId: label.ruleId.split(".")[0] || "core",
        positive: label.positive,
        pEff: score?.pEff ?? 0,
      });
      if (score) {
        rows.push({
          pMain: score.pMain,
          guards: score.guards,
          positive: label.positive,
        });
      }
    }
  }
  let unlabeled = 0;
  for (const finding of report.findings) {
    const id = `${finding.location.path}\0${finding.ruleId}`;
    if (!labeled.has(id)) unlabeled += 1;
  }
  const realModel =
    report.provider.isAI &&
    (report.provider.name === "typesafe" || report.provider.name === "http");
  return {
    pairs,
    rows,
    unlabeled,
    provider: report.provider.name,
    model: report.provider.model,
    realModel,
  };
}

function guardsFor(
  ruleId: string,
  answers: Record<string, JevAnswer>,
): Array<{ p: number; weight: number }> {
  const prefix = `g.${ruleId}.`;
  const guards: Array<{ p: number; weight: number }> = [];
  for (const [key, answer] of Object.entries(answers)) {
    if (key.startsWith(prefix) && answer.type === "noul") {
      guards.push({ p: answer.noul, weight: 1 });
    }
  }
  return guards;
}
