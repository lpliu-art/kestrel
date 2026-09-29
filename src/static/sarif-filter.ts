import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { profileThresholds, type ResolvedConfig } from "../config/schema.ts";
import type { ChangedFile } from "../git/unified-diff.ts";
import type { JevAnswer, JevProvider, JevQuestion } from "../jev/types.ts";
import type { Finding, Report } from "../report/model.ts";
import { matchGlob } from "../rules/load.ts";
import { redactText } from "../security/redact.ts";
import type { ReviewUnit } from "../units/build.ts";
import { sha1 } from "../util/hash.ts";
import { round6 } from "../util/json.ts";

export interface StaticAlert {
  tool: string;
  ruleId: string;
  message: string;
  path: string;
  line: number;
  level: string;
  helpUri?: string;
}

export interface StaticFilterResult {
  findings: Finding[];
  summary: NonNullable<Report["static"]>;
  partial: boolean;
}

export async function loadSarifAlerts(
  patterns: string[],
  cwd: string,
): Promise<StaticAlert[]> {
  const files = new Set<string>();
  for (const pattern of patterns) {
    for (const rel of await matchGlob(pattern, cwd)) files.add(rel);
  }
  const alerts: StaticAlert[] = [];
  for (const rel of [...files].sort()) {
    const text = await readFile(join(cwd, rel), "utf8");
    alerts.push(...parseSarif(text));
  }
  return alerts;
}

export function parseSarif(text: string): StaticAlert[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const doc = raw as {
    runs?: Array<{
      tool?: {
        driver?: {
          name?: string;
          rules?: Array<{ id?: string; helpUri?: string }>;
        };
      };
      results?: Array<{
        ruleId?: string;
        level?: string;
        message?: { text?: string };
        locations?: Array<{
          physicalLocation?: {
            artifactLocation?: { uri?: string };
            region?: { startLine?: number };
          };
        }>;
      }>;
    }>;
  };
  const alerts: StaticAlert[] = [];
  for (const run of doc.runs ?? []) {
    const tool = run.tool?.driver?.name ?? "static";
    const help = new Map<string, string>();
    for (const rule of run.tool?.driver?.rules ?? []) {
      if (rule.id && rule.helpUri) help.set(rule.id, rule.helpUri);
    }
    for (const result of run.results ?? []) {
      const location = result.locations?.[0]?.physicalLocation;
      const path = location?.artifactLocation?.uri;
      const line = location?.region?.startLine;
      if (!path || !line || !result.ruleId) continue;
      alerts.push({
        tool,
        ruleId: result.ruleId,
        message: result.message?.text ?? result.ruleId,
        path: path.replaceAll("\\", "/"),
        line,
        level: result.level ?? "warning",
        helpUri: help.get(result.ruleId),
      });
    }
  }
  return alerts;
}

export function alertsOnDiff(
  alerts: StaticAlert[],
  files: ChangedFile[],
  mode: "added" | "diff_context",
): StaticAlert[] {
  const added = new Map<string, Set<number>>();
  const context = new Map<string, Set<number>>();
  for (const file of files) {
    added.set(file.path, new Set(file.addedLineNumbers));
    const lines = new Set<number>(file.addedLineNumbers);
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.newNo !== undefined) lines.add(line.newNo);
      }
    }
    context.set(file.path, lines);
  }
  const pool = mode === "diff_context" ? context : added;
  return alerts.filter((alert) => pool.get(alert.path)?.has(alert.line));
}

export async function judgeStaticAlerts(input: {
  alerts: StaticAlert[];
  units: ReviewUnit[];
  provider: JevProvider;
  model: string;
  config: ResolvedConfig;
  language: "zh-CN" | "en";
}): Promise<StaticFilterResult> {
  const thresholds = profileThresholds[input.config.profile];
  const rows: NonNullable<Report["static"]>["alerts"] = [];
  const findings: Finding[] = [];
  let partial = false;
  for (const [index, alert] of input.alerts.entries()) {
    const unit = input.units.find(
      (item) =>
        item.path === alert.path &&
        alert.line >= item.startLine &&
        alert.line <= item.endLine,
    );
    const questions = questionsFor(alert, index);
    try {
      const response = await input.provider.ask({
        model: input.model,
        state: {
          file: alert.path,
          hunk: unit ? hunkOf(unit) : `L${alert.line} + ${alert.message}`,
          alert: alert.message,
        },
        questions,
      });
      const real = noul(response.answers, `sa.${index}.real`);
      const matters = noul(response.answers, `sa.${index}.matters`);
      const probability = round6(real * matters);
      const score = response.answers[`sa.${index}.sev`];
      const severity = severityFrom(score, alert.level);
      const decision = probability >= thresholds.report ? "keep" : "drop";
      rows.push({
        tool: alert.tool,
        ruleId: alert.ruleId,
        path: alert.path,
        line: alert.line,
        decision,
        real: round6(real),
        matters: round6(matters),
        probability,
      });
      if (decision === "keep") {
        findings.push(
          findingFrom(
            alert,
            severity,
            probability,
            input.language,
            response.model,
          ),
        );
      }
    } catch {
      partial = true;
      rows.push({
        tool: alert.tool,
        ruleId: alert.ruleId,
        path: alert.path,
        line: alert.line,
        decision: "drop",
        real: 0,
        matters: 0,
        probability: 0,
      });
    }
  }
  const kept = rows.filter((row) => row.decision === "keep").length;
  return {
    findings,
    partial,
    summary: {
      imported: input.alerts.length,
      onDiff: input.alerts.length,
      kept,
      dropped: rows.length - kept,
      alerts: rows,
    },
  };
}

function questionsFor(
  alert: StaticAlert,
  index: number,
): Record<string, JevQuestion> {
  const shared = {
    tool: alert.tool,
    rule: alert.ruleId,
    message: alert.message,
    line: alert.line,
    level: alert.level,
  };
  return {
    [`sa.${index}.real`]: {
      type: "noul",
      instructions: {
        question: "Is this static-analysis alert real in the shown code?",
        alert: shared,
      },
      criteria: {
        true: { what: "The alert describes a real issue in the shown code" },
        false: {
          what: "The alert does not describe a defect in the shown code",
        },
      },
    },
    [`sa.${index}.matters`]: {
      type: "noul",
      instructions: {
        question:
          "Would a careful reviewer require a fix for this alert in this pull request?",
        alert: shared,
      },
      criteria: {
        true: { what: "A careful reviewer would ask for a fix in this PR" },
        false: { what: "The alert can wait or does not apply to this change" },
      },
    },
    [`sa.${index}.sev`]: {
      type: "score",
      instructions: {
        question: "How severe is this static-analysis alert if it is real?",
        alert: shared,
      },
      criteria: ["Low impact", "Should be fixed", "Should block merge"],
    },
  };
}

function findingFrom(
  alert: StaticAlert,
  severity: Finding["severity"],
  probability: number,
  language: "zh-CN" | "en",
  model: string,
): Finding {
  const link = alert.helpUri ? `\n${alert.helpUri}` : "";
  const message =
    language === "zh-CN"
      ? `${alert.message}\nKestrel 严重度 ${severity} · p=${probability.toFixed(2)}${link}`
      : `${alert.message}\nKestrel severity ${severity} · p=${probability.toFixed(2)}${link}`;
  const fingerprint = sha1(
    `sa.filter.alert|${alert.path}|${alert.ruleId}|${alert.line}|${alert.message}`,
  );
  return {
    id: `f_${fingerprint.slice(0, 8)}`,
    fingerprint,
    ruleId: "sa.filter.alert",
    pluginId: "static",
    source: "rule",
    category: "correctness",
    severity,
    band: "report",
    probability,
    pEff: probability,
    guards: {},
    severityScore: { score: severity === "high" ? 2 : 1, confidence: 0.9 },
    location: {
      path: alert.path,
      startLine: alert.line,
      endLine: alert.line,
      anchor: "trigger",
      uncertain: false,
    },
    title: `${alert.tool}: ${alert.ruleId}`,
    message,
    why: alert.message,
    fix: { hint: "", suggestion: null },
    llm: null,
    references: alert.helpUri ? [alert.helpUri] : [],
    relatedRuleIds: [],
    snippet: redactText(alert.message).text,
    trace: {
      model,
      profile: "",
      thresholds: { report: probability, uncertain: probability },
      questions: [
        {
          key: "sa.real",
          type: "noul",
          instructions: "Is this static-analysis alert real in the shown code?",
          answer: { type: "noul", noul: probability },
        },
      ],
    },
  };
}

function noul(answers: Record<string, JevAnswer>, key: string): number {
  const answer = answers[key];
  return answer && answer.type === "noul" ? answer.noul : 0;
}

function severityFrom(
  answer: JevAnswer | undefined,
  level: string,
): Finding["severity"] {
  if (answer && answer.type === "score") {
    if (answer.score >= 2) return "high";
    if (answer.score <= 0) return "low";
    return "medium";
  }
  if (level === "error") return "high";
  if (level === "note") return "low";
  return "medium";
}

function hunkOf(unit: ReviewUnit): string {
  return unit.lines
    .filter((line) => line.kind === "added" && line.newNo !== undefined)
    .map((line) => `L${line.newNo} + ${line.text}`)
    .join("\n");
}
