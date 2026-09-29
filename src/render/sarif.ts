import type { Finding, Report } from "../report/model.ts";
import { toolVersion } from "../util/package.ts";

export function renderSarif(
  report: Report,
  options: { includeUncertain: boolean },
): string {
  const findings = report.findings.filter(
    (finding) =>
      finding.band === "report" ||
      (options.includeUncertain && finding.band === "uncertain"),
  );
  const ruleIds = [
    ...new Set(findings.map((finding) => finding.ruleId)),
  ].sort();
  const rules = ruleIds.map((id) => {
    const sample = findings.find((finding) => finding.ruleId === id);
    return {
      id,
      shortDescription: { text: trim(sample?.title ?? id, 200) },
      help: {
        text: trim(
          `${sample?.why ?? ""} ${sample?.fix.hint ?? ""}`.trim(),
          400,
        ),
        markdown: `${sample?.why ?? ""}\n\n${sample?.fix.hint ?? ""}`,
      },
      properties: { category: sample?.category ?? "" },
    };
  });
  const results = findings.map((finding) => ({
    ruleId: finding.ruleId,
    level: sarifLevel(finding),
    message: { text: finding.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: finding.location.path },
          region: {
            startLine: finding.location.startLine,
            endLine: finding.location.endLine,
          },
        },
      },
    ],
    partialFingerprints: { "kestrel/v1": finding.fingerprint },
    properties: {
      probability: finding.probability,
      pEff: finding.pEff,
      band: finding.band,
      model: report.provider.model,
    },
  }));
  const doc = {
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "kestrel",
            version: toolVersion(),
            informationUri: "https://github.com/lpliu-art/kestrel",
            rules,
          },
        },
        results,
      },
    ],
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function sarifLevel(finding: Finding): "error" | "warning" | "note" {
  if (finding.band === "uncertain") return "note";
  if (finding.severity === "critical" || finding.severity === "high")
    return "error";
  if (finding.severity === "medium") return "warning";
  return "note";
}

function trim(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
