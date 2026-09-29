import type { ResolvedConfig } from "../config/schema.ts";
import type { JevProvider } from "../jev/types.ts";
import type { FileRisk } from "../judge/risk.ts";
import { completeChat, parseJsonObject } from "../llm/chat.ts";
import type { Finding } from "../report/model.ts";
import type { ReviewUnit } from "../units/build.ts";
import { sha1 } from "../util/hash.ts";
import { round6 } from "../util/json.ts";

const SUPPORT_MIN = 0.7;

export async function runExplore(input: {
  files: FileRisk[];
  units: Array<{ unit: ReviewUnit }>;
  provider: JevProvider;
  model: string;
  llm: ResolvedConfig["llm"];
  env: NodeJS.ProcessEnv;
  language: "zh-CN" | "en";
  fetchImpl?: typeof fetch;
}): Promise<{
  findings: Finding[];
  warning?: string;
  proposed: number;
  kept: number;
}> {
  if (input.files.length === 0) return { findings: [], proposed: 0, kept: 0 };
  const apiKey = input.env[input.llm.apiKeyEnv];
  if (!apiKey) {
    return {
      findings: [],
      proposed: 0,
      kept: 0,
      warning: `Explore is enabled but ${input.llm.apiKeyEnv} is not set; no extra findings were added.`,
    };
  }
  if (!input.llm.model) {
    return {
      findings: [],
      proposed: 0,
      kept: 0,
      warning:
        "Explore is enabled but llm.model is empty; no extra findings were added.",
    };
  }
  const findings: Finding[] = [];
  let proposed = 0;
  let kept = 0;
  for (const file of input.files) {
    const units = input.units.filter((item) => item.unit.path === file.path);
    const source = units
      .map((item) => item.unit.sourceLines.join("\n"))
      .join("\n");
    let issues: Array<{ line: number; issue: string }> = [];
    try {
      issues = await proposeIssues({
        llm: input.llm,
        apiKey,
        path: file.path,
        source,
        fetchImpl: input.fetchImpl,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        findings,
        proposed,
        kept,
        warning: `Explore fell back after an LLM error (${message}).`,
      };
    }
    for (const issue of issues) {
      proposed += 1;
      const unit = units[0]?.unit;
      if (!unit) continue;
      const response = await input.provider.ask({
        model: input.model,
        state: {
          hunk: source,
          line: issue.line,
          issue: issue.issue,
        },
        questions: {
          "x.support": {
            type: "noul",
            instructions:
              "Is the issue in `issue` directly supported by line `line` of `hunk`?",
          },
        },
      });
      const answer = response.answers["x.support"];
      const p = answer?.type === "noul" ? answer.noul : 0;
      if (p < SUPPORT_MIN) continue;
      kept += 1;
      findings.push(
        exploreFinding(unit, issue, p, input.language, response.model),
      );
    }
  }
  return { findings, proposed, kept };
}

async function proposeIssues(input: {
  llm: ResolvedConfig["llm"];
  apiKey: string;
  path: string;
  source: string;
  fetchImpl?: typeof fetch;
}): Promise<Array<{ line: number; issue: string }>> {
  const text = await completeChat({
    protocol: input.llm.protocol,
    baseURL: input.llm.baseURL,
    model: input.llm.model,
    apiKey: input.apiKey,
    prompt: [
      "List concrete defects in this file. Return JSON only:",
      '{"issues":[{"line":1,"issue":"short English description"}]}',
      "At most 5 issues. line is a 1-based line number that appears in the file.",
      `path: ${input.path}`,
      input.source,
    ].join("\n"),
    fetchImpl: input.fetchImpl,
  });
  const parsed = parseJsonObject(text);
  const issues =
    parsed && typeof parsed === "object"
      ? (parsed as { issues?: unknown }).issues
      : undefined;
  if (!Array.isArray(issues)) return [];
  const out: Array<{ line: number; issue: string }> = [];
  for (const item of issues) {
    if (!item || typeof item !== "object") continue;
    const record = item as { line?: unknown; issue?: unknown };
    if (typeof record.issue !== "string" || record.issue.trim().length === 0)
      continue;
    const line =
      typeof record.line === "number"
        ? Math.max(1, Math.round(record.line))
        : 1;
    out.push({ line, issue: record.issue.trim() });
  }
  return out.slice(0, 5);
}

function exploreFinding(
  unit: ReviewUnit,
  issue: { line: number; issue: string },
  p: number,
  language: "zh-CN" | "en",
  model: string,
): Finding {
  const line = Math.min(issue.line, Math.max(1, unit.sourceLines.length));
  const evidence = unit.sourceLines[line - 1] ?? "";
  const fingerprint = sha1(
    `core.explore.llm-suspect|${unit.path}|${issue.issue}`,
  );
  const rounded = round6(p);
  const message =
    language === "zh-CN"
      ? `LLM 提出 · Jev 复核 p=${rounded.toFixed(2)}：${issue.issue}`
      : `LLM proposed · Jev verified p=${rounded.toFixed(2)}: ${issue.issue}`;
  return {
    id: `f_${fingerprint.slice(0, 8)}`,
    fingerprint,
    ruleId: "core.explore.llm-suspect",
    pluginId: "core",
    source: "explore",
    category: "exploration",
    severity: "medium",
    band: "report",
    probability: rounded,
    pEff: rounded,
    guards: {},
    severityScore: { score: 1, confidence: rounded },
    location: {
      path: unit.path,
      startLine: line,
      endLine: line,
      anchor: "unit",
      uncertain: false,
    },
    title:
      language === "zh-CN"
        ? "LLM 提出的疑点（Jev 已复核）"
        : "LLM suspect verified by Jev",
    message,
    why:
      language === "zh-CN"
        ? "这条疑点来自可选的探索模式，只有 Jev 认为代码直接支持它时才会留下。"
        : "This suspect comes from optional explore mode and is kept only when Jev says the code directly supports it.",
    fix: { hint: "", suggestion: null },
    llm: null,
    references: [],
    relatedRuleIds: [],
    snippet: evidence,
    trace: {
      model,
      profile: "",
      thresholds: { report: SUPPORT_MIN, uncertain: SUPPORT_MIN },
      questions: [
        {
          key: "x.support",
          type: "noul",
          instructions:
            "Is the issue in `issue` directly supported by line `line` of `hunk`?",
          answer: { type: "noul", noul: rounded },
        },
      ],
    },
  };
}
