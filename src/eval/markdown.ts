import type { ClassMetrics } from "./metrics.ts";
import type { EvalReport } from "./run.ts";

export function renderCalibrationMarkdown(report: EvalReport): string {
  const lines = [
    `# ${report.realModel ? "Live Jev calibration" : "Mock calibration"}`,
    "",
    report.banner,
    "",
    `- dataset: ${report.dataset} (${report.kind})`,
    `- provider: ${report.provider}`,
    `- model: ${report.model}`,
    `- realModel: ${report.realModel}`,
    `- decision threshold: ${report.threshold}`,
    "",
    "## Overall",
    "",
    metricsTable({ overall: report.overall }),
    "",
    `ECE ${report.reliability.ece.toFixed(3)}. Unlabeled reports: ${report.unlabeledReports}.`,
    "",
    "## By plugin",
    "",
    metricsTable(report.byPlugin),
    "",
    "## By rule",
    "",
    metricsTable(report.byRule),
    "",
    "## Suggested thresholds",
    "",
    "| profile | report | uncertain | precision | recall | f1 |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    profileRow("chill", report.proposals.chill),
    profileRow("balanced", report.proposals.balanced),
    profileRow("assertive", report.proposals.assertive),
    "",
    "The balanced row is the proposal an apply step would write into builtin rule packs. Question text is not changed.",
    "",
    "## Fusion",
    "",
    `- adopt: ${report.fusion.adopt}`,
    `- heuristic f1 ${report.fusion.heuristic.f1.toFixed(3)}, ECE ${report.fusion.heuristic.ece.toFixed(3)}`,
    `- logistic f1 ${report.fusion.logistic.f1.toFixed(3)}, ECE ${report.fusion.logistic.ece.toFixed(3)}`,
    `- synthetic study adopt=${report.study.adopt} (not a Jev measurement)`,
    "",
  ];
  if (report.notes.length > 0) {
    lines.push("## Notes", "");
    for (const note of report.notes) lines.push(`- ${note}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function profileRow(
  name: string,
  row: EvalReport["proposals"]["balanced"],
): string {
  return `| ${name} | ${row.report} | ${row.uncertain} | ${row.precision.toFixed(3)} | ${row.recall.toFixed(3)} | ${row.f1.toFixed(3)} |`;
}

function metricsTable(groups: Record<string, ClassMetrics>): string {
  const lines = [
    "| name | precision | recall | f1 | fp | tp | fn | tn |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const [name, metrics] of Object.entries(groups)) {
    lines.push(
      `| ${name} | ${metrics.precision.toFixed(3)} | ${metrics.recall.toFixed(3)} | ${metrics.f1.toFixed(3)} | ${metrics.fp} | ${metrics.tp} | ${metrics.fn} | ${metrics.tn} |`,
    );
  }
  return lines.join("\n");
}
