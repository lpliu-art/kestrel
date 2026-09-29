import type { JevAnswer, JevProvider, JevQuestion } from "../jev/types.ts";
import type { JsonValue } from "../util/json.ts";

export interface PullRequestJudgment {
  risk: number;
  testGap: number;
  testsChanged: string[];
  conclusion: string;
  model: string;
  questions: Array<{
    key: string;
    instructions: unknown;
    answer: unknown;
  }>;
}

export function pullRequestQuestions(): Record<string, JevQuestion> {
  return {
    "pr.risk": {
      type: "noul",
      instructions: {
        question:
          "Does this change set introduce a material correctness or security risk?",
        focus: "The changed files and report_findings in state",
      },
    },
    "pr.tests": {
      type: "noul",
      instructions: {
        question:
          "Are the changed production files missing a corresponding test change?",
        focus: "tests_changed relative to the changed paths",
      },
    },
  };
}

export function pullRequestState(input: {
  files: string[];
  testsChanged: string[];
}): JsonValue {
  return {
    files: [...input.files].sort(),
    tests_changed: [...input.testsChanged].sort(),
  };
}

export function describePullRequest(input: {
  risk: number;
  testGap: number;
  testsChanged: string[];
  language: "zh-CN" | "en";
}): string {
  const risk =
    input.risk >= 0.75 ? "high" : input.risk >= 0.55 ? "medium" : "low";
  const tests =
    input.testsChanged.length > 0 ? input.testsChanged.join(", ") : "none";
  const gap = input.testGap >= 0.75;
  if (input.language === "zh-CN") {
    const label = risk === "high" ? "高" : risk === "medium" ? "中" : "低";
    return `PR 风险${label}（${input.risk.toFixed(2)}）。${gap ? "测试变更没有覆盖这次改动。" : "相关测试有改动。"}相关测试：${tests === "none" ? "无" : tests}。`;
  }
  return `Pull request risk ${risk} (${input.risk.toFixed(2)}). ${gap ? "Test changes do not cover this diff." : "Related tests changed."} Tests: ${tests}.`;
}

export async function judgePullRequest(input: {
  provider: JevProvider;
  model: string;
  files: string[];
  testsChanged: string[];
  language: "zh-CN" | "en";
}): Promise<PullRequestJudgment> {
  const questions = pullRequestQuestions();
  const response = await input.provider.ask({
    model: input.model,
    state: pullRequestState({
      files: input.files,
      testsChanged: input.testsChanged,
    }),
    questions,
  });
  const risk = noul(response.answers["pr.risk"]);
  const testGap = noul(response.answers["pr.tests"]);
  return {
    risk,
    testGap,
    testsChanged: [...input.testsChanged].sort(),
    conclusion: describePullRequest({
      risk,
      testGap,
      testsChanged: input.testsChanged,
      language: input.language,
    }),
    model: response.model,
    questions: Object.entries(questions).map(([key, question]) => ({
      key,
      instructions: question.instructions,
      answer: response.answers[key] ?? null,
    })),
  };
}

function noul(answer: JevAnswer | undefined): number {
  return answer?.type === "noul" ? answer.noul : 0;
}
