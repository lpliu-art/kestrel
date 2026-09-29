import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

const severity = z.enum(["low", "medium", "high", "critical"]);

export const findingSchema = z
  .object({
    id: z.string(),
    fingerprint: z.string(),
    ruleId: z.string(),
    pluginId: z.string(),
    source: z.enum(["rule", "deterministic"]),
    category: z.string(),
    severity,
    band: z.enum(["report", "uncertain"]),
    probability: z.number(),
    pEff: z.number(),
    guards: z.record(z.string(), z.number()),
    severityScore: z
      .object({
        score: z.number(),
        confidence: z.number(),
      })
      .strict(),
    location: z
      .object({
        path: z.string(),
        startLine: z.number().int().positive(),
        endLine: z.number().int().positive(),
        anchor: z.enum(["trigger", "choice", "unit"]),
        uncertain: z.boolean(),
      })
      .strict(),
    title: z.string(),
    message: z.string(),
    why: z.string(),
    fix: z
      .object({
        hint: z.string(),
        suggestion: z.null(),
      })
      .strict(),
    llm: z.null(),
    references: z.array(z.string()),
    relatedRuleIds: z.array(z.string()),
    snippet: z.string(),
    trace: z
      .object({
        model: z.string(),
        profile: z.string(),
        thresholds: z
          .object({
            report: z.number(),
            uncertain: z.number(),
          })
          .strict(),
        questions: z.array(
          z
            .object({
              key: z.string(),
              type: z.string(),
              instructions: z.unknown(),
              answer: z.unknown(),
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
  })
  .strict();

export const reportSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    tool: z
      .object({
        name: z.literal("kestrel"),
        version: z.string(),
      })
      .strict(),
    provider: z
      .object({
        name: z.string(),
        model: z.string(),
        isAI: z.boolean(),
      })
      .strict(),
    run: z
      .object({
        mode: z.enum(["workspace", "staged", "commit", "range", "snippet"]),
        base: z.string().optional(),
        head: z.string().optional(),
        startedAt: z.string(),
        durationMs: z.number().nonnegative(),
        status: z.enum(["ok", "partial"]),
        requests: z.number().int().nonnegative(),
        cachedRequests: z.number().int().nonnegative(),
        tokens: z
          .object({
            input: z.number().nonnegative(),
            output: z.number().nonnegative(),
          })
          .strict(),
        costUSD: z.number().nonnegative(),
        profile: z.enum(["chill", "balanced", "assertive"]),
        language: z.enum(["zh-CN", "en"]),
      })
      .strict(),
    verdict: z
      .object({
        decision: z.enum(["approve", "comment", "request_changes"]),
        blocking: z.array(z.string()),
        reasons: z.array(z.string()),
      })
      .strict(),
    summary: z
      .object({
        filesChanged: z.number().int().nonnegative(),
        filesReviewed: z.number().int().nonnegative(),
        units: z.number().int().nonnegative(),
        findings: z
          .object({
            report: z.number().int().nonnegative(),
            uncertain: z.number().int().nonnegative(),
          })
          .strict(),
        bySeverity: z
          .object({
            low: z.number().int().nonnegative(),
            medium: z.number().int().nonnegative(),
            high: z.number().int().nonnegative(),
            critical: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict(),
    findings: z.array(findingSchema),
    files: z.array(
      z
        .object({
          path: z.string(),
          language: z.string(),
          risk: z.number(),
          units: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    skipped: z.array(
      z
        .object({
          path: z.string(),
          reason: z.string(),
          unitId: z.string().optional(),
        })
        .strict(),
    ),
    handoff: z
      .object({
        deepReview: z.array(
          z
            .object({
              path: z.string(),
              risk: z.number(),
              dimensions: z.record(z.string(), z.number()),
            })
            .strict(),
        ),
      })
      .strict(),
    warnings: z.array(z.string()),
    static: z
      .object({
        imported: z.number().int().nonnegative(),
        onDiff: z.number().int().nonnegative(),
        kept: z.number().int().nonnegative(),
        dropped: z.number().int().nonnegative(),
        alerts: z.array(
          z
            .object({
              tool: z.string(),
              ruleId: z.string(),
              path: z.string(),
              line: z.number().int().positive(),
              decision: z.enum(["keep", "drop"]),
              real: z.number(),
              matters: z.number(),
              probability: z.number(),
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
    preview: z
      .object({
        estimatedTokens: z.number().nonnegative(),
        estimatedCostUSD: z.number().nonnegative(),
        files: z.array(
          z
            .object({
              path: z.string(),
              decision: z.enum(["review", "skip"]),
              reason: z.string().optional(),
              language: z.string().optional(),
              addedLines: z.array(z.number().int()),
              units: z.number().int().nonnegative(),
            })
            .strict(),
        ),
        payloads: z
          .array(
            z
              .object({
                unitId: z.string(),
                path: z.string(),
                state: z.unknown(),
                questions: z.unknown(),
                tokens: z.number().nonnegative(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type Finding = z.infer<typeof findingSchema>;
export type Report = z.infer<typeof reportSchema>;

export function reportJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(reportSchema) as Record<string, unknown>;
}

export function parseReport(value: unknown): Report {
  return reportSchema.parse(value);
}
