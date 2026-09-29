import { fileFromSource, splitSourceLines } from "../git/unified-diff.ts";
import { BudgetGuard } from "../jev/budget.ts";
import { createMockProvider } from "../jev/mock.ts";
import { judgeUnit } from "../pipeline/judge-unit.ts";
import { buildReviewState } from "../pipeline/state.ts";
import { buildUnits } from "../units/build.ts";
import type { LoadedRule, RuleExample } from "./schema.ts";

export interface RuleTestFailure {
  ruleId: string;
  kind: "positive" | "negative";
  index: number;
  message: string;
}

export interface RuleTestReport {
  passed: number;
  failed: RuleTestFailure[];
}

const DEFAULT_PATHS: Record<string, string> = {
  typescript: "src/example.ts",
  tsx: "src/example.tsx",
  javascript: "src/example.js",
  vue: "src/App.vue",
  python: "src/example.py",
  java: "src/Example.java",
  go: "src/example.go",
  "package-json": "package.json",
};

export async function testRules(
  rules: LoadedRule[],
  language: "zh-CN" | "en" = "en",
): Promise<RuleTestReport> {
  const failed: RuleTestFailure[] = [];
  let passed = 0;
  for (const rule of rules) {
    for (const [kind, examples] of [
      ["positive", rule.examples.positive],
      ["negative", rule.examples.negative],
    ] as const) {
      for (let index = 0; index < examples.length; index++) {
        const example = examples[index];
        if (!example) continue;
        const found = await exampleMatches(rule, example, language);
        const ok = kind === "positive" ? found : !found;
        if (ok) passed += 1;
        else {
          failed.push({
            ruleId: rule.id,
            kind,
            index,
            message:
              kind === "positive"
                ? "positive example produced no report finding"
                : "negative example produced a report finding",
          });
        }
      }
    }
  }
  return { passed, failed };
}

async function exampleMatches(
  rule: LoadedRule,
  example: RuleExample,
  language: "zh-CN" | "en",
): Promise<boolean> {
  const languageId =
    example.language ?? rule.applies?.languages?.[0] ?? "typescript";
  const path = example.path ?? DEFAULT_PATHS[languageId] ?? "src/example.ts";
  const file = fileFromSource(
    path,
    example.code.endsWith("\n") ? example.code : `${example.code}\n`,
  );
  const sourceLines = splitSourceLines(
    file.status === "binary"
      ? ""
      : example.code.endsWith("\n")
        ? example.code
        : `${example.code}\n`,
  );
  const units = buildUnits(
    file,
    sourceLines,
    languageId,
    rule.pluginId,
    { maxAddedLinesPerUnit: 120 },
    {
      frameworks: rule.applies?.frameworks ?? [],
    },
  );
  const provider = createMockProvider([rule]);
  const warnings: string[] = [];
  for (const unit of units) {
    const state = buildReviewState({ unit, rules: [rule], redact: true });
    const judged = await judgeUnit({
      unit,
      rules: [rule],
      state,
      provider,
      budget: new BudgetGuard(2_000_000),
      model: "jev-1.13.0",
      profile: "balanced",
      language,
      strategy: "two-pass",
      maxRules: 40,
      warnings,
    });
    if (
      judged.findings.some(
        (finding) => finding.ruleId === rule.id && finding.band === "report",
      )
    )
      return true;
  }
  return false;
}
