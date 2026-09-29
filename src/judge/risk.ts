import { round6 } from "../util/json.ts";

export interface UnitRisk {
  path: string;
  unitRisk: number;
  priority: number;
  dimensions: Record<string, number>;
}

export interface FileRisk {
  path: string;
  language: string;
  risk: number;
  units: number;
  dimensions: Record<string, number>;
  deepReview: boolean;
}

export function fileRisks(
  units: UnitRisk[],
  languages: Map<string, string>,
  reportPaths: Set<string>,
): FileRisk[] {
  const grouped = new Map<string, UnitRisk[]>();
  for (const unit of units) {
    const list = grouped.get(unit.path) ?? [];
    list.push(unit);
    grouped.set(unit.path, list);
  }
  const files: FileRisk[] = [];
  for (const [path, list] of grouped) {
    let product = 1;
    const dimensions: Record<string, number> = {};
    for (const unit of list) {
      product *= 1 - clamp01(unit.unitRisk);
      for (const [key, value] of Object.entries(unit.dimensions)) {
        dimensions[key] = Math.max(dimensions[key] ?? 0, value);
      }
    }
    const risk = round6(1 - product);
    const priority = Math.max(...list.map((unit) => unit.priority));
    const hasReport = reportPaths.has(path);
    files.push({
      path,
      language: languages.get(path) ?? "",
      risk,
      units: list.length,
      dimensions,
      deepReview: risk >= 0.8 && (!hasReport || priority >= 2.5),
    });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function unitRiskFromDimensions(
  dimensions: Record<string, number>,
): number {
  const values = Object.values(dimensions);
  if (values.length === 0) return 0;
  return round6(Math.max(...values));
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
