import type { ProfileName } from "../config/schema.ts";
import type { JevAnswer } from "../jev/types.ts";
import { needsPass2 } from "../rules/compile.ts";
import type { LoadedRule } from "../rules/schema.ts";
import type { TriggerMatch } from "../rules/trigger.ts";
import { bandFor, effectiveProbability, thresholdsFor } from "./decide.ts";

export function rulesForPass2(
  rules: LoadedRule[],
  matches: Map<string, TriggerMatch>,
  answers: Record<string, JevAnswer>,
  profile: ProfileName,
): LoadedRule[] {
  const selected: LoadedRule[] = [];
  for (const rule of rules) {
    const main = answers[`r.${rule.id}`];
    if (main?.type !== "noul") continue;
    const guards = (rule.guards ?? []).map((guard) => {
      const answer = answers[`g.${rule.id}.${guard.id}`];
      return {
        p: answer && answer.type === "noul" ? answer.noul : 0,
        weight: guard.weight ?? 1,
      };
    });
    const pEff = effectiveProbability(main.noul, guards);
    const thresholds = thresholdsFor(rule, profile);
    if (bandFor(pEff, thresholds) === "drop") continue;
    if (pEff < thresholds.uncertain) continue;
    const anchors = matches.get(rule.id)?.anchors ?? [];
    if (needsPass2(rule, anchors)) selected.push(rule);
  }
  return selected;
}
