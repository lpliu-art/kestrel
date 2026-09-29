import type { ResolvedConfig } from "../config/schema.ts";
import type { LoadedRule, RuleExample } from "./schema.ts";

const RULE_ID = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*){2}$/;

export function compileChecks(
  config: ResolvedConfig,
  warnings: string[],
): LoadedRule[] {
  const rules: LoadedRule[] = [];
  for (const check of config.checks) {
    if (!RULE_ID.test(check.id)) {
      warnings.push(
        `Skipping check ${check.id}: id must be three segments such as team.api.validate-body.`,
      );
      continue;
    }
    const ask = check.ask.trim();
    if (!ask) {
      warnings.push(`Skipping check ${check.id}: ask is empty.`);
      continue;
    }
    const severity = check.severity ?? "medium";
    const samplePath = examplePath(check.paths);
    const positive = examplesOf(check.examples?.positive, samplePath);
    const negative = examplesOf(check.examples?.negative, samplePath);
    const userExamples = positive.length > 0 && negative.length > 0;
    const mock = userExamples ? mockHints(positive, negative) : undefined;
    const examples = userExamples
      ? { positive, negative }
      : {
          positive: [
            {
              code: `kestrel-check-positive ${check.id}\n`,
              ...(samplePath ? { path: samplePath } : {}),
            },
          ],
          negative: [
            {
              code: `kestrel-check-negative ${check.id}\n`,
              ...(samplePath ? { path: samplePath } : {}),
            },
          ],
        };
    const message =
      check.message?.en ??
      `Line {{line}} violates the team rule: ${ask.replaceAll("{{", "")}`;
    rules.push({
      id: check.id,
      title: {
        en: ask.slice(0, 120),
        ...(check.message?.["zh-CN"]
          ? { "zh-CN": check.message["zh-CN"] }
          : {}),
      },
      category: "maintainability",
      dimension: "maintainability",
      applies: check.paths ? { paths: check.paths } : undefined,
      trigger: { kind: "always" },
      context: ["hunk"],
      question: {
        question: `Does \`hunk\` violate this team rule: ${ask}?`,
        focus: "The added lines in the hunk",
        true: { what: "The shown code violates the team rule" },
        false: { what: "The shown code does not violate the team rule" },
      },
      severity: {
        levels: [
          "Low impact",
          "Medium impact",
          "High impact",
          "Critical impact",
        ],
        map: ["low", "medium", "high", "critical"],
        default: severity,
      },
      locate: "unit",
      message: {
        en: { body: message, why: "This check was declared by the team." },
        "zh-CN": {
          body:
            check.message?.["zh-CN"] ??
            `第 {{line}} 行违反团队规则：${ask.replaceAll("{{", "")}`,
          why: "这条检查来自团队配置。",
        },
      },
      mock: mock ?? {
        positive: escapeRegExp(`kestrel-check-positive ${check.id}`),
        negative: escapeRegExp(`kestrel-check-negative ${check.id}`),
      },
      examples,
      pluginId: "checks",
      layer: "project",
      pack: "checks",
    });
    if (check.expect === false) {
      warnings.push(
        `Check ${check.id}: expect false still asks whether the hunk violates the rule and does not invert the probability.`,
      );
    }
  }
  return rules;
}

function examplesOf(
  examples:
    | Array<{ code: string; path?: string; language?: string }>
    | undefined,
  samplePath?: string,
): RuleExample[] {
  return (examples ?? [])
    .filter((example) => example.code.trim().length > 0)
    .map((example) => ({
      code: example.code,
      ...((example.path ?? samplePath)
        ? { path: example.path ?? samplePath }
        : {}),
      ...(example.language ? { language: example.language } : {}),
    }));
}

function examplePath(paths: string[] | undefined): string | undefined {
  const pattern = paths?.[0];
  if (!pattern) return undefined;
  const concrete = pattern
    .replaceAll("**", "dir")
    .replaceAll("*", "file")
    .replace(/\/+$/, "");
  return concrete.includes(".") ? concrete : `${concrete}/file.ts`;
}

function mockHints(
  positive: RuleExample[],
  negative: RuleExample[],
): { positive: string; negative: string } {
  const negativeText = negative.map((example) => example.code).join("\n");
  const positiveText = positive.map((example) => example.code).join("\n");
  const positiveLine =
    uniqueLine(positiveText, negativeText) ?? positive[0]?.code ?? "positive";
  const negativeLine =
    uniqueLine(negativeText, positiveText) ?? negative[0]?.code ?? "negative";
  return {
    positive: escapeRegExp(positiveLine.trim()),
    negative: escapeRegExp(negativeLine.trim()),
  };
}

function uniqueLine(source: string, other: string): string | undefined {
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length < 4) continue;
    if (!other.includes(trimmed)) return trimmed;
  }
  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
