import type { LoadedRule } from "./schema.ts";
import { KNOWN_TEMPLATE_VARS, templateVars } from "./template.ts";
import { compileRegex } from "./trigger.ts";

export interface LintIssue {
  ruleId: string;
  message: string;
}

export function lintRules(rules: LoadedRule[]): LintIssue[] {
  const issues: LintIssue[] = [];
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.id))
      issues.push({ ruleId: rule.id, message: "duplicate rule id" });
    seen.add(rule.id);
    if (rule.trigger.kind === "treesitter" && !rule.trigger.query) {
      issues.push({
        ruleId: rule.id,
        message: "treesitter trigger is missing a query",
      });
    }
    if (rule.trigger.kind === "regex") {
      if (!rule.trigger.pattern)
        issues.push({
          ruleId: rule.id,
          message: "regex trigger is missing a pattern",
        });
      else if (!compileRegex(rule.trigger.pattern, rule.trigger.flags)) {
        issues.push({
          ruleId: rule.id,
          message: "regex pattern does not compile",
        });
      }
      if (rule.trigger.flags?.includes("g")) {
        issues.push({
          ruleId: rule.id,
          message: "regex flags must not include g",
        });
      }
    }
    if (!rule.question.true || !rule.question.false) {
      issues.push({
        ruleId: rule.id,
        message: "question needs both true and false criteria",
      });
    }
    if (rule.pluginId !== "checks" && !isMostlyAscii(rule.question.question)) {
      issues.push({
        ruleId: rule.id,
        message: "question must be English (ASCII)",
      });
    }
    if (rule.severity.levels.length !== rule.severity.map.length) {
      issues.push({
        ruleId: rule.id,
        message: "severity.levels and severity.map must have the same length",
      });
    }
    if (
      rule.examples.positive.length < 1 ||
      rule.examples.negative.length < 1
    ) {
      issues.push({
        ruleId: rule.id,
        message: "examples need at least one positive and one negative",
      });
    }
    for (const pattern of [
      rule.mock?.positive,
      rule.mock?.negative,
      rule.mock?.guardPositive,
    ]) {
      if (pattern && !compileRegex(pattern))
        issues.push({
          ruleId: rule.id,
          message: `mock regex does not compile: ${pattern}`,
        });
    }
    const slots = new Set(Object.keys(rule.slots ?? {}));
    const allowed = new Set([...KNOWN_TEMPLATE_VARS, ...slots]);
    const blobs = [
      rule.message.en.body,
      rule.message.en.why ?? "",
      rule.message["zh-CN"]?.body ?? "",
      rule.message["zh-CN"]?.why ?? "",
      rule.fix?.hint?.en ?? "",
      rule.fix?.hint?.["zh-CN"] ?? "",
    ];
    for (const blob of blobs) {
      for (const name of templateVars(blob)) {
        if (!allowed.has(name))
          issues.push({
            ruleId: rule.id,
            message: `unknown template variable {{${name}}}`,
          });
      }
    }
  }
  return issues;
}

function isMostlyAscii(text: string): boolean {
  const letters = [...text].filter((char) => /\S/.test(char));
  if (letters.length === 0) return false;
  const ascii = letters.filter((char) => char.charCodeAt(0) < 128).length;
  return ascii / letters.length >= 0.95;
}

export const RULE_SCAFFOLD = `pack: local
version: 1.0.0
rules:
  - id: {{id}}
    title: { en: "Describe the issue", zh-CN: "用一句话描述问题" }
    category: correctness
    dimension: correctness
    applies:
      languages: [typescript]
    trigger:
      kind: regex
      on: added
      pattern: 'TODO_PATTERN'
    question:
      question: "Do the added lines in \`hunk\` contain the issue?"
      focus: "Lines marked with +"
      true: { what: "The issue is present" }
      false: { what: "The issue is absent" }
    severity:
      levels: ["Low impact", "High impact"]
      map: [low, high]
      default: high
    message:
      en: { body: "Line {{line}} has the issue.", why: "Explain why it matters." }
      zh-CN: { body: "第 {{line}} 行存在该问题。", why: "说明为什么重要。" }
    examples:
      positive:
        - code: |
            // code that should be reported
      negative:
        - code: |
            // code that should be ignored
`;
