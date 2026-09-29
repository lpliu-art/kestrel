import { z } from "zod";

export const PROFILES = ["chill", "balanced", "assertive"] as const;
export type ProfileName = (typeof PROFILES)[number];

export const profileThresholds: Record<
  ProfileName,
  {
    report: number;
    uncertain: number;
    showUncertain: "hidden" | "collapsed" | "expanded";
  }
> = {
  chill: { report: 0.85, uncertain: 0.7, showUncertain: "hidden" },
  balanced: { report: 0.75, uncertain: 0.55, showUncertain: "collapsed" },
  assertive: { report: 0.6, uncertain: 0.4, showUncertain: "expanded" },
};

const severity = z.enum(["low", "medium", "high", "critical"]);

export const userConfigSchema = z
  .object({
    version: z.literal(1).optional(),
    jev: z
      .object({
        provider: z
          .enum(["typesafe", "http", "mock", "replay", "llm-shim"])
          .optional(),
        model: z.string().optional(),
        baseURL: z.string().nullable().optional(),
        timeoutMs: z.number().int().positive().optional(),
        concurrency: z.number().int().positive().optional(),
        rateLimit: z
          .object({
            requestsPerMinute: z.number().int().positive().optional(),
            tokensPerSecond: z.number().int().positive().optional(),
          })
          .strict()
          .optional(),
        strategy: z.enum(["two-pass", "single-pass"]).optional(),
        price: z
          .object({
            inputPerMTok: z.number().nonnegative().optional(),
          })
          .strict()
          .optional(),
        budget: z
          .object({
            maxInputTokens: z.number().int().nonnegative().optional(),
          })
          .strict()
          .optional(),
        cache: z
          .object({
            enabled: z.boolean().optional(),
            dir: z.string().optional(),
            ttlDays: z.number().positive().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    profile: z.enum(PROFILES).optional(),
    output: z
      .object({
        language: z.enum(["zh-CN", "en"]).optional(),
        formats: z
          .array(z.enum(["terminal", "json", "sarif", "markdown"]))
          .optional(),
        showUncertain: z.enum(["hidden", "collapsed", "expanded"]).optional(),
      })
      .strict()
      .optional(),
    files: z
      .object({
        include: z.array(z.string()).optional(),
        exclude: z.array(z.string()).optional(),
        reviewTests: z.boolean().optional(),
      })
      .strict()
      .optional(),
    limits: z
      .object({
        maxAddedLinesPerFile: z.number().int().positive().optional(),
        maxAddedLinesPerUnit: z.number().int().positive().max(254).optional(),
        maxRulesPerUnit: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    plugins: z.array(z.string()).optional(),
    rulePacks: z.array(z.string()).optional(),
    rules: z
      .object({
        disable: z.array(z.string()).optional(),
        enable: z.array(z.string()).optional(),
        overrides: z
          .record(
            z.string(),
            z
              .object({
                thresholds: z
                  .object({
                    report: z.number().min(0).max(1).optional(),
                    uncertain: z.number().min(0).max(1).optional(),
                  })
                  .strict()
                  .optional(),
                severity: z
                  .object({
                    min: severity.optional(),
                    max: severity.optional(),
                    default: severity.optional(),
                  })
                  .strict()
                  .optional(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict()
      .optional(),
    checks: z
      .array(
        z
          .object({
            id: z.string(),
            paths: z.array(z.string()).optional(),
            ask: z.string(),
            expect: z.boolean().optional(),
            severity: severity.optional(),
            message: z.record(z.string(), z.string()).optional(),
            examples: z
              .object({
                positive: z
                  .array(
                    z
                      .object({
                        code: z.string(),
                        path: z.string().optional(),
                        language: z.string().optional(),
                      })
                      .strict(),
                  )
                  .optional(),
                negative: z
                  .array(
                    z
                      .object({
                        code: z.string(),
                        path: z.string().optional(),
                        language: z.string().optional(),
                      })
                      .strict(),
                  )
                  .optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .optional(),
    static: z
      .object({
        sarif: z.array(z.string()).optional(),
        run: z.enum(["auto", "off"]).optional(),
        filterMode: z.enum(["added", "diff_context"]).optional(),
      })
      .strict()
      .optional(),
    gate: z
      .object({
        failOn: severity.optional(),
        minProbability: z.number().min(0).max(1).optional(),
      })
      .strict()
      .optional(),
    llm: z
      .object({
        enabled: z.boolean().optional(),
        protocol: z.enum(["openai", "anthropic"]).optional(),
        baseURL: z.string().optional(),
        model: z.string().optional(),
        apiKeyEnv: z.string().optional(),
        maxFindings: z.number().int().positive().optional(),
        verifyWithJev: z.boolean().optional(),
      })
      .strict()
      .optional(),
    privacy: z
      .object({
        redactSecrets: z.boolean().optional(),
        maxEnclosingLines: z.number().int().positive().optional(),
        sendImports: z.enum(["auto", "never"]).optional(),
      })
      .strict()
      .optional(),
    languages: z
      .object({
        overrides: z
          .array(
            z
              .object({
                glob: z.string(),
                languageId: z.string(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict()
      .optional(),
    auth: z
      .object({
        skipKeyPrompt: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type UserConfig = z.infer<typeof userConfigSchema>;

export interface RuleOverride {
  thresholds?: { report?: number; uncertain?: number };
  severity?: {
    min?: "low" | "medium" | "high" | "critical";
    max?: "low" | "medium" | "high" | "critical";
    default?: "low" | "medium" | "high" | "critical";
  };
}

export interface ResolvedConfig {
  version: 1;
  jev: {
    provider: "typesafe" | "http" | "mock" | "replay" | "llm-shim";
    model: string;
    baseURL?: string;
    timeoutMs: number;
    concurrency: number;
    rateLimit: { requestsPerMinute: number; tokensPerSecond: number };
    strategy: "two-pass" | "single-pass";
    price: { inputPerMTok: number };
    budget: { maxInputTokens: number };
    cache: { enabled: boolean; dir: string; ttlDays: number };
  };
  profile: ProfileName;
  output: {
    language: "zh-CN" | "en";
    formats: Array<"terminal" | "json" | "sarif" | "markdown">;
    showUncertain: "hidden" | "collapsed" | "expanded";
  };
  files: { include: string[]; exclude: string[]; reviewTests: boolean };
  limits: {
    maxAddedLinesPerFile: number;
    maxAddedLinesPerUnit: number;
    maxRulesPerUnit: number;
  };
  plugins: string[];
  rulePacks: string[];
  rules: {
    disable: string[];
    enable: string[];
    overrides: Record<string, RuleOverride>;
  };
  checks: NonNullable<UserConfig["checks"]>;
  static: {
    sarif: string[];
    filterMode: "added" | "diff_context";
  };
  gate: {
    failOn: "low" | "medium" | "high" | "critical";
    minProbability: number;
  };
  privacy: {
    redactSecrets: boolean;
    maxEnclosingLines: number;
    sendImports: "auto" | "never";
  };
  llm: {
    enabled: boolean;
    protocol: "openai" | "anthropic";
    baseURL: string;
    model: string;
    apiKeyEnv: string;
    maxFindings: number;
    verifyWithJev: boolean;
  };
  languages: { overrides: Array<{ glob: string; languageId: string }> };
  warnings: string[];
}

export function configJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(userConfigSchema) as Record<string, unknown>;
}
