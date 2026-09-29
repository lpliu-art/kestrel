export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export function sevRank(severity: Severity): number {
  const index = SEVERITIES.indexOf(severity);
  return index < 0 ? 0 : index;
}

export function clampSeverity(
  value: Severity,
  min?: Severity,
  max?: Severity,
): Severity {
  let rank = sevRank(value);
  if (min && rank < sevRank(min)) rank = sevRank(min);
  if (max && rank > sevRank(max)) rank = sevRank(max);
  return SEVERITIES[rank] ?? value;
}

export function severityWeight(severity: Severity): number {
  return sevRank(severity) + 1;
}
