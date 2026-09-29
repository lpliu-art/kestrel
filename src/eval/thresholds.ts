import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prefixesFor } from "./plugins.ts";

export function formatThreshold(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export function applyThresholds(
  yaml: string,
  options: { prefixes: readonly string[]; report: number; uncertain: number },
): { yaml: string; ids: string[] } {
  const report = formatThreshold(options.report);
  const uncertain = formatThreshold(options.uncertain);
  const lines = yaml.split("\n");
  const out: string[] = [];
  const ids: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const id = lines[index]?.match(/^ {2}- id: (\S+)\s*$/)?.[1];
    if (!id) {
      out.push(lines[index] ?? "");
      index += 1;
      continue;
    }
    const start = index;
    index += 1;
    while (index < lines.length && !/^ {2}- id: /.test(lines[index] ?? "")) {
      index += 1;
    }
    const block = lines.slice(start, index);
    if (!options.prefixes.some((prefix) => id.startsWith(prefix))) {
      out.push(...block);
      continue;
    }
    const rewritten = rewriteBlock(block, report, uncertain);
    if (rewritten.join("\n") !== block.join("\n")) ids.push(id);
    out.push(...rewritten);
  }
  return { yaml: out.join("\n"), ids };
}

export function applyThresholdsToDir(
  dir: string,
  proposal: { report: number; uncertain: number },
  plugin?: string,
): string[] {
  const prefixes = plugin
    ? prefixesFor(plugin)
    : [
        "core.",
        "ts.",
        "react.",
        "vue.",
        "py.",
        "java.",
        "go.",
        "rust.",
        "csharp.",
      ];
  const changed: string[] = [];
  for (const file of yamlFiles(dir)) {
    const text = readFileSync(file, "utf8");
    const result = applyThresholds(text, {
      prefixes,
      report: proposal.report,
      uncertain: proposal.uncertain,
    });
    if (result.yaml !== text) {
      writeFileSync(file, result.yaml);
      changed.push(...result.ids);
    }
  }
  return changed;
}

function rewriteBlock(
  block: string[],
  report: string,
  uncertain: string,
): string[] {
  const thresholdAt = block.findIndex((line) => /^ {4}thresholds:/.test(line));
  if (thresholdAt >= 0) {
    const next = [...block];
    let cursor = thresholdAt + 1;
    let sawReport = false;
    let sawUncertain = false;
    while (
      cursor < next.length &&
      (/^ {6}/.test(next[cursor] ?? "") || (next[cursor] ?? "").trim() === "")
    ) {
      const line = next[cursor] ?? "";
      if (line.startsWith("      report:")) {
        next[cursor] = `      report: ${report}`;
        sawReport = true;
      } else if (line.startsWith("      uncertain:")) {
        next[cursor] = `      uncertain: ${uncertain}`;
        sawUncertain = true;
      }
      cursor += 1;
    }
    const insert: string[] = [];
    if (!sawReport) insert.push(`      report: ${report}`);
    if (!sawUncertain) insert.push(`      uncertain: ${uncertain}`);
    if (insert.length > 0) next.splice(thresholdAt + 1, 0, ...insert);
    return next;
  }
  const insertion = [
    "    thresholds:",
    `      report: ${report}`,
    `      uncertain: ${uncertain}`,
  ];
  const messageAt = block.findIndex((line) => line.startsWith("    message:"));
  if (messageAt === -1) return [...block, ...insertion];
  return [
    ...block.slice(0, messageAt),
    ...insertion,
    ...block.slice(messageAt),
  ];
}

function yamlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...yamlFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".yml")) out.push(path);
  }
  return out.sort();
}
