export interface LlmRewrite {
  explanation: string;
  suggestion?: { code: string; startLine?: number; endLine?: number };
}

export function parseRewrite(text: string): LlmRewrite | undefined {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const record = value as {
    explanation?: unknown;
    suggestion?: unknown;
  };
  if (typeof record.explanation !== "string" || !record.explanation.trim())
    return undefined;
  const rewrite: LlmRewrite = { explanation: record.explanation.trim() };
  if (record.suggestion && typeof record.suggestion === "object") {
    const suggestion = record.suggestion as {
      code?: unknown;
      startLine?: unknown;
      endLine?: unknown;
    };
    if (typeof suggestion.code === "string" && suggestion.code.trim()) {
      rewrite.suggestion = { code: suggestion.code.trim() };
      if (typeof suggestion.startLine === "number")
        rewrite.suggestion.startLine = suggestion.startLine;
      if (typeof suggestion.endLine === "number")
        rewrite.suggestion.endLine = suggestion.endLine;
    }
  }
  return rewrite;
}
