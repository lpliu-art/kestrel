import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import picomatch from "picomatch";
import { parse } from "yaml";
import type { ResolvedConfig } from "../config/schema.ts";
import type { KestrelPlugin } from "../plugins/api.ts";
import { KestrelError } from "../util/errors.ts";
import { readSeaText, SEA_PREFIX } from "../util/sea.ts";
import { compileChecks } from "./checks.ts";
import {
  DIMENSIONS,
  type LoadedRule,
  type Rule,
  rulePackSchema,
} from "./schema.ts";

export async function loadRules(
  plugins: KestrelPlugin[],
  config: ResolvedConfig,
  cwd: string,
): Promise<LoadedRule[]> {
  const loaded: LoadedRule[] = [];
  for (const plugin of plugins) {
    for (const ref of plugin.rulePacks ?? []) {
      if (ref.inline) {
        loaded.push(
          ...tagPack(ref.inline.rules, ref.inline.pack, plugin.id, "builtin"),
        );
        continue;
      }
      if (!ref.path) continue;
      const path = ref.path.startsWith(SEA_PREFIX)
        ? ref.path
        : resolve(cwd, ref.path);
      const text = await readPack(path);
      loaded.push(...parsePack(text, path, plugin.id, "builtin"));
    }
  }
  for (const pattern of config.rulePacks) {
    const matches = await matchGlob(pattern, cwd);
    for (const rel of matches) {
      const path = resolve(cwd, rel);
      const text = await readFile(path, "utf8");
      loaded.push(...parsePack(text, path, "project", "project"));
    }
  }
  loaded.push(...compileChecks(config, config.warnings));
  return applyOverrides(loaded, config);
}

async function readPack(path: string): Promise<string> {
  if (!path.startsWith(SEA_PREFIX)) return readFile(path, "utf8");
  const key = path.slice(SEA_PREFIX.length);
  const text = readSeaText(key);
  if (text === undefined) {
    throw new KestrelError(`Missing embedded rule pack ${key}`, 2, "config");
  }
  return text;
}

export function parsePack(
  text: string,
  path: string,
  pluginId: string,
  layer: LoadedRule["layer"],
): LoadedRule[] {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    throw new KestrelError(
      `Invalid YAML in ${path}: ${(error as Error).message}`,
      2,
      "config",
    );
  }
  const result = rulePackSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new KestrelError(
      `Invalid rule pack ${basename(path)}: ${detail}`,
      2,
      "config",
    );
  }
  return tagPack(result.data.rules, result.data.pack, pluginId, layer);
}

function tagPack(
  rules: Rule[],
  pack: string,
  pluginId: string,
  layer: LoadedRule["layer"],
): LoadedRule[] {
  return rules.map((rule) => ({
    ...rule,
    pluginId,
    layer,
    pack,
    dimension: rule.dimension ?? dimensionOf(rule.category),
  }));
}

function dimensionOf(category: Rule["category"]): (typeof DIMENSIONS)[number] {
  if (category === "style") return "maintainability";
  if (category === "test") return "test_gap";
  if ((DIMENSIONS as readonly string[]).includes(category))
    return category as (typeof DIMENSIONS)[number];
  return "maintainability";
}

export function applyOverrides(
  rules: LoadedRule[],
  config: ResolvedConfig,
): LoadedRule[] {
  const disabled = new Set(config.rules.disable);
  for (const id of config.rules.enable) disabled.delete(id);
  const byId = new Map<string, LoadedRule>();
  for (const rule of rules) {
    if (disabled.has(rule.id) || rule.deprecated) continue;
    const override = config.rules.overrides[rule.id];
    const next: LoadedRule = override
      ? {
          ...rule,
          thresholds: override.thresholds
            ? {
                report:
                  override.thresholds.report ?? rule.thresholds?.report ?? 0.75,
                uncertain:
                  override.thresholds.uncertain ??
                  rule.thresholds?.uncertain ??
                  0.55,
              }
            : rule.thresholds,
          severity: {
            ...rule.severity,
            ...(override.severity?.min ? { min: override.severity.min } : {}),
            ...(override.severity?.max ? { max: override.severity.max } : {}),
            ...(override.severity?.default
              ? { default: override.severity.default }
              : {}),
          },
        }
      : rule;
    byId.set(rule.id, next);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function loadPackFiles(
  patterns: string[],
  cwd: string,
): Promise<Array<{ path: string; text: string }>> {
  const files: Array<{ path: string; text: string }> = [];
  for (const pattern of patterns) {
    const matches = await matchGlob(pattern, cwd);
    for (const rel of matches) {
      const path = resolve(cwd, rel);
      files.push({ path, text: await readFile(path, "utf8") });
    }
  }
  return files;
}

export async function matchGlob(
  pattern: string,
  cwd: string,
): Promise<string[]> {
  const matcher = picomatch(pattern, { dot: true });
  const out: string[] = [];
  const walk = async (dir: string, rel: string): Promise<void> => {
    let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
    try {
      entries = (await readdir(dir, { withFileTypes: true })) as Array<{
        name: string;
        isDirectory: () => boolean;
      }>;
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(dir, entry.name), nextRel);
      else if (matcher(nextRel)) out.push(nextRel);
    }
  };
  await walk(cwd, "");
  return out.sort();
}
