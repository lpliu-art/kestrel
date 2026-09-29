import { type ProfileName, profileThresholds } from "../config/schema.ts";
import type { JevAnswer } from "../jev/types.ts";
import type { Finding } from "../report/model.ts";
import {
  compilePass2,
  compileRuleQuestions,
  defaultLocate,
} from "../rules/compile.ts";
import type { LoadedRule } from "../rules/schema.ts";
import { renderTemplate } from "../rules/template.ts";
import type { Anchor } from "../rules/trigger.ts";
import { redactText } from "../security/redact.ts";
import type { ReviewUnit } from "../units/build.ts";
import { sha1 } from "../util/hash.ts";
import { round6 } from "../util/json.ts";
import { clampSeverity, type Severity } from "../util/severity.ts";

export interface Thresholds {
  report: number;
  uncertain: number;
}

export function thresholdsFor(
  rule: LoadedRule,
  profile: ProfileName,
): Thresholds {
  const base = profileThresholds[profile];
  return {
    report: rule.thresholds?.report ?? base.report,
    uncertain: rule.thresholds?.uncertain ?? base.uncertain,
  };
}

export function effectiveProbability(
  pMain: number,
  guards: Array<{ p: number; weight: number }>,
): number {
  let value = pMain;
  for (const guard of guards) value *= (1 - guard.p) ** guard.weight;
  return round6(value);
}

export function bandFor(
  pEff: number,
  thresholds: Thresholds,
): "report" | "uncertain" | "drop" {
  if (pEff >= thresholds.report) return "report";
  if (pEff >= thresholds.uncertain) return "uncertain";
  return "drop";
}

export function mapSeverity(
  score: number,
  confidence: number,
  rule: LoadedRule,
): Severity {
  if (confidence < 0.4)
    return clampSeverity(
      rule.severity.default,
      rule.severity.min,
      rule.severity.max,
    );
  const index = Math.max(
    0,
    Math.min(rule.severity.levels.length - 1, Math.round(score)),
  );
  const mapped = rule.severity.map[index] ?? rule.severity.default;
  return clampSeverity(mapped, rule.severity.min, rule.severity.max);
}

export function decideRule(input: {
  rule: LoadedRule;
  unit: ReviewUnit;
  anchors: Anchor[];
  answers: Record<string, JevAnswer>;
  pass2?: Record<string, JevAnswer>;
  profile: ProfileName;
  language: "zh-CN" | "en";
  model: string;
}): Finding | undefined {
  const main = input.answers[`r.${input.rule.id}`];
  if (main?.type !== "noul") return undefined;
  const guardValues: Record<string, number> = {};
  const guardList: Array<{ p: number; weight: number }> = [];
  for (const guard of input.rule.guards ?? []) {
    const answer = input.answers[`g.${input.rule.id}.${guard.id}`];
    const p = answer && answer.type === "noul" ? answer.noul : 0;
    guardValues[guard.id] = round6(p);
    guardList.push({ p, weight: guard.weight ?? 1 });
  }
  const pEff = effectiveProbability(main.noul, guardList);
  const thresholds = thresholdsFor(input.rule, input.profile);
  const band = bandFor(pEff, thresholds);
  if (band === "drop") return undefined;
  const scoreAnswer = input.answers[`s.${input.rule.id}`];
  const severity =
    scoreAnswer && scoreAnswer.type === "score"
      ? mapSeverity(scoreAnswer.score, scoreAnswer.confidence, input.rule)
      : clampSeverity(
          input.rule.severity.default,
          input.rule.severity.min,
          input.rule.severity.max,
        );
  const severityScore =
    scoreAnswer && scoreAnswer.type === "score"
      ? {
          score: round6(scoreAnswer.score),
          confidence: round6(scoreAnswer.confidence),
        }
      : { score: input.rule.severity.map.indexOf(severity), confidence: 1 };
  const location = locate(input.rule, input.unit, input.anchors, input.pass2);
  const trace = traceFor(input, pEff, thresholds);
  return renderFinding({
    rule: input.rule,
    unit: input.unit,
    language: input.language,
    severity,
    band,
    probability: round6(main.noul),
    pEff,
    guards: guardValues,
    severityScore,
    location,
    source: "rule",
    slots: slotValues(input.rule, input.anchors, input.pass2),
    trace,
  });
}

function traceFor(
  input: {
    rule: LoadedRule;
    unit: ReviewUnit;
    anchors: Anchor[];
    answers: Record<string, JevAnswer>;
    pass2?: Record<string, JevAnswer>;
    profile: ProfileName;
    model: string;
  },
  _pEff: number,
  thresholds: Thresholds,
): NonNullable<Finding["trace"]> {
  const questions = {
    ...compileRuleQuestions(input.rule),
    ...(input.pass2 && Object.keys(input.pass2).length > 0
      ? compilePass2(input.rule, input.unit.addedLineNumbers, input.anchors)
      : {}),
  };
  const answers = { ...input.answers, ...input.pass2 };
  return {
    model: input.model,
    profile: input.profile,
    thresholds,
    questions: Object.keys(questions)
      .sort()
      .map((key) => {
        const question = questions[key];
        return {
          key,
          type: question?.type ?? "noul",
          instructions: question?.instructions ?? "",
          answer: answers[key] ?? null,
        };
      }),
  };
}

function locate(
  rule: LoadedRule,
  unit: ReviewUnit,
  anchors: Anchor[],
  pass2?: Record<string, JevAnswer>,
): Finding["location"] {
  const mode = defaultLocate(rule);
  const choice = pass2?.[`loc.${rule.id}`];
  const chosenLine =
    choice &&
    choice.type === "choice" &&
    choice.choice.startsWith("L") &&
    choice.confidence >= 0.5
      ? Number(choice.choice.slice(1))
      : undefined;
  if (mode !== "unit" && anchors.length > 0 && mode !== "choose") {
    const anchor =
      (chosenLine !== undefined &&
        anchors.find((item) => item.line === chosenLine)) ||
      anchors[0];
    return point(
      unit.path,
      anchor?.line ?? unit.addedLineNumbers[0] ?? unit.startLine,
      "trigger",
      false,
    );
  }
  if (
    mode !== "unit" &&
    chosenLine !== undefined &&
    unit.addedLineNumbers.includes(chosenLine)
  ) {
    return point(unit.path, chosenLine, "choice", false);
  }
  return point(
    unit.path,
    unit.addedLineNumbers[0] ?? unit.startLine,
    "unit",
    true,
  );
}

function point(
  path: string,
  line: number,
  anchor: Finding["location"]["anchor"],
  uncertain: boolean,
): Finding["location"] {
  const safe = line > 0 ? line : 1;
  return { path, startLine: safe, endLine: safe, anchor, uncertain };
}

function slotValues(
  rule: LoadedRule,
  anchors: Anchor[],
  pass2?: Record<string, JevAnswer>,
): Record<string, string> {
  const slots: Record<string, string> = {};
  for (const [name, slot] of Object.entries(rule.slots ?? {})) {
    if (slot.from.startsWith("regex:")) {
      const index = Number(slot.from.slice("regex:".length)) - 1;
      slots[name] = anchors[0]?.groups[index] ?? "";
    } else if (slot.from.startsWith("capture:")) {
      const capture = slot.from.slice("capture:".length);
      slots[name] = anchors[0]?.captures?.[capture] ?? "";
    } else {
      const answer = pass2?.[`slot.${rule.id}.${name}`];
      slots[name] =
        answer && answer.type === "choice" && answer.choice !== "other"
          ? answer.choice
          : "";
    }
  }
  return slots;
}

export function renderFinding(input: {
  rule: LoadedRule;
  unit: ReviewUnit;
  language: "zh-CN" | "en";
  severity: Severity;
  band: "report" | "uncertain";
  probability: number;
  pEff: number;
  guards: Record<string, number>;
  severityScore: { score: number; confidence: number };
  location: Finding["location"];
  source: Finding["source"];
  slots: Record<string, string>;
  trace?: Finding["trace"];
}): Finding {
  const locale =
    input.language === "zh-CN"
      ? (input.rule.message["zh-CN"] ?? input.rule.message.en)
      : input.rule.message.en;
  const hintLocale = input.rule.fix?.hint;
  const hint =
    input.language === "zh-CN"
      ? (hintLocale?.["zh-CN"] ?? hintLocale?.en ?? "")
      : (hintLocale?.en ?? "");
  const title =
    input.language === "zh-CN"
      ? (input.rule.title["zh-CN"] ?? input.rule.title.en)
      : input.rule.title.en;
  const line = String(input.location.startLine);
  const evidence = input.unit.sourceLines[input.location.startLine - 1] ?? "";
  const vars = {
    line,
    file: input.unit.path,
    symbol: input.slots.symbol ?? input.slots.value ?? "",
    p: input.pEff.toFixed(2),
    severity: input.severity,
    snippet: redactText(evidence).text,
    ...input.slots,
  };
  let message = renderTemplate(locale.body, vars);
  if (input.location.uncertain) {
    message +=
      input.language === "zh-CN"
        ? "（位置不确定，锚在本审查单元的第一条新增行。）"
        : " (location uncertain; anchored to the first added line of this unit.)";
  }
  const normalized = evidence.trim().replace(/\s+/g, " ");
  const fingerprint = sha1(`${input.rule.id}|${input.unit.path}|${normalized}`);
  return {
    id: `f_${fingerprint.slice(0, 8)}`,
    fingerprint,
    ruleId: input.rule.id,
    pluginId: input.rule.pluginId,
    source: input.source,
    category: input.rule.category,
    severity: input.severity,
    band: input.band,
    probability: input.probability,
    pEff: input.pEff,
    guards: input.guards,
    severityScore: input.severityScore,
    location: input.location,
    title,
    message,
    why: renderTemplate(locale.why ?? "", vars),
    fix: { hint, suggestion: null },
    llm: null,
    references: input.rule.references ?? [],
    relatedRuleIds: [],
    snippet: snippetAround(input.unit.sourceLines, input.location.startLine),
    ...(input.trace ? { trace: input.trace } : {}),
  };
}

function snippetAround(lines: string[], line: number): string {
  const from = Math.max(0, line - 3);
  const to = Math.min(lines.length, line + 1);
  return lines
    .slice(from, to)
    .map((text) => redactText(text).text)
    .join("\n");
}

export function dimensionValues(
  answers: Record<string, JevAnswer>,
): Record<string, number> {
  const dimensions: Record<string, number> = {};
  for (const [key, answer] of Object.entries(answers)) {
    if (key.startsWith("d.") && answer.type === "noul")
      dimensions[key.slice(2)] = round6(answer.noul);
  }
  return dimensions;
}

export function priorityScore(answers: Record<string, JevAnswer>): number {
  const answer = answers["u.priority"];
  return answer && answer.type === "score" ? answer.score : 0;
}
