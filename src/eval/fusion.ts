import { effectiveProbability, type FusionWeights } from "../judge/decide.ts";
import { classify, reliability, type ScorePair } from "./metrics.ts";

export interface FusionRow {
  pMain: number;
  guards: Array<{ p: number; weight: number }>;
  positive: boolean;
}

export interface FusionComparison {
  weights: FusionWeights;
  heuristic: { f1: number; ece: number };
  logistic: { f1: number; ece: number };
  adopt: boolean;
  realModel: false;
  note: string;
}

export function compareFusion(
  rows: FusionRow[],
  threshold: number,
): FusionComparison {
  const weights = fitLogistic(rows);
  const heuristicPairs = rows.map((row) =>
    pair(row, effectiveProbability(row.pMain, row.guards)),
  );
  const logisticPairs = rows.map((row) =>
    pair(row, effectiveProbability(row.pMain, row.guards, weights)),
  );
  const heuristic = summarize(heuristicPairs, threshold);
  const logistic = summarize(logisticPairs, threshold);
  const adopt =
    logistic.f1 + 1e-9 >= heuristic.f1 && logistic.ece < heuristic.ece;
  return {
    weights,
    heuristic,
    logistic,
    adopt,
    realModel: false,
    note: adopt
      ? "Logistic fusion held F1 and lowered ECE on this labeled set. Shipped judgments stay on the heuristic. Treat the weights as a proposal, and only after a live Jev run."
      : "Logistic fusion did not beat the heuristic on this labeled set. Shipped p_eff stays p × Π(1−g)^w.",
  };
}

export function syntheticFusionStudy(): FusionComparison {
  const truth: FusionWeights = { bias: -2.2, main: 4.4, guard: -3.1 };
  const rows: FusionRow[] = [];
  for (let main = 0; main <= 10; main += 1) {
    for (let guard = 0; guard <= 10; guard += 1) {
      const pMain = main / 10;
      const guards = [{ p: guard / 10, weight: 1 }];
      const p = effectiveProbability(pMain, guards, truth);
      rows.push({ pMain, guards, positive: p >= 0.55 });
    }
  }
  return compareFusion(rows, 0.75);
}

function pair(row: FusionRow, pEff: number): ScorePair {
  return {
    ruleId: "study",
    pluginId: "study",
    positive: row.positive,
    pEff,
  };
}

function summarize(
  pairs: ScorePair[],
  threshold: number,
): {
  f1: number;
  ece: number;
} {
  return {
    f1: classify(pairs, threshold).f1,
    ece: reliability(pairs).ece,
  };
}

export function fitLogistic(rows: FusionRow[]): FusionWeights {
  let bias = 0;
  let main = 1;
  let guard = -1;
  if (rows.length === 0) return { bias, main, guard };
  for (let iter = 0; iter < 25; iter += 1) {
    let g0 = 0;
    let g1 = 0;
    let g2 = 0;
    let h00 = 1e-4;
    let h11 = 1e-4;
    let h22 = 1e-4;
    let h01 = 0;
    let h02 = 0;
    let h12 = 0;
    for (const row of rows) {
      const mean =
        row.guards.length === 0
          ? 0
          : row.guards.reduce((sum, item) => sum + item.p, 0) /
            row.guards.length;
      const z = bias + main * row.pMain + guard * mean;
      const p = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
      const y = row.positive ? 1 : 0;
      const err = p - y;
      const w = Math.max(p * (1 - p), 1e-4);
      g0 += err;
      g1 += err * row.pMain;
      g2 += err * mean;
      h00 += w;
      h11 += w * row.pMain * row.pMain;
      h22 += w * mean * mean;
      h01 += w * row.pMain;
      h02 += w * mean;
      h12 += w * row.pMain * mean;
    }
    const step = solve3(h00, h01, h02, h11, h12, h22, g0, g1, g2);
    bias -= step[0];
    main -= step[1];
    guard -= step[2];
  }
  return { bias, main, guard };
}

function solve3(
  a00: number,
  a01: number,
  a02: number,
  a11: number,
  a12: number,
  a22: number,
  b0: number,
  b1: number,
  b2: number,
): [number, number, number] {
  const det =
    a00 * (a11 * a22 - a12 * a12) -
    a01 * (a01 * a22 - a12 * a02) +
    a02 * (a01 * a12 - a11 * a02);
  if (Math.abs(det) < 1e-12) return [0, 0, 0];
  const x0 =
    (b0 * (a11 * a22 - a12 * a12) -
      a01 * (b1 * a22 - a12 * b2) +
      a02 * (b1 * a12 - a11 * b2)) /
    det;
  const x1 =
    (a00 * (b1 * a22 - a12 * b2) -
      b0 * (a01 * a22 - a12 * a02) +
      a02 * (a01 * b2 - b1 * a02)) /
    det;
  const x2 =
    (a00 * (a11 * b2 - b1 * a12) -
      a01 * (a01 * b2 - b1 * a02) +
      b0 * (a01 * a12 - a11 * a02)) /
    det;
  return [x0, x1, x2];
}
