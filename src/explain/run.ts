import type { Finding, Report } from "../report/model.ts";

export function explainFinding(report: Report, findingId: string): string {
  const finding = report.findings.find(
    (item) => item.id === findingId || item.fingerprint === findingId,
  );
  if (!finding) return "";
  return renderExplanation(finding);
}

export function renderExplanation(finding: Finding): string {
  const lines = [
    `finding ${finding.id}`,
    `rule ${finding.ruleId}`,
    `severity ${finding.severity}`,
    `band ${finding.band}`,
    `probability ${finding.probability}`,
    `pEff ${finding.pEff}`,
    `model ${finding.trace?.model ?? "(not recorded)"}`,
    `profile ${finding.trace?.profile || "(not recorded)"}`,
  ];
  if (finding.trace) {
    lines.push(
      `thresholds report=${finding.trace.thresholds.report} uncertain=${finding.trace.thresholds.uncertain}`,
    );
    lines.push("questions:");
    if (finding.trace.questions.length === 0)
      lines.push("- (none — deterministic finding)");
    for (const question of finding.trace.questions) {
      const answer = formatAnswer(question.answer);
      lines.push(`- ${question.key} ${answer}`);
      lines.push(`  ${formatInstructions(question.instructions)}`);
    }
  } else {
    lines.push(
      "This report has no stored trace for the finding. Re-run the review to record questions and answers.",
    );
  }
  return `${lines.join("\n")}\n`;
}

function formatAnswer(answer: unknown): string {
  if (!answer || typeof answer !== "object") return "answer=(none)";
  const record = answer as Record<string, unknown>;
  if (record.type === "noul") return `noul=${record.noul}`;
  if (record.type === "choice")
    return `choice=${record.choice} confidence=${record.confidence}`;
  if (record.type === "score")
    return `score=${record.score} confidence=${record.confidence}`;
  return `answer=${JSON.stringify(answer)}`;
}

function formatInstructions(instructions: unknown): string {
  if (typeof instructions === "string") return instructions;
  if (
    instructions &&
    typeof instructions === "object" &&
    "question" in instructions
  ) {
    const question = (instructions as { question?: unknown }).question;
    return typeof question === "string"
      ? question
      : JSON.stringify(instructions);
  }
  return JSON.stringify(instructions);
}
