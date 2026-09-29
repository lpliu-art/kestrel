import type { JevQuestion, JevRequest } from "../jev/types.ts";
import {
  batchQuestions,
  compilePass2,
  compileRuleQuestions,
  needsPass2,
  sharedQuestions,
} from "../rules/compile.ts";
import type { LoadedRule } from "../rules/schema.ts";
import type { Anchor } from "../rules/trigger.ts";
import type { JsonValue } from "../util/json.ts";

export function questionsForPass(input: {
  rules: LoadedRule[];
  anchors: Map<string, Anchor[]>;
  addedLineNumbers: number[];
  strategy: "two-pass" | "single-pass";
  pass: 1 | 2;
}): Record<string, JevQuestion> {
  if (input.pass === 2) {
    const questions: Record<string, JevQuestion> = {};
    for (const rule of input.rules) {
      Object.assign(
        questions,
        compilePass2(
          rule,
          input.addedLineNumbers,
          input.anchors.get(rule.id) ?? [],
        ),
      );
    }
    return questions;
  }
  const questions: Record<string, JevQuestion> = { ...sharedQuestions() };
  for (const rule of input.rules) {
    Object.assign(questions, compileRuleQuestions(rule));
    const anchors = input.anchors.get(rule.id) ?? [];
    if (input.strategy === "single-pass" && needsPass2(rule, anchors)) {
      Object.assign(
        questions,
        compilePass2(rule, input.addedLineNumbers, anchors),
      );
    }
  }
  return questions;
}

export function requestsFor(
  model: string,
  state: JsonValue,
  questions: Record<string, JevQuestion>,
): JevRequest[] {
  if (Object.keys(questions).length === 0) return [];
  const sharedKeys = Object.keys(questions).filter(
    (key) => key.startsWith("d.") || key.startsWith("u."),
  );
  return batchQuestions(state, questions, sharedKeys).map((batch) => ({
    model,
    state,
    questions: batch.questions,
  }));
}
