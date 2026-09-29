import type { ProfileName } from "../config/schema.ts";
import type { BudgetGuard } from "../jev/budget.ts";
import { estimateRequestTokens } from "../jev/tokens.ts";
import type { JevAnswer, JevProvider, JevRequest } from "../jev/types.ts";
import {
  decideRule,
  dimensionValues,
  priorityScore,
  renderFinding,
} from "../judge/decide.ts";
import { selectRules } from "../judge/pass1.ts";
import { rulesForPass2 } from "../judge/pass2.ts";
import type { Finding } from "../report/model.ts";
import type { LoadedRule } from "../rules/schema.ts";
import { isSuppressed } from "../rules/trigger.ts";
import {
  injectionProbability,
  looksLikeInjection,
} from "../security/injection.ts";
import { redactText } from "../security/redact.ts";
import type { ReviewUnit } from "../units/build.ts";
import { isKestrelError } from "../util/errors.ts";
import type { JsonValue } from "../util/json.ts";
import { clampSeverity } from "../util/severity.ts";
import { questionsForPass, requestsFor } from "./questions.ts";

export interface UnitJudgement {
  findings: Finding[];
  dimensions: Record<string, number>;
  priority: number;
  requests: JevRequest[];
  skipped?: "budget";
  failed: boolean;
  degraded?: boolean;
  model?: string;
}

export async function judgeUnit(input: {
  unit: ReviewUnit;
  rules: LoadedRule[];
  state: JsonValue;
  provider: JevProvider;
  budget: BudgetGuard;
  model: string;
  profile: ProfileName;
  language: "zh-CN" | "en";
  strategy: "two-pass" | "single-pass";
  maxRules: number;
  warnings: string[];
  onRateLimit?: () => void;
}): Promise<UnitJudgement> {
  const selection = selectRules(input.unit, input.rules, input.maxRules);
  if (selection.truncated > 0) {
    input.warnings.push(
      `${input.unit.id}: truncated ${selection.truncated} rules past maxRulesPerUnit`,
    );
  }
  const anchors = new Map(
    [...selection.matches].map(([id, match]) => [id, match.anchors]),
  );
  const pass1Questions = questionsForPass({
    rules: selection.selected,
    anchors,
    addedLineNumbers: input.unit.addedLineNumbers,
    strategy: input.strategy,
    pass: 1,
  });
  const pass1 = requestsFor(input.model, input.state, pass1Questions);
  const asked: JevRequest[] = [];
  const pass1Result = await askRequests(pass1, input, asked);
  if (pass1Result === "budget") {
    return {
      findings: deterministicFindings(
        input.unit,
        input.rules,
        input.language,
        undefined,
      ),
      dimensions: {},
      priority: 0,
      requests: asked,
      skipped: "budget",
      failed: false,
    };
  }
  if (pass1Result === "fail") {
    return {
      findings: deterministicFindings(
        input.unit,
        input.rules,
        input.language,
        undefined,
      ),
      dimensions: {},
      priority: 0,
      requests: asked,
      failed: true,
    };
  }
  const answers = pass1Result.answers;
  let model = pass1Result.model;
  const pass2Rules =
    input.strategy === "two-pass"
      ? rulesForPass2(
          selection.selected,
          selection.matches,
          answers,
          input.profile,
        )
      : [];
  const pass2Questions = questionsForPass({
    rules: pass2Rules,
    anchors,
    addedLineNumbers: input.unit.addedLineNumbers,
    strategy: input.strategy,
    pass: 2,
  });
  const pass2 = requestsFor(input.model, input.state, pass2Questions);
  const pass2Result = await askRequests(pass2, input, asked);
  let pass2Answers: Record<string, JevAnswer> = {};
  if (pass2Result === "budget") {
    const findings = [
      ...deterministicFindings(
        input.unit,
        input.rules,
        input.language,
        answers,
      ),
      ...findingsFrom(selection.selected, input, anchors, answers, {}),
    ];
    return {
      findings,
      dimensions: dimensionValues(answers),
      priority: priorityScore(answers),
      requests: asked,
      skipped: "budget",
      failed: false,
      model,
    };
  }
  const pass2Failed = pass2Result === "fail";
  if (!pass2Failed) {
    pass2Answers = pass2Result.answers;
    model = pass2Result.model || model;
  }
  const findings = [
    ...deterministicFindings(input.unit, input.rules, input.language, answers),
    ...findingsFrom(selection.selected, input, anchors, answers, pass2Answers),
  ];
  return {
    findings,
    dimensions: dimensionValues(answers),
    priority: priorityScore(answers),
    requests: asked,
    failed: false,
    degraded: pass2Failed,
    model,
  };
}

function findingsFrom(
  rules: LoadedRule[],
  input: { unit: ReviewUnit; profile: ProfileName; language: "zh-CN" | "en" },
  anchors: Map<string, import("../rules/trigger.ts").Anchor[]>,
  answers: Record<string, JevAnswer>,
  pass2: Record<string, JevAnswer>,
): Finding[] {
  const findings: Finding[] = [];
  for (const rule of rules) {
    const finding = decideRule({
      rule,
      unit: input.unit,
      anchors: anchors.get(rule.id) ?? [],
      answers,
      pass2,
      profile: input.profile,
      language: input.language,
      model: "",
    });
    if (finding) findings.push(finding);
  }
  return findings;
}

async function askRequests(
  requests: JevRequest[],
  input: {
    provider: JevProvider;
    budget: BudgetGuard;
    warnings: string[];
    unit: ReviewUnit;
    onRateLimit?: () => void;
  },
  asked: JevRequest[],
): Promise<
  { answers: Record<string, JevAnswer>; model?: string } | "budget" | "fail"
> {
  const answers: Record<string, JevAnswer> = {};
  let model: string | undefined;
  let sawSuccess = false;
  let sawFailure = false;
  for (const request of requests) {
    const estimate = estimateRequestTokens(request.state, request.questions);
    if (!input.budget.canSpend(estimate))
      return sawSuccess ? { answers, model } : "budget";
    try {
      const response = await input.provider.ask(request);
      input.budget.spend(response.usage.input_tokens || estimate);
      Object.assign(answers, response.answers);
      model = response.model;
      sawSuccess = true;
      asked.push(request);
    } catch (error) {
      if (isKestrelError(error) && error.category === "auth") throw error;
      if (isKestrelError(error) && error.category === "rate")
        input.onRateLimit?.();
      sawFailure = true;
      const message = error instanceof Error ? error.message : String(error);
      input.warnings.push(`${input.unit.id}: ${message}`);
      if (isKestrelError(error) && error.category === "validation") {
        input.warnings.push(
          `${input.unit.id}: question payload rejected; continuing without this batch`,
        );
      }
    }
  }
  if (!sawSuccess && (sawFailure || requests.length === 0)) {
    if (requests.length === 0) return { answers, model };
    return "fail";
  }
  return { answers, model };
}

export function deterministicFindings(
  unit: ReviewUnit,
  rules: LoadedRule[],
  language: "zh-CN" | "en",
  answers: Record<string, JevAnswer> | undefined,
): Finding[] {
  const findings: Finding[] = [];
  for (const rule of rules) {
    if (rule.deterministic === "secret")
      findings.push(...secretFindings(unit, rule, language));
    if (rule.deterministic === "injection") {
      const finding = injectionFinding(unit, rule, language, answers);
      if (finding) findings.push(finding);
    }
  }
  return findings;
}

function secretFindings(
  unit: ReviewUnit,
  rule: LoadedRule,
  language: "zh-CN" | "en",
): Finding[] {
  const findings: Finding[] = [];
  for (const line of unit.lines) {
    if (line.kind !== "added" || line.newNo === undefined) continue;
    if (isSuppressed(rule.id, line.newNo, unit.sourceLines)) continue;
    const hit = redactText(line.text, line.newNo);
    if (hit.secrets.length === 0) continue;
    const severity = clampSeverity(
      rule.severity.default,
      rule.severity.min,
      rule.severity.max,
    );
    findings.push(
      renderFinding({
        rule,
        unit,
        language,
        severity,
        band: "report",
        probability: 1,
        pEff: 1,
        guards: {},
        severityScore: {
          score: Math.max(0, rule.severity.map.indexOf(severity)),
          confidence: 1,
        },
        location: {
          path: unit.path,
          startLine: line.newNo,
          endLine: line.newNo,
          anchor: "trigger",
          uncertain: false,
        },
        source: "deterministic",
        slots: {},
      }),
    );
  }
  return findings;
}

function injectionFinding(
  unit: ReviewUnit,
  rule: LoadedRule,
  language: "zh-CN" | "en",
  answers: Record<string, JevAnswer> | undefined,
): Finding | undefined {
  const answer = answers?.["u.injection"];
  const fromModel = answer && answer.type === "noul" ? answer.noul : undefined;
  const added = unit.lines.filter((line) => line.kind === "added");
  const text = added.map((line) => line.text).join("\n");
  const probability = fromModel ?? injectionProbability(text);
  if (probability < 0.7) return undefined;
  const hit = added.find(
    (line) =>
      line.newNo !== undefined &&
      looksLikeInjection(line.text) &&
      !isSuppressed(rule.id, line.newNo, unit.sourceLines),
  );
  const lineNo =
    hit?.newNo ??
    added.find(
      (line) =>
        line.newNo !== undefined &&
        !isSuppressed(rule.id, line.newNo ?? 0, unit.sourceLines),
    )?.newNo;
  if (lineNo === undefined) return undefined;
  const severity = clampSeverity(
    rule.severity.default,
    rule.severity.min,
    rule.severity.max,
  );
  return renderFinding({
    rule,
    unit,
    language,
    severity,
    band: "report",
    probability,
    pEff: probability,
    guards: {},
    severityScore: {
      score: Math.max(0, rule.severity.map.indexOf(severity)),
      confidence: 1,
    },
    location: {
      path: unit.path,
      startLine: lineNo,
      endLine: lineNo,
      anchor: "trigger",
      uncertain: false,
    },
    source: "deterministic",
    slots: {},
  });
}
