import { z } from "zod";

export const SEVERITY_VALUES = ["low", "medium", "high", "critical"] as const;
export const CATEGORIES = [
  "correctness",
  "security",
  "reliability",
  "performance",
  "compatibility",
  "maintainability",
  "test",
  "style",
] as const;
export const DIMENSIONS = [
  "correctness",
  "security",
  "reliability",
  "performance",
  "compatibility",
  "maintainability",
  "test_gap",
] as const;

const localeMessage = z
  .object({
    body: z.string().min(1),
    why: z.string().optional(),
  })
  .strict();

const criterion = z
  .object({
    what: z.string().min(1),
    examples: z.array(z.string()).optional(),
  })
  .strict();

export const ruleSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*){2}$/),
    title: z
      .object({
        en: z.string().min(1),
        "zh-CN": z.string().min(1).optional(),
      })
      .strict(),
    category: z.enum(CATEGORIES),
    dimension: z.enum(DIMENSIONS).optional(),
    applies: z
      .object({
        languages: z.array(z.string()).optional(),
        paths: z.array(z.string()).optional(),
        frameworks: z.array(z.string()).optional(),
        minAddedLines: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    trigger: z
      .object({
        kind: z.enum(["regex", "always", "removed", "treesitter"]),
        on: z.enum(["added", "removed", "both"]).optional(),
        pattern: z.string().min(1).optional(),
        query: z.string().min(1).optional(),
        flags: z.string().optional(),
      })
      .strict(),
    context: z
      .array(z.enum(["hunk", "enclosing", "imports", "tests_changed"]))
      .optional(),
    question: z
      .object({
        question: z.string().min(1),
        focus: z.string().optional(),
        ignore: z.array(z.string()).optional(),
        true: criterion.optional(),
        false: criterion.optional(),
      })
      .strict(),
    guards: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9-]*$/),
            question: z.string().min(1),
            weight: z.number().positive().max(2).optional(),
          })
          .strict(),
      )
      .optional(),
    severity: z
      .object({
        levels: z.array(z.string().min(1)).min(2).max(10),
        map: z.array(z.enum(SEVERITY_VALUES)).min(2).max(10),
        default: z.enum(SEVERITY_VALUES),
        min: z.enum(SEVERITY_VALUES).optional(),
        max: z.enum(SEVERITY_VALUES).optional(),
      })
      .strict(),
    thresholds: z
      .object({
        report: z.number().min(0).max(1),
        uncertain: z.number().min(0).max(1),
      })
      .strict()
      .optional(),
    locate: z.enum(["trigger", "choose", "unit"]).optional(),
    slots: z
      .record(z.string(), z.object({ from: z.string() }).strict())
      .optional(),
    message: z
      .object({
        en: localeMessage,
        "zh-CN": localeMessage.optional(),
      })
      .strict(),
    fix: z
      .object({
        hint: z
          .object({
            en: z.string(),
            "zh-CN": z.string().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    references: z.array(z.string()).optional(),
    mock: z
      .object({
        positive: z.string().optional(),
        negative: z.string().optional(),
        guardPositive: z.string().optional(),
        severity: z.number().optional(),
      })
      .strict()
      .optional(),
    examples: z
      .object({
        positive: z
          .array(
            z
              .object({
                code: z.string().min(1),
                path: z.string().optional(),
                language: z.string().optional(),
              })
              .strict(),
          )
          .min(1),
        negative: z
          .array(
            z
              .object({
                code: z.string().min(1),
                path: z.string().optional(),
                language: z.string().optional(),
              })
              .strict(),
          )
          .min(1),
      })
      .strict(),
    deterministic: z.enum(["secret", "injection"]).optional(),
    priority: z.number().optional(),
    deprecated: z.boolean().optional(),
  })
  .strict();

export const rulePackSchema = z
  .object({
    pack: z.string().min(1),
    version: z.string().min(1),
    rules: z.array(ruleSchema).min(1),
  })
  .strict();

export type Rule = z.infer<typeof ruleSchema>;
export type RulePack = z.infer<typeof rulePackSchema>;
export type RuleExample = Rule["examples"]["positive"][number];

export interface LoadedRule extends Rule {
  pluginId: string;
  layer: "builtin" | "plugin" | "project";
  pack: string;
  dimension: (typeof DIMENSIONS)[number];
}

export function ruleJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(rulePackSchema) as Record<string, unknown>;
}
