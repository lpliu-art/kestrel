import { fileFromSource, splitSourceLines } from "../git/unified-diff.ts";
import { BudgetGuard } from "../jev/budget.ts";
import { createMockProvider } from "../jev/mock.ts";
import type { JevProvider } from "../jev/types.ts";
import { judgeUnit } from "../pipeline/judge-unit.ts";
import { buildReviewState } from "../pipeline/state.ts";
import { ensureTreesitter } from "../treesitter/runtime.ts";
import { buildUnits } from "../units/build.ts";
import type { LoadedRule, RuleExample } from "./schema.ts";

export interface RuleTestFailure {
  ruleId: string;
  kind: "positive" | "negative";
  index: number;
  message: string;
}

export interface RuleTestSample {
  ruleId: string;
  kind: "positive" | "negative";
  index: number;
  probability: number;
  band: "report" | "uncertain" | "drop";
}

export interface RuleTestReport {
  passed: number;
  failed: RuleTestFailure[];
  distribution: RuleTestSample[];
}

const DEFAULT_PATHS: Record<string, string> = {
  typescript: "src/example.ts",
  tsx: "src/example.tsx",
  javascript: "src/example.js",
  vue: "src/App.vue",
  python: "src/example.py",
  java: "src/Example.java",
  go: "src/example.go",
  rust: "src/lib.rs",
  csharp: "src/Program.cs",
  "package-json": "package.json",
  xml: "src/UserMapper.xml",
};

export async function testRules(
  rules: LoadedRule[],
  language: "zh-CN" | "en" = "en",
  options: { provider?: JevProvider } = {},
): Promise<RuleTestReport> {
  await ensureTreesitter();
  const failed: RuleTestFailure[] = [];
  const distribution: RuleTestSample[] = [];
  let passed = 0;
  for (const rule of rules) {
    for (const [kind, examples] of [
      ["positive", rule.examples.positive],
      ["negative", rule.examples.negative],
    ] as const) {
      for (let index = 0; index < examples.length; index++) {
        const example = examples[index];
        if (!example) continue;
        const sample = await exampleMatches(
          rule,
          example,
          language,
          options.provider,
        );
        distribution.push({
          ruleId: rule.id,
          kind,
          index,
          probability: sample.probability,
          band: sample.band,
        });
        const found = sample.band === "report";
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
  return { passed, failed, distribution };
}

async function exampleMatches(
  rule: LoadedRule,
  example: RuleExample,
  language: "zh-CN" | "en",
  provider?: JevProvider,
): Promise<{ probability: number; band: "report" | "uncertain" | "drop" }> {
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
  const active = provider ?? createMockProvider([rule]);
  const warnings: string[] = [];
  for (const unit of units) {
    const state = buildReviewState({ unit, rules: [rule], redact: true });
    const judged = await judgeUnit({
      unit,
      rules: [rule],
      state,
      provider: active,
      budget: new BudgetGuard(2_000_000),
      model: "jev-1.13.0",
      profile: "balanced",
      language,
      strategy: "two-pass",
      maxRules: 40,
      warnings,
    });
    const finding = judged.findings.find((item) => item.ruleId === rule.id);
    if (finding?.band === "report" || finding?.band === "uncertain")
      return { probability: finding.probability, band: finding.band };
  }
  return { probability: 0, band: "drop" };
}
