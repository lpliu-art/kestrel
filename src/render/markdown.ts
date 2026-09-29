import type { Report } from "../report/model.ts";

export function renderMarkdown(
  report: Report,
  showUncertain: "hidden" | "collapsed" | "expanded",
): string {
  const zh = report.run.language === "zh-CN";
  const lines: string[] = ["<!-- kestrel:summary -->", ""];
  if (
    report.provider.name === "mock" ||
    (report.provider.name === "replay" && !report.provider.isAI)
  ) {
    lines.push(
      zh
        ? "> **MOCK — 非 AI 判断，仅用于测试/演示**"
        : "> **MOCK — not an AI judgment; for tests and demos only**",
    );
    lines.push("");
  }
  lines.push(`# Kestrel ${report.verdict.decision}`, "");
  lines.push(`| | |`);
  lines.push(`| --- | --- |`);
  lines.push(
    `| ${zh ? "文件" : "Files"} | ${report.summary.filesReviewed}/${report.summary.filesChanged} |`,
  );
  lines.push(`| ${zh ? "单元" : "Units"} | ${report.summary.units} |`);
  lines.push(`| ${zh ? "模型" : "Model"} | ${report.provider.model} |`);
  lines.push(
    `| ${zh ? "请求" : "Requests"} | ${report.run.requests} (${report.run.cachedRequests} cached) |`,
  );
  lines.push(`| ${zh ? "费用" : "Cost"} | $${report.run.costUSD.toFixed(6)} |`);
  lines.push("");
  const groups = ["critical", "high", "medium", "low"] as const;
  for (const severity of groups) {
    const items = report.findings.filter(
      (finding) => finding.band === "report" && finding.severity === severity,
    );
    if (items.length === 0) continue;
    lines.push(`## ${severity}`, "");
    for (const finding of items) {
      lines.push(
        `- \`${finding.location.path}:${finding.location.startLine}\` **${finding.ruleId}** (p=${finding.pEff.toFixed(2)}) ${finding.message}`,
      );
    }
    lines.push("");
  }
  const uncertain = report.findings.filter(
    (finding) => finding.band === "uncertain",
  );
  if (uncertain.length > 0 && showUncertain !== "hidden") {
    lines.push("<details>");
    lines.push(
      `<summary>${zh ? "不确定" : "Uncertain"} (${uncertain.length})</summary>`,
      "",
    );
    if (showUncertain === "expanded") {
      for (const finding of uncertain) {
        lines.push(
          `- \`${finding.location.path}:${finding.location.startLine}\` ${finding.ruleId} ${finding.message}`,
        );
      }
    }
    lines.push("</details>", "");
  }
  if (report.static) {
    lines.push(`## ${zh ? "静态告警" : "Static alerts"}`, "");
    lines.push(
      `${zh ? "导入" : "Imported"} ${report.static.imported}, ${zh ? "保留" : "kept"} ${report.static.kept}, ${zh ? "丢弃" : "dropped"} ${report.static.dropped}`,
    );
    lines.push("");
  }
  if (report.handoff.deepReview.length > 0) {
    lines.push(`## ${zh ? "建议深审" : "Deep review"}`, "");
    for (const file of report.handoff.deepReview)
      lines.push(`- \`${file.path}\` risk ${file.risk.toFixed(2)}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
