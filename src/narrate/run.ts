import type { JevProvider } from "../jev/types.ts";
import type { Finding } from "../report/model.ts";
import { completeNarration, type LlmProtocol } from "./client.ts";
import type { LlmRewrite } from "./parse.ts";
import { verifyRewrite } from "./verify.ts";

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 } as const;

export interface NarrationSettings {
  enabled: boolean;
  protocol: LlmProtocol;
  baseURL: string;
  model: string;
  apiKeyEnv: string;
  maxFindings: number;
  verifyWithJev: boolean;
}

export interface NarrationRecord {
  enabled: boolean;
  attempted: number;
  kept: number;
  fallback: number;
  verifyFailed: number;
}

export interface NarrateInput {
  findings: Finding[];
  settings: NarrationSettings;
  env: NodeJS.ProcessEnv;
  provider: JevProvider;
  model: string;
  fetchImpl?: typeof fetch;
}

export interface NarrateResult {
  findings: Finding[];
  narration?: NarrationRecord;
  warning?: string;
}

export async function narrateFindings(
  input: NarrateInput,
): Promise<NarrateResult> {
  if (!input.settings.enabled) return { findings: input.findings };
  const key = input.env[input.settings.apiKeyEnv];
  if (!key) {
    return {
      findings: input.findings,
      narration: {
        enabled: true,
        attempted: 0,
        kept: 0,
        fallback: 0,
        verifyFailed: 0,
      },
      warning: `LLM narration is enabled but ${input.settings.apiKeyEnv} is not set; template comments were kept.`,
    };
  }
  const selected = topFindings(input.findings, input.settings.maxFindings);
  const narration: NarrationRecord = {
    enabled: true,
    attempted: 0,
    kept: 0,
    fallback: 0,
    verifyFailed: 0,
  };
  const rewritten = new Map<string, Finding>();
  for (const finding of selected) {
    narration.attempted += 1;
    let rewrite: LlmRewrite;
    try {
      rewrite = await completeNarration({
        protocol: input.settings.protocol,
        baseURL: input.settings.baseURL,
        model: input.settings.model || "llm",
        apiKey: key,
        prompt: promptFor(finding),
        fetchImpl: input.fetchImpl,
      });
    } catch {
      narration.fallback += 1;
      continue;
    }
    if (input.settings.verifyWithJev) {
      try {
        const verdict = await verifyRewrite({
          provider: input.provider,
          model: input.model,
          finding,
          rewrite,
        });
        if (!verdict.keep) {
          narration.fallback += 1;
          if (verdict.verifyFailed) narration.verifyFailed += 1;
          continue;
        }
      } catch {
        narration.fallback += 1;
        narration.verifyFailed += 1;
        continue;
      }
    }
    rewritten.set(finding.id, applyRewrite(finding, rewrite));
    narration.kept += 1;
  }
  return {
    findings: input.findings.map(
      (finding) => rewritten.get(finding.id) ?? finding,
    ),
    narration,
  };
}

export function topFindings(findings: Finding[], limit: number): Finding[] {
  return findings
    .filter((finding) => finding.band === "report")
    .sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        b.pEff - a.pEff ||
        a.id.localeCompare(b.id),
    )
    .slice(0, Math.max(0, limit));
}

function applyRewrite(finding: Finding, rewrite: LlmRewrite): Finding {
  return {
    ...finding,
    message: rewrite.explanation,
    fix: {
      hint: rewrite.suggestion?.code ?? finding.fix.hint,
      suggestion: null,
    },
    llm: null,
  };
}

function promptFor(finding: Finding): string {
  return [
    "Rewrite the review comment as JSON.",
    'Return only {"explanation": string, "suggestion"?: {"code": string, "startLine": number, "endLine": number}}.',
    "Do not change the judgment, the severity, or which issue is being described.",
    `rule: ${finding.ruleId}`,
    `severity: ${finding.severity}`,
    `title: ${finding.title}`,
    `template: ${finding.message}`,
    `why: ${finding.why}`,
    `hint: ${finding.fix.hint}`,
    `path: ${finding.location.path}:${finding.location.startLine}`,
    `snippet:\n${finding.snippet}`,
  ].join("\n");
}
