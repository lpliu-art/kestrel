import type { UnitContext } from "../plugins/api.ts";
import type { LoadedRule } from "../rules/schema.ts";
import { redactText } from "../security/redact.ts";
import type { ReviewUnit } from "../units/build.ts";
import { serializeHunk } from "../units/state.ts";
import type { JsonValue } from "../util/json.ts";

export function buildReviewState(input: {
  unit: ReviewUnit;
  rules: LoadedRule[];
  context?: UnitContext;
  redact: boolean;
}): JsonValue {
  const lines = input.unit.lines.map((line) => ({
    ...line,
    text: input.redact ? redactText(line.text).text : line.text,
  }));
  const hunk = serializeHunk(input.unit.header, lines);
  const state: { [key: string]: JsonValue } = {
    file: {
      path: input.unit.path,
      language: input.unit.languageId,
      frameworks: input.unit.frameworks,
    },
    hunk,
    tests_changed: input.unit.testsChanged,
  };
  const enclosing = input.context?.enclosing;
  if (enclosing) {
    const text = input.redact
      ? redactText(enclosing.text).text
      : enclosing.text;
    state.enclosing = {
      kind: enclosing.kind,
      ...(enclosing.name ? { name: enclosing.name } : {}),
      startLine: enclosing.startLine,
      endLine: enclosing.endLine,
      text,
    };
  }
  const wantsImports = input.rules.some((rule) =>
    rule.context?.includes("imports"),
  );
  if (wantsImports && input.context?.imports) {
    state.imports = input.context.imports.map((line) =>
      input.redact ? redactText(line).text : line,
    );
  }
  return state;
}
