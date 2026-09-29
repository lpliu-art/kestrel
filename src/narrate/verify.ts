import type { JevAnswer, JevProvider, JevQuestion } from "../jev/types.ts";
import type { Finding } from "../report/model.ts";
import type { JsonValue } from "../util/json.ts";
import type { LlmRewrite } from "./parse.ts";

export const VERIFY_THRESHOLDS = {
  addresses: 0.7,
  unrelated: 0.3,
  contradicts: 0.3,
} as const;

export function verificationQuestions(): Record<string, JevQuestion> {
  return {
    "v.addresses": {
      type: "noul",
      instructions:
        "`suggestion.code` resolves the issue described in `finding` at `finding.line`",
    },
    "v.unrelated": {
      type: "noul",
      instructions: "`suggestion.code` changes behavior unrelated to `finding`",
    },
    "v.contradicts": {
      type: "noul",
      instructions: "`explanation` contradicts `finding` or the code in `hunk`",
    },
  };
}

export function verificationState(
  finding: Finding,
  rewrite: LlmRewrite,
): JsonValue {
  return {
    hunk: finding.snippet,
    finding: {
      ruleId: finding.ruleId,
      line: finding.location.startLine,
      message: finding.message,
      severity: finding.severity,
    },
    suggestion: {
      code: rewrite.suggestion?.code ?? "",
      startLine: rewrite.suggestion?.startLine ?? finding.location.startLine,
      endLine: rewrite.suggestion?.endLine ?? finding.location.endLine,
    },
    explanation: rewrite.explanation,
  };
}

export function keepRewrite(answers: Record<string, JevAnswer>): {
  keep: boolean;
  verifyFailed: boolean;
} {
  const addresses = noul(answers["v.addresses"]);
  const unrelated = noul(answers["v.unrelated"]);
  const contradicts = noul(answers["v.contradicts"]);
  if (
    addresses === undefined ||
    unrelated === undefined ||
    contradicts === undefined
  ) {
    return { keep: false, verifyFailed: true };
  }
  const keep =
    addresses >= VERIFY_THRESHOLDS.addresses &&
    unrelated <= VERIFY_THRESHOLDS.unrelated &&
    contradicts <= VERIFY_THRESHOLDS.contradicts;
  return { keep, verifyFailed: !keep };
}

export async function verifyRewrite(input: {
  provider: JevProvider;
  model: string;
  finding: Finding;
  rewrite: LlmRewrite;
}): Promise<{ keep: boolean; verifyFailed: boolean }> {
  const response = await input.provider.ask({
    model: input.model,
    state: verificationState(input.finding, input.rewrite),
    questions: verificationQuestions(),
  });
  return keepRewrite(response.answers);
}

function noul(answer: JevAnswer | undefined): number | undefined {
  if (answer?.type !== "noul") return undefined;
  return answer.noul;
}
