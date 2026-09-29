import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { KestrelError } from "../util/errors.ts";
import { defaultConfig } from "./defaults.ts";
import {
  type ResolvedConfig,
  type RuleOverride,
  type UserConfig,
  userConfigSchema,
} from "./schema.ts";

export interface LoadConfigInput {
  cwd: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  cli?: {
    provider?: ResolvedConfig["jev"]["provider"];
    model?: string;
    profile?: ResolvedConfig["profile"];
    lang?: ResolvedConfig["output"]["language"];
    budgetTokens?: number;
    concurrency?: number;
    noCache?: boolean;
    failOn?: ResolvedConfig["gate"]["failOn"];
    minP?: number;
    baseURL?: string;
    llm?: boolean;
  };
}

export function loadConfig(input: LoadConfigInput): ResolvedConfig {
  const env = input.env ?? process.env;
  const resolved = defaultConfig();
  const globalPath = globalConfigPath(env);
  if (existsSync(globalPath)) mergeUser(resolved, readUserConfig(globalPath));
  const projectPath = input.configPath
    ? resolve(input.cwd, input.configPath)
    : findProjectConfig(input.cwd);
  if (projectPath) {
    if (!existsSync(projectPath)) {
      throw new KestrelError(
        `Config file not found: ${projectPath}`,
        2,
        "config",
      );
    }
    mergeUser(resolved, readUserConfig(projectPath));
  }
  applyEnv(resolved, env);
  applyCli(resolved, input.cli);
  return resolved;
}

export function readUserConfig(path: string): UserConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new KestrelError(
      `Cannot read config ${path}: ${(error as Error).message}`,
      2,
      "config",
    );
  }
  let parsed: unknown;
  try {
    parsed = parse(raw) ?? {};
  } catch (error) {
    throw new KestrelError(
      `Invalid YAML in ${path}: ${(error as Error).message}`,
      2,
      "config",
    );
  }
  const result = userConfigSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new KestrelError(`Invalid config ${path}: ${detail}`, 2, "config");
  }
  return result.data;
}

function findProjectConfig(cwd: string): string | undefined {
  for (const name of [
    ".kestrel.yml",
    ".kestrel.yaml",
    "kestrel.config.yaml",
    "kestrel.config.yml",
  ]) {
    const path = join(cwd, name);
    if (existsSync(path)) return path;
  }
  return undefined;
}

function globalConfigPath(env: NodeJS.ProcessEnv): string {
  const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "kestrel", "config.yml");
}

function mergeUser(target: ResolvedConfig, user: UserConfig): void {
  if (user.jev) {
    const jev = user.jev;
    if (jev.provider) target.jev.provider = jev.provider;
    if (jev.model) target.jev.model = jev.model;
    if (jev.baseURL) target.jev.baseURL = jev.baseURL;
    if (jev.timeoutMs) target.jev.timeoutMs = jev.timeoutMs;
    if (jev.concurrency) target.jev.concurrency = jev.concurrency;
    if (jev.strategy) target.jev.strategy = jev.strategy;
    if (jev.rateLimit?.requestsPerMinute) {
      target.jev.rateLimit.requestsPerMinute = jev.rateLimit.requestsPerMinute;
    }
    if (jev.rateLimit?.tokensPerSecond) {
      target.jev.rateLimit.tokensPerSecond = jev.rateLimit.tokensPerSecond;
    }
    if (jev.price?.inputPerMTok !== undefined)
      target.jev.price.inputPerMTok = jev.price.inputPerMTok;
    if (jev.budget?.maxInputTokens !== undefined) {
      target.jev.budget.maxInputTokens = jev.budget.maxInputTokens;
    }
    if (jev.cache?.enabled !== undefined)
      target.jev.cache.enabled = jev.cache.enabled;
    if (jev.cache?.dir) target.jev.cache.dir = jev.cache.dir;
    if (jev.cache?.ttlDays) target.jev.cache.ttlDays = jev.cache.ttlDays;
  }
  if (user.profile) target.profile = user.profile;
  if (user.output?.language) target.output.language = user.output.language;
  if (user.output?.formats) target.output.formats = user.output.formats;
  if (user.output?.showUncertain)
    target.output.showUncertain = user.output.showUncertain;
  if (user.files?.include) target.files.include = user.files.include;
  if (user.files?.exclude)
    target.files.exclude = [...target.files.exclude, ...user.files.exclude];
  if (user.files?.reviewTests !== undefined)
    target.files.reviewTests = user.files.reviewTests;
  if (user.limits?.maxAddedLinesPerFile) {
    target.limits.maxAddedLinesPerFile = user.limits.maxAddedLinesPerFile;
  }
  if (user.limits?.maxAddedLinesPerUnit) {
    target.limits.maxAddedLinesPerUnit = user.limits.maxAddedLinesPerUnit;
  }
  if (user.limits?.maxRulesPerUnit)
    target.limits.maxRulesPerUnit = user.limits.maxRulesPerUnit;
  if (user.plugins) target.plugins = user.plugins;
  if (user.rulePacks) target.rulePacks = user.rulePacks;
  if (user.rules?.disable) {
    for (const id of user.rules.disable) target.rules.disable.push(id);
  }
  if (user.rules?.enable) {
    for (const id of user.rules.enable) target.rules.enable.push(id);
  }
  if (user.rules?.overrides) {
    for (const [id, override] of Object.entries(user.rules.overrides)) {
      const prev: RuleOverride = target.rules.overrides[id] ?? {};
      target.rules.overrides[id] = {
        thresholds: { ...prev.thresholds, ...override.thresholds },
        severity: { ...prev.severity, ...override.severity },
      };
    }
  }
  if (user.checks) target.checks = user.checks;
  if (user.gate?.failOn) target.gate.failOn = user.gate.failOn;
  if (user.gate?.minProbability !== undefined)
    target.gate.minProbability = user.gate.minProbability;
  if (user.privacy?.redactSecrets !== undefined)
    target.privacy.redactSecrets = user.privacy.redactSecrets;
  if (user.privacy?.maxEnclosingLines)
    target.privacy.maxEnclosingLines = user.privacy.maxEnclosingLines;
  if (user.privacy?.sendImports)
    target.privacy.sendImports = user.privacy.sendImports;
  if (user.languages?.overrides)
    target.languages.overrides = user.languages.overrides;
  if (user.llm?.enabled !== undefined) target.llm.enabled = user.llm.enabled;
  if (user.llm?.protocol) target.llm.protocol = user.llm.protocol;
  if (user.llm?.baseURL) target.llm.baseURL = user.llm.baseURL;
  if (user.llm?.model !== undefined) target.llm.model = user.llm.model;
  if (user.llm?.apiKeyEnv) target.llm.apiKeyEnv = user.llm.apiKeyEnv;
  if (user.llm?.maxFindings) target.llm.maxFindings = user.llm.maxFindings;
  if (user.llm?.verifyWithJev !== undefined)
    target.llm.verifyWithJev = user.llm.verifyWithJev;
  if (user.static?.sarif) target.static.sarif = user.static.sarif;
  if (user.static?.filterMode)
    target.static.filterMode = user.static.filterMode;
  if (user.static?.run === "auto") {
    target.warnings.push(
      "Static tools are not executed in this version; only SARIF files are read.",
    );
  }
}

function applyEnv(target: ResolvedConfig, env: NodeJS.ProcessEnv): void {
  const provider = env.KESTREL_PROVIDER;
  if (
    provider === "typesafe" ||
    provider === "http" ||
    provider === "mock" ||
    provider === "replay"
  ) {
    target.jev.provider = provider;
  } else if (provider) {
    throw new KestrelError(
      `Invalid KESTREL_PROVIDER: ${provider}`,
      2,
      "config",
    );
  }
  if (env.KESTREL_MODEL) target.jev.model = env.KESTREL_MODEL;
  if (
    env.KESTREL_PROFILE === "chill" ||
    env.KESTREL_PROFILE === "balanced" ||
    env.KESTREL_PROFILE === "assertive"
  ) {
    target.profile = env.KESTREL_PROFILE;
  } else if (env.KESTREL_PROFILE) {
    throw new KestrelError(
      `Invalid KESTREL_PROFILE: ${env.KESTREL_PROFILE}`,
      2,
      "config",
    );
  }
  if (env.KESTREL_LANG === "zh-CN" || env.KESTREL_LANG === "en")
    target.output.language = env.KESTREL_LANG;
  else if (env.KESTREL_LANG)
    throw new KestrelError(
      `Invalid KESTREL_LANG: ${env.KESTREL_LANG}`,
      2,
      "config",
    );
  if (env.TYPESAFE_BASE_URL) target.jev.baseURL = env.TYPESAFE_BASE_URL;
}

function applyCli(target: ResolvedConfig, cli: LoadConfigInput["cli"]): void {
  if (!cli) return;
  if (cli.provider) target.jev.provider = cli.provider;
  if (cli.model) target.jev.model = cli.model;
  if (cli.profile) target.profile = cli.profile;
  if (cli.lang) target.output.language = cli.lang;
  if (cli.budgetTokens !== undefined)
    target.jev.budget.maxInputTokens = cli.budgetTokens;
  if (cli.concurrency) target.jev.concurrency = cli.concurrency;
  if (cli.noCache) target.jev.cache.enabled = false;
  if (cli.failOn) target.gate.failOn = cli.failOn;
  if (cli.minP !== undefined) target.gate.minProbability = cli.minP;
  if (cli.baseURL) target.jev.baseURL = cli.baseURL;
  if (cli.llm) target.llm.enabled = true;
}

export function maskConfig(
  config: ResolvedConfig,
  env: NodeJS.ProcessEnv = process.env,
): unknown {
  return {
    ...config,
    secrets: {
      TYPESAFE_API_KEY: env.TYPESAFE_API_KEY ? "(set)" : "(missing)",
    },
  };
}
