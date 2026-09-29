import type { LoadedRule } from "../rules/schema.ts";
import { matchTrigger, type TriggerMatch } from "../rules/trigger.ts";
import type { ReviewUnit } from "../units/build.ts";
import { sevRank } from "../util/severity.ts";

export function selectRules(
  unit: ReviewUnit,
  rules: LoadedRule[],
  maxRules: number,
): {
  selected: LoadedRule[];
  matches: Map<string, TriggerMatch>;
  truncated: number;
} {
  const matched: Array<{ rule: LoadedRule; match: TriggerMatch }> = [];
  for (const rule of rules) {
    const match = matchTrigger(rule, unit);
    if (match.matched) matched.push({ rule, match });
  }
  matched.sort(
    (a, b) =>
      rulePriority(b.rule) - rulePriority(a.rule) ||
      a.rule.id.localeCompare(b.rule.id),
  );
  const selected = matched.slice(0, maxRules);
  const matches = new Map<string, TriggerMatch>();
  for (const item of selected) matches.set(item.rule.id, item.match);
  return {
    selected: selected.map((item) => item.rule),
    matches,
    truncated: Math.max(0, matched.length - selected.length),
  };
}

function rulePriority(rule: LoadedRule): number {
  if (rule.priority !== undefined) return rule.priority;
  const top =
    rule.severity.max ?? rule.severity.map.at(-1) ?? rule.severity.default;
  return sevRank(top);
}
