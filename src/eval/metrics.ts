export interface ScorePair {
  ruleId: string;
  pluginId: string;
  positive: boolean;
  pEff: number;
}

export interface ClassMetrics {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  f1: number;
  falsePositiveRate: number;
}

export interface ReliabilityBin {
  lo: number;
  hi: number;
  count: number;
  positives: number;
  meanP: number;
  rate: number;
}

export interface ProfileProposal {
  report: number;
  uncertain: number;
  precision: number;
  recall: number;
  f1: number;
}

export function classify(pairs: ScorePair[], threshold: number): ClassMetrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const pair of pairs) {
    const predicted = pair.pEff >= threshold;
    if (predicted && pair.positive) tp += 1;
    else if (predicted && !pair.positive) fp += 1;
    else if (!predicted && pair.positive) fn += 1;
    else tn += 1;
  }
  return finishCounts(tp, fp, fn, tn);
}

export function groupMetrics(
  pairs: ScorePair[],
  threshold: number,
  keyOf: (pair: ScorePair) => string,
): Record<string, ClassMetrics> {
  const groups = new Map<string, ScorePair[]>();
  for (const pair of pairs) {
    const key = keyOf(pair);
    const list = groups.get(key) ?? [];
    list.push(pair);
    groups.set(key, list);
  }
  const out: Record<string, ClassMetrics> = {};
  for (const [key, list] of [...groups.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    out[key] = classify(list, threshold);
  }
  return out;
}

export function reliability(
  pairs: ScorePair[],
  bins = 5,
): { bins: ReliabilityBin[]; ece: number } {
  const width = 1 / bins;
  const rows: ReliabilityBin[] = [];
  let ece = 0;
  const total = pairs.length || 1;
  for (let index = 0; index < bins; index += 1) {
    const lo = index * width;
    const hi = index === bins - 1 ? 1 : (index + 1) * width;
    const members = pairs.filter((pair) =>
      index === bins - 1
        ? pair.pEff >= lo && pair.pEff <= hi
        : pair.pEff >= lo && pair.pEff < hi,
    );
    const count = members.length;
    const positives = members.filter((pair) => pair.positive).length;
    const meanP =
      count === 0
        ? (lo + hi) / 2
        : members.reduce((sum, pair) => sum + pair.pEff, 0) / count;
    const rate = count === 0 ? 0 : positives / count;
    rows.push({ lo, hi, count, positives, meanP, rate });
    if (count > 0) ece += (count / total) * Math.abs(rate - meanP);
  }
  return { bins: rows, ece };
}

export function searchThresholds(pairs: ScorePair[]): {
  chill: ProfileProposal;
  balanced: ProfileProposal;
  assertive: ProfileProposal;
} {
  const grid: ProfileProposal[] = [];
  for (let report = 0.5; report <= 0.95 + 1e-9; report += 0.05) {
    const metrics = classify(pairs, round2(report));
    const uncertain = round2(Math.max(0.3, report - 0.2));
    grid.push({
      report: round2(report),
      uncertain,
      precision: metrics.precision,
      recall: metrics.recall,
      f1: metrics.f1,
    });
  }
  const balanced = best(grid, (row) => row.f1);
  const chill =
    grid
      .filter((row) => row.precision >= 0.9 || row.precision === 1)
      .sort(
        (a, b) =>
          b.precision - a.precision ||
          b.recall - a.recall ||
          b.report - a.report,
      )[0] ?? balanced;
  const assertive =
    grid
      .filter((row) => row.precision >= 0.5)
      .sort(
        (a, b) => b.recall - a.recall || b.f1 - a.f1 || a.report - b.report,
      )[0] ?? balanced;
  return { chill, balanced, assertive };
}

function best(
  rows: ProfileProposal[],
  score: (row: ProfileProposal) => number,
): ProfileProposal {
  return [...rows].sort(
    (a, b) =>
      score(b) - score(a) || b.precision - a.precision || b.report - a.report,
  )[0] as ProfileProposal;
}

function finishCounts(
  tp: number,
  fp: number,
  fn: number,
  tn: number,
): ClassMetrics {
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);
  const falsePositiveRate = fp + tn === 0 ? 0 : fp / (fp + tn);
  return { tp, fp, fn, tn, precision, recall, f1, falsePositiveRate };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
