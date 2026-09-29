import type { Finding } from "../report/model.ts";
import { severityWeight, sevRank } from "../util/severity.ts";

export function dedupeFindings(findings: Finding[]): Finding[] {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const key = `${finding.location.path}|${finding.location.startLine}|${finding.category}`;
    const list = groups.get(key) ?? [];
    list.push(finding);
    groups.set(key, list);
  }
  const kept: Finding[] = [];
  for (const list of groups.values()) {
    const ranked = [...list].sort(
      (a, b) =>
        b.pEff * severityWeight(b.severity) -
          a.pEff * severityWeight(a.severity) ||
        a.ruleId.localeCompare(b.ruleId),
    );
    const best = ranked[0];
    if (!best) continue;
    const related = ranked.slice(1).map((finding) => finding.ruleId);
    kept.push({
      ...best,
      relatedRuleIds: [...new Set([...best.relatedRuleIds, ...related])],
    });
  }
  return kept.sort(
    (a, b) =>
      sevRank(b.severity) - sevRank(a.severity) ||
      b.pEff - a.pEff ||
      a.location.path.localeCompare(b.location.path) ||
      a.location.startLine - b.location.startLine ||
      a.ruleId.localeCompare(b.ruleId),
  );
}
