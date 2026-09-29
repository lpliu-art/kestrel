import type { ResolvedConfig } from "../config/schema.ts";
import { completeChat, parseJsonObject } from "../llm/chat.ts";
import { KestrelError } from "../util/errors.ts";
import { round6 } from "../util/json.ts";
import { estimateTokens } from "./tokens.ts";
import type {
  JevAnswer,
  JevProvider,
  JevQuestion,
  JevRequest,
} from "./types.ts";

export function createLlmShimProvider(input: {
  config: ResolvedConfig;
  env: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): JevProvider {
  const apiKeyEnv = input.config.llm.apiKeyEnv;
  const apiKey = input.env[apiKeyEnv];
  if (!apiKey) {
    throw new KestrelError(
      `llm-shim is a degraded provider, not Jev. Set ${apiKeyEnv} or choose --provider mock.`,
      3,
      "auth",
    );
  }
  if (!input.config.llm.model) {
    throw new KestrelError(
      "llm-shim requires llm.model. It does not call Jev.",
      2,
      "usage",
    );
  }
  return {
    name: "llm-shim",
    isAI: false,
    async ask(req) {
      const text = await completeChat({
        protocol: input.config.llm.protocol,
        baseURL: input.config.llm.baseURL,
        model: input.config.llm.model,
        apiKey,
        prompt: shimPrompt(req),
        fetchImpl: input.fetchImpl,
      });
      let parsed: unknown;
      try {
        parsed = parseJsonObject(text);
      } catch {
        throw new KestrelError(
          "llm-shim returned JSON that could not be parsed. Answers were not sent to Jev.",
          3,
          "provider",
        );
      }
      return {
        model: `llm-shim:${input.config.llm.model}`,
        answers: answersFrom(req, parsed),
        usage: {
          input_tokens: estimateTokens(req),
          output_tokens: Object.keys(req.questions).length * 4,
        },
        meta: { provider: "llm-shim" },
      };
    },
  };
}

function shimPrompt(req: JevRequest): string {
  return [
    "You are a degraded stand-in for TypeSafe Jev. You are not Jev.",
    "Answer every question. Return JSON only:",
    '{"answers":{"<key>":{"type":"noul","noul":0.5}}}',
    "noul is 0..1. choice needs choice, probabilities, confidence. score needs score, legend, probabilities, confidence.",
    `state=${JSON.stringify(req.state)}`,
    `questions=${JSON.stringify(req.questions)}`,
  ].join("\n");
}

function answersFrom(
  req: JevRequest,
  parsed: unknown,
): Record<string, JevAnswer> {
  const bag =
    parsed && typeof parsed === "object"
      ? (parsed as { answers?: unknown }).answers
      : undefined;
  const raw =
    bag && typeof bag === "object" ? (bag as Record<string, unknown>) : {};
  const answers: Record<string, JevAnswer> = {};
  for (const [key, question] of Object.entries(req.questions)) {
    answers[key] = coerce(question, raw[key]);
  }
  return answers;
}

function coerce(question: JevQuestion, value: unknown): JevAnswer {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  if (question.type === "noul") {
    const noul = typeof record.noul === "number" ? record.noul : 0.5;
    return { type: "noul", noul: round6(Math.min(1, Math.max(0, noul))) };
  }
  if (question.type === "choice") {
    const keys = Object.keys(question.criteria);
    const choice =
      typeof record.choice === "string" && keys.includes(record.choice)
        ? record.choice
        : (keys.find((key) => key === "other" || key === "none") ??
          keys[0] ??
          "other");
    return {
      type: "choice",
      choice,
      probabilities: { [choice]: 1 },
      confidence: 0.4,
    };
  }
  const score = typeof record.score === "number" ? record.score : 0;
  return {
    type: "score",
    score: round6(score),
    legend: {},
    probabilities: { "0": 1 },
    confidence: 0.4,
  };
}
