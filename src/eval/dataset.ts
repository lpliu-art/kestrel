import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";

export interface EvalLabel {
  ruleId: string;
  positive: boolean;
}

export interface EvalCase {
  id: string;
  path: string;
  source: string;
  labels: EvalLabel[];
}

export interface EvalDataset {
  name: string;
  kind: "internal" | "aacr";
  cases: EvalCase[];
  notes: string[];
  catalog?: AacrCatalog;
}

export interface AacrCatalog {
  projects: number;
  comments: number;
  byLanguage: Record<string, number>;
  judged: boolean;
  reason: string;
}

export async function loadDataset(path: string): Promise<EvalDataset> {
  const text = await readFile(path, "utf8");
  const parsed =
    path.endsWith(".yml") || path.endsWith(".yaml")
      ? parseYaml(text)
      : JSON.parse(text);
  return datasetFrom(parsed);
}

export function datasetFrom(parsed: unknown): EvalDataset {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Dataset must be a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  if (Array.isArray(record.cases)) {
    return {
      name: stringField(record.name, "dataset"),
      kind: record.kind === "aacr" ? "aacr" : "internal",
      cases: record.cases.map((item, index) => caseFrom(item, index)),
      notes: stringList(record.notes),
    };
  }
  if (Array.isArray(parsed)) return aacrProjects(parsed);
  if (Array.isArray(record.samples)) return aacrSamples(record);
  throw new Error("Dataset needs cases, samples, or an AACR project array");
}

function caseFrom(value: unknown, index: number): EvalCase {
  if (!value || typeof value !== "object") {
    throw new Error(`Case ${index} is not an object`);
  }
  const record = value as Record<string, unknown>;
  const labels = Array.isArray(record.labels) ? record.labels : [];
  return {
    id: stringField(record.id, `case-${index}`),
    path: stringField(record.path, `case-${index}.txt`),
    source: stringField(record.source, ""),
    labels: labels.map((label) => {
      const item = label as Record<string, unknown>;
      return {
        ruleId: stringField(item.ruleId, ""),
        positive: item.positive === true,
      };
    }),
  };
}

function aacrSamples(record: Record<string, unknown>): EvalDataset {
  const samples = record.samples as unknown[];
  const cases: EvalCase[] = [];
  let comments = 0;
  const byLanguage: Record<string, number> = {};
  for (const [index, sample] of samples.entries()) {
    if (!sample || typeof sample !== "object") continue;
    const item = sample as Record<string, unknown>;
    comments += 1;
    const language = stringField(item.project_main_language, "unknown");
    byLanguage[language] = (byLanguage[language] ?? 0) + 1;
    const hunk = typeof item.hunk === "string" ? item.hunk : "";
    const kestrel = item.kestrel as Record<string, unknown> | undefined;
    if (!hunk || !kestrel || typeof kestrel.ruleId !== "string") continue;
    cases.push({
      id: stringField(item.id, `aacr-${index}`),
      path: stringField(item.path, `aacr-${index}.txt`),
      source: hunk,
      labels: [
        {
          ruleId: kestrel.ruleId,
          positive: kestrel.positive === true || item.label === 1,
        },
      ],
    });
  }
  const judged = cases.length > 0;
  return {
    name: stringField(record.name, "aacr"),
    kind: "aacr",
    cases,
    notes: [
      "AACR-Bench is Apache-2.0 (https://github.com/alibaba/aacr-bench). The published JSON points at upstream pull requests and does not embed diffs.",
      ...stringList(record.notes),
    ],
    catalog: {
      projects: samples.length,
      comments,
      byLanguage,
      judged,
      reason: judged
        ? "Embedded hunks with kestrel labels were scored."
        : "No embedded hunks. This file is a catalog, not a per-rule judgment set.",
    },
  };
}

function aacrProjects(projects: unknown[]): EvalDataset {
  let comments = 0;
  const byLanguage: Record<string, number> = {};
  for (const project of projects) {
    if (!project || typeof project !== "object") continue;
    const item = project as Record<string, unknown>;
    const language = stringField(item.project_main_language, "unknown");
    const list = Array.isArray(item.comments) ? item.comments : [];
    comments += list.length;
    byLanguage[language] = (byLanguage[language] ?? 0) + list.length;
  }
  return {
    name: "aacr-bench",
    kind: "aacr",
    cases: [],
    notes: [
      "AACR-Bench license: Apache-2.0. Upstream: https://github.com/alibaba/aacr-bench.",
      "positive_samples.json and negative_samples.json identify commits; they do not include file text, so Kestrel cannot score rules offline from that file alone.",
    ],
    catalog: {
      projects: projects.length,
      comments,
      byLanguage,
      judged: false,
      reason:
        "Catalog only. Clone the upstream repositories or pass a sample with embedded hunks to score rules.",
    },
  };
}

function stringField(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
