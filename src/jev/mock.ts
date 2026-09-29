import type { LoadedRule } from "../rules/schema.ts";
import { type Anchor, compileRegex, lineHits } from "../rules/trigger.ts";
import { injectionProbability } from "../security/injection.ts";
import { treesitterHunkHit } from "../treesitter/query.ts";
import { parseStateHunk } from "../units/state.ts";
import { round6 } from "../util/json.ts";
import { estimateTokens } from "./tokens.ts";
import type {
  JevAnswer,
  JevProvider,
  JevQuestion,
  JevRequest,
} from "./types.ts";

export function createMockProvider(rules: LoadedRule[]): JevProvider {
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  return {
    name: "mock",
    isAI: false,
    async ask(req) {
      const hunk = hunkText(req);
      const answers: Record<string, JevAnswer> = {};
      const ruleP = new Map<string, number>();
      for (const [key, question] of Object.entries(req.questions)) {
        if (!key.startsWith("r.")) continue;
        const rule = byId.get(key.slice(2));
        const p = rule ? ruleProbability(rule, hunk) : 0.1;
        if (rule) ruleP.set(rule.id, p);
        answers[key] = { type: "noul", noul: p };
        void question;
      }
      for (const [key, question] of Object.entries(req.questions)) {
        if (key.startsWith("r.")) continue;
        if (key.startsWith("g.")) {
          const rest = key.slice(2);
          const dot = rest.lastIndexOf(".");
          const rule = byId.get(rest.slice(0, dot));
          const regex = rule?.mock?.guardPositive
            ? compileRegex(rule.mock.guardPositive)
            : undefined;
          const p = regex?.test(hunk) ? 0.9 : 0.05;
          answers[key] = { type: "noul", noul: p };
        } else if (key.startsWith("d.")) {
          const dimension = key.slice(2);
          let max = 0.1;
          for (const [id, p] of ruleP) {
            if (byId.get(id)?.dimension === dimension) max = Math.max(max, p);
          }
          answers[key] = { type: "noul", noul: round6(max) };
        } else if (key === "u.injection") {
          answers[key] = { type: "noul", noul: injectionProbability(hunk) };
        } else if (key === "u.priority") {
          const max = Math.max(0, ...ruleP.values());
          const score = max >= 0.8 ? 3 : max >= 0.5 ? 2 : max >= 0.2 ? 1 : 0;
          answers[key] = scoreAnswer(question, score);
        } else if (key.startsWith("sa.") && key.endsWith(".real")) {
          answers[key] = {
            type: "noul",
            noul: staticAlertProbability(hunk, question),
          };
        } else if (key.startsWith("sa.") && key.endsWith(".matters")) {
          answers[key] = {
            type: "noul",
            noul: staticAlertProbability(hunk, question),
          };
        } else if (key.startsWith("sa.") && key.endsWith(".sev")) {
          const text = `${hunk}\n${questionText(question)}`;
          const index = /level"?:\s*"error"|level: error/i.test(text) ? 2 : 1;
          answers[key] = scoreAnswer(question, index);
        } else if (key.startsWith("s.")) {
          const rule = byId.get(key.slice(2));
          answers[key] = scoreAnswer(question, severityIndex(rule));
        } else if (key.startsWith("loc.")) {
          const rule = byId.get(key.slice(4));
          answers[key] = choiceAnswer(
            question,
            rule ? chooseLine(rule, req) : "none",
          );
        } else if (key === "pr.risk" || key === "pr.tests") {
          answers[key] = {
            type: "noul",
            noul: pullRequestProbability(key, req),
          };
        } else if (question.type === "choice") {
          answers[key] = choiceAnswer(question, "other");
        } else if (question.type === "score") {
          answers[key] = scoreAnswer(question, 0);
        } else {
          answers[key] = { type: "noul", noul: 0.1 };
        }
      }
      return {
        model: "mock-1",
        answers,
        usage: {
          input_tokens: estimateTokens(req),
          output_tokens: Object.keys(req.questions).length * 4,
        },
        meta: { provider: "mock" },
      };
    },
  };
}

function pullRequestProbability(key: string, req: JevRequest): number {
  const text = hunkText(req);
  if (key === "pr.tests")
    return /"tests_changed":\[\]/.test(text) ? 0.84 : 0.12;
  return /"files":\[\]/.test(text) ? 0.12 : 0.81;
}

function staticAlertProbability(hunk: string, question: JevQuestion): number {
  const text = `${hunk}\n${questionText(question)}`;
  if (
    /placeholder|false positive|eslint-disable|@ts-ignore|@ts-expect-error|\bnoqa\b|\bnosec\b|not a problem/i.test(
      text,
    )
  )
    return 0.1;
  return 0.9;
}

function questionText(question: JevQuestion): string {
  if (typeof question.instructions === "string") return question.instructions;
  return JSON.stringify(question.instructions);
}

function hunkText(req: JevRequest): string {
  if (typeof req.state === "string") return req.state;
  if (req.state && typeof req.state === "object" && !Array.isArray(req.state)) {
    const hunk = req.state.hunk;
    return typeof hunk === "string" ? hunk : JSON.stringify(req.state);
  }
  return JSON.stringify(req.state);
}

function ruleProbability(rule: LoadedRule, hunk: string): number {
  if (rule.mock?.negative && compileRegex(rule.mock.negative)?.test(hunk))
    return 0.1;
  if (rule.mock?.positive && compileRegex(rule.mock.positive)?.test(hunk))
    return 0.9;
  const parsed = parseStateHunk(hunk);
  const addedText = parsed.added.map((line) => line.text).join("\n");
  const removedText = parsed.deleted.map((line) => line.text).join("\n");
  const treesitter = treesitterHunkHit(rule, hunk);
  const regexRule =
    rule.trigger.kind === "treesitter" && rule.trigger.pattern
      ? {
          ...rule,
          trigger: { ...rule.trigger, kind: "regex" as const },
        }
      : rule;
  const triggered =
    treesitter === true ||
    (treesitter !== false &&
      (lineHits(regexRule, addedText) ||
        lineHits(regexRule, removedText) ||
        parsed.added.some((line) => lineHits(regexRule, line.text)) ||
        lineHits(regexRule, hunk)));
  if (triggered) return 0.9;
  if (rule.trigger.kind === "always") return 0.2;
  if (rule.trigger.kind === "removed" && parsed.deleted.length > 0) return 0.9;
  return 0.1;
}

function severityIndex(rule: LoadedRule | undefined): number {
  if (!rule) return 0;
  if (rule.mock?.severity !== undefined) return rule.mock.severity;
  const index = rule.severity.map.indexOf(rule.severity.default);
  return index >= 0 ? index : 0;
}

function chooseLine(rule: LoadedRule, req: JevRequest): string {
  const parsed = parseStateHunk(hunkText(req));
  for (const line of parsed.added) {
    const positive = rule.mock?.positive
      ? compileRegex(rule.mock.positive)?.test(line.text)
      : false;
    if (line.no !== undefined && (lineHits(rule, line.text) || positive))
      return `L${line.no}`;
  }
  return "none";
}

function scoreAnswer(question: JevQuestion, index: number): JevAnswer {
  const levels =
    question.type === "score" ? question.criteria : ["low", "high"];
  const idx = Math.max(0, Math.min(levels.length - 1, Math.round(index)));
  const legend: Record<string, string> = {};
  const probabilities: Record<string, number> = {};
  const others = Math.max(1, levels.length - 1);
  levels.forEach((level, i) => {
    legend[String(i)] =
      typeof level === "string" ? level : JSON.stringify(level);
    probabilities[String(i)] =
      i === idx ? (levels.length === 1 ? 1 : 0.9) : round6(0.1 / others);
  });
  return { type: "score", score: idx, confidence: 0.9, legend, probabilities };
}

function choiceAnswer(question: JevQuestion, choice: string): JevAnswer {
  const keys =
    question.type === "choice" ? Object.keys(question.criteria) : ["none"];
  const selected = keys.includes(choice)
    ? choice
    : keys.includes("none")
      ? "none"
      : (keys[0] ?? "none");
  const probabilities: Record<string, number> = {};
  const others = Math.max(1, keys.length - 1);
  for (const key of keys)
    probabilities[key] =
      key === selected ? (keys.length === 1 ? 1 : 0.9) : round6(0.1 / others);
  return { type: "choice", choice: selected, confidence: 0.9, probabilities };
}

export function anchorsFromState(
  rule: LoadedRule,
  stateText: string,
): Anchor[] {
  const parsed = parseStateHunk(stateText);
  return parsed.added
    .filter((line) => line.no !== undefined && lineHits(rule, line.text))
    .map((line) => ({ line: line.no as number, text: line.text, groups: [] }));
}
