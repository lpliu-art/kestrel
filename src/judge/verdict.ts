import type { Finding, Report } from "../report/model.ts";
import { type Severity, sevRank } from "../util/severity.ts";

export function decideVerdict(
  findings: Finding[],
  gate: { failOn: Severity; minProbability: number },
): Report["verdict"] {
  const minimum = sevRank(gate.failOn);
  const blocking = findings.filter(
    (finding) =>
      finding.band === "report" &&
      sevRank(finding.severity) >= minimum &&
      finding.pEff >= gate.minProbability,
  );
  const injection = findings.some(
    (finding) => finding.ruleId === "core.meta.reviewer-directed-text",
  );
  if (blocking.length > 0) {
    return {
      decision: "request_changes",
      blocking: blocking.map((finding) => finding.id),
      reasons: [
        `${blocking.length} finding(s) with severity ≥ ${gate.failOn} and p ≥ ${gate.minProbability.toFixed(2)}`,
      ],
    };
  }
  if (findings.some((finding) => finding.band === "report") || injection) {
    return {
      decision: "comment",
      blocking: [],
      reasons: ["Report-band findings are present and none meet the gate."],
    };
  }
  return {
    decision: "approve",
    blocking: [],
    reasons: [
      "No blocking issues found. This is not a claim that the change is safe.",
    ],
  };
}

export function reviewExitCode(
  verdict: Report["verdict"],
  status: "ok" | "partial",
  options: { gate: boolean; strict: boolean },
): number {
  if (options.gate && verdict.decision === "request_changes") return 1;
  if (status === "partial" && options.strict) return 4;
  return 0;
}
