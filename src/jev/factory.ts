import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { readUserConfig } from "../config/load.ts";
import type { ResolvedConfig } from "../config/schema.ts";
import type { LoadedRule } from "../rules/schema.ts";
import { KestrelError } from "../util/errors.ts";
import { BudgetGuard } from "./budget.ts";
import { FileCache, withCache } from "./cache.ts";
import { createHttpProvider } from "./http.ts";
import { createLlmShimProvider } from "./llm-shim.ts";
import { createMockProvider } from "./mock.ts";
import { RateLimiter, withRateLimit } from "./rate-limit.ts";
import {
  createReplayProvider,
  loadCassettes,
  withRecording,
} from "./replay.ts";
import { emptyStats, type JevProvider, type ProviderStats } from "./types.ts";
import { createTypeSafeProvider } from "./typesafe.ts";

export interface ProviderBuild {
  provider: JevProvider;
  stats: ProviderStats;
  budget: BudgetGuard;
  limiter: RateLimiter;
  warnings: string[];
}

export interface ProviderBuildOptions {
  config: ResolvedConfig;
  rules: LoadedRule[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  providerExplicit: boolean;
  tty: boolean;
  ci: boolean;
  replayDir?: string;
  replayFallback?: boolean;
  recordDir?: string;
  fetchImpl?: typeof fetch;
  warnings?: string[];
}

export async function buildProvider(
  options: ProviderBuildOptions,
): Promise<ProviderBuild> {
  const warnings = options.warnings ?? [];
  let name = options.config.jev.provider;
  const stats = emptyStats();
  const apiKey = options.env.TYPESAFE_API_KEY;
  const configChoseProvider =
    options.providerExplicit ||
    Boolean(options.env.KESTREL_PROVIDER) ||
    projectChoosesProvider(options.cwd);

  if ((name === "typesafe" || name === "http") && !apiKey) {
    const interactive = options.tty && !options.ci && !configChoseProvider;
    if (interactive) {
      warnings.push(
        options.config.output.language === "en"
          ? "No TYPESAFE_API_KEY; falling back to the mock provider. Results are not AI judgments."
          : "未设置 TYPESAFE_API_KEY，已改用 mock。结果不是 AI 判断。",
      );
      name = "mock";
    } else {
      throw new KestrelError(
        missingKeyMessage(options.config.output.language),
        3,
        "auth",
      );
    }
  }

  const limiter = new RateLimiter(options.config.jev.rateLimit);
  let inner = await createInner(name, options, apiKey, limiter);
  if (options.recordDir)
    inner = withRecording(inner, resolve(options.cwd, options.recordDir));
  const limited = withRateLimit(inner, limiter);
  const cacheDir = resolve(options.cwd, options.config.jev.cache.dir);
  const cache = new FileCache(
    cacheDir,
    options.config.jev.cache.ttlDays * 24 * 60 * 60 * 1000,
  );
  const provider = withCache(
    limited,
    cache,
    options.config.jev.cache.enabled,
    stats,
    (message) => {
      warnings.push(message);
    },
  );
  return {
    provider,
    stats,
    budget: new BudgetGuard(options.config.jev.budget.maxInputTokens),
    limiter,
    warnings,
  };
}

async function createInner(
  name: ResolvedConfig["jev"]["provider"],
  options: ProviderBuildOptions,
  apiKey: string | undefined,
  limiter: RateLimiter,
): Promise<JevProvider> {
  if (name === "mock") return createMockProvider(options.rules);
  if (name === "replay") {
    if (!options.replayDir)
      throw new KestrelError(
        "Replay provider requires --replay <dir>.",
        2,
        "usage",
      );
    const entries = await loadCassettes(
      resolve(options.cwd, options.replayDir),
    );
    const fallback = options.replayFallback
      ? createMockProvider(options.rules)
      : undefined;
    return createReplayProvider(entries, fallback);
  }
  if (name === "llm-shim") {
    return createLlmShimProvider({
      config: options.config,
      env: options.env,
      fetchImpl: options.fetchImpl,
    });
  }
  if (name === "http") {
    return createHttpProvider({
      apiKey,
      baseURL: options.config.jev.baseURL,
      timeoutMs: options.config.jev.timeoutMs,
      fetch: options.fetchImpl,
      onRateLimit: () => limiter.penalize(),
    });
  }
  return createTypeSafeProvider({
    apiKey,
    baseURL: options.config.jev.baseURL,
    model: options.config.jev.model,
    timeoutMs: options.config.jev.timeoutMs,
    fetch: options.fetchImpl,
  });
}

function projectChoosesProvider(cwd: string): boolean {
  for (const name of [
    ".kestrel.yml",
    ".kestrel.yaml",
    "kestrel.config.yaml",
    "kestrel.config.yml",
  ]) {
    const path = join(cwd, name);
    if (!existsSync(path)) continue;
    try {
      return Boolean(readUserConfig(path).jev?.provider);
    } catch {
      return true;
    }
  }
  return false;
}

export function missingKeyMessage(lang: "zh-CN" | "en"): string {
  if (lang === "en") {
    return "Missing TYPESAFE_API_KEY. Real reviews need a TypeSafe API key. Use --provider mock for an offline demo (not an AI judgment), or set TYPESAFE_API_KEY and retry.";
  }
  return "缺少 TYPESAFE_API_KEY。真实审查需要 TypeSafe API 密钥。离线演示请使用 --provider mock（结果不是 AI 判断），或设置 TYPESAFE_API_KEY 后重试。";
}
