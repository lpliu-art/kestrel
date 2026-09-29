export interface BandSample {
  ruleId: string;
  model: string;
  band: "report" | "uncertain" | "drop";
  probability: number;
}

export interface DriftReport {
  ok: boolean;
  model: string;
  compared: number;
  changed: number;
  rate: number;
  changes: Array<{ ruleId: string; before: string; after: string }>;
  reason?: string;
}

/** Same model version: a band change on more than 5% of paired samples fails. */
export function compareBands(
  before: BandSample[],
  after: BandSample[],
): DriftReport {
  const models = new Set([...before, ...after].map((sample) => sample.model));
  if (models.size !== 1) {
    return {
      ok: false,
      model: [...models].sort().join(","),
      compared: 0,
      changed: 0,
      rate: 1,
      changes: [],
      reason: "model versions differ",
    };
  }
  const next = new Map(after.map((sample) => [sample.ruleId, sample]));
  const changes: DriftReport["changes"] = [];
  let compared = 0;
  for (const sample of before) {
    const other = next.get(sample.ruleId);
    if (!other) continue;
    compared += 1;
    if (other.band !== sample.band) {
      changes.push({
        ruleId: sample.ruleId,
        before: sample.band,
        after: other.band,
      });
    }
  }
  const rate = compared === 0 ? 0 : changes.length / compared;
  return {
    ok: rate <= 0.05,
    model: [...models][0] ?? "",
    compared,
    changed: changes.length,
    rate,
    changes,
  };
}
