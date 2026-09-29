import { KestrelError } from "../util/errors.ts";

/** Rule-id prefixes owned by each builtin plugin filter. */
export const PLUGIN_PREFIXES: Record<string, readonly string[]> = {
  core: ["core."],
  typescript: ["ts.", "react.", "vue."],
  ts: ["ts."],
  react: ["react."],
  vue: ["vue."],
  python: ["py."],
  py: ["py."],
  java: ["java."],
  go: ["go."],
  rust: ["rust."],
  csharp: ["csharp."],
};

const FILTER_HELP =
  "Expected one of: core, typescript, python, java, go, rust, csharp.";

export function prefixesFor(plugin: string): readonly string[] {
  const found = PLUGIN_PREFIXES[plugin];
  if (!found) {
    throw new KestrelError(
      `Unknown plugin filter ${plugin}. ${FILTER_HELP}`,
      2,
      "usage",
    );
  }
  return found;
}

export interface FilterableDataset<T extends { ruleId: string }> {
  cases: Array<{ labels: T[] }>;
}

export function filterDataset<T extends FilterableDataset<{ ruleId: string }>>(
  dataset: T,
  plugin: string,
): T {
  const prefixes = prefixesFor(plugin);
  const cases = dataset.cases.flatMap((item) => {
    const labels = item.labels.filter((label) =>
      prefixes.some((prefix) => label.ruleId.startsWith(prefix)),
    );
    if (labels.length === 0) return [];
    return [{ ...item, labels }];
  });
  return { ...dataset, cases };
}

export function caseCountExceeds(
  cases: number,
  maxRequests: number | undefined,
): boolean {
  return maxRequests !== undefined && cases > maxRequests;
}
