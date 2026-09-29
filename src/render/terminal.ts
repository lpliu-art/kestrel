import pc from "picocolors";
import type { Report } from "../report/model.ts";

const MOCK_BANNER = {
  "zh-CN": "MOCK — 非 AI 判断，仅用于测试/演示",
  en: "MOCK — not an AI judgment; for tests and demos only",
} as const;

export function renderTerminal(
  report: Report,
  showUncertain: "hidden" | "collapsed" | "expanded",
): string {
  const zh = report.run.language === "zh-CN";
  const lines: string[] = [];
  if (
    report.provider.name === "mock" ||
    (report.provider.name === "replay" && !report.provider.isAI)
  ) {
    lines.push(pc.yellow(pc.bold(MOCK_BANNER[report.run.language])));
  }
  if (report.preview) {
    lines.push(
      zh
        ? `预览：约 ${report.preview.estimatedTokens} tokens，预计 $${report.preview.estimatedCostUSD.toFixed(6)}，未调用模型。`
        : `Preview: ~${report.preview.estimatedTokens} tokens, est. $${report.preview.estimatedCostUSD.toFixed(6)}. No model call.`,
    );
  }
  const s = report.summary;
  lines.push(
    `${pc.green("✔")} ${s.filesChanged} files changed · ${s.filesReviewed} reviewable · ${report.skipped.length} skipped`,
  );
  lines.push(
    `${pc.green("✔")} ${s.units} review units · ${report.run.requests} requests (${report.run.cachedRequests} cached) · ${report.run.durationMs}ms · ~$${report.run.costUSD.toFixed(6)} · ${report.provider.model}`,
  );
  const visible = report.findings.filter(
    (finding) => finding.band === "report",
  );
  const uncertain = report.findings.filter(
    (finding) => finding.band === "uncertain",
  );
  if (visible.length === 0) {
    lines.push(zh ? "没有达到报告阈值的发现。" : "No report-band findings.");
  }
  for (const finding of visible) {
    lines.push(
      `${pc.red("✖")} ${finding.severity.toUpperCase()}  ${finding.location.path}:${finding.location.startLine}  [${finding.ruleId}] p=${finding.pEff.toFixed(2)}`,
    );
    lines.push(`  ${finding.message}`);
    if (finding.fix.hint)
      lines.push(
        zh ? `  建议：${finding.fix.hint}` : `  Hint: ${finding.fix.hint}`,
      );
  }
  if (uncertain.length > 0 && showUncertain === "collapsed") {
    lines.push(
      zh
        ? `另有 ${uncertain.length} 条不确定发现（已折叠）。`
        : `${uncertain.length} uncertain finding(s) collapsed.`,
    );
  }
  if (uncertain.length > 0 && showUncertain === "expanded") {
    for (const finding of uncertain) {
      lines.push(
        `${pc.dim("?")} ${finding.severity.toUpperCase()}  ${finding.location.path}:${finding.location.startLine}  [${finding.ruleId}] p=${finding.pEff.toFixed(2)}`,
      );
      lines.push(pc.dim(`  ${finding.message}`));
    }
  }
  if (report.pullRequest) lines.push(report.pullRequest.conclusion);
  if (report.narration?.enabled) {
    lines.push(
      zh
        ? `叙述器：尝试 ${report.narration.attempted}，保留 ${report.narration.kept}，回退 ${report.narration.fallback}，复核失败 ${report.narration.verifyFailed}。`
        : `Narrator: attempted ${report.narration.attempted}, kept ${report.narration.kept}, fallback ${report.narration.fallback}, verify failed ${report.narration.verifyFailed}.`,
    );
  }
  if (report.handoff.deepReview.length > 0) {
    for (const file of report.handoff.deepReview) {
      lines.push(
        zh
          ? `建议深审 ${file.path}（风险 ${file.risk.toFixed(2)}）`
          : `Deep-review suggested: ${file.path} (risk ${file.risk.toFixed(2)})`,
      );
    }
  }
  if (report.static) {
    lines.push(
      zh
        ? `静态告警 ${report.static.imported} 条，diff 内 ${report.static.onDiff} 条，保留 ${report.static.kept}，丢弃 ${report.static.dropped}`
        : `Static alerts imported ${report.static.imported}, on diff ${report.static.onDiff}, kept ${report.static.kept}, dropped ${report.static.dropped}`,
    );
  }
  for (const warning of report.warnings) lines.push(pc.yellow(`! ${warning}`));
  lines.push(
    `Verdict: ${report.verdict.decision.toUpperCase()} — ${report.verdict.reasons.join(" ")}`,
  );
  if (report.preview?.payloads) {
    lines.push(
      zh
        ? "将发送的内容（已脱敏）："
        : "Payloads that would be sent (redacted):",
    );
    for (const payload of report.preview.payloads) {
      lines.push(`--- ${payload.unitId} (${payload.tokens} tokens)`);
      lines.push(
        typeof payload.state === "string"
          ? payload.state
          : JSON.stringify(payload.state, null, 2),
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
