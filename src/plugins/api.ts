import type { ResolvedConfig } from "../config/schema.ts";
import type { RulePack } from "../rules/schema.ts";

export const PLUGIN_API_VERSION = 1 as const;

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface LanguageDefinition {
  id: string;
  extensions: string[];
  filenames?: string[];
  shebangs?: string[];
  sniff?(head: string): boolean;
  commentSyntax?: { line?: string; block?: [string, string] };
  /** When true, this language id may replace one already claimed by another plugin. */
  override?: boolean;
}

export interface RulePackRef {
  path?: string;
  inline?: RulePack;
}

export interface ContextInput {
  languageId: string;
  file: { path: string; newSource?: string };
  unit: { startLine: number; endLine: number; addedLines: number[] };
  tree?: unknown;
}

export interface UnitContext {
  enclosing?: {
    kind: string;
    name?: string;
    startLine: number;
    endLine: number;
    text: string;
  };
  imports?: string[];
  notes?: Record<string, string>;
}

export interface ContextProvider {
  build(input: ContextInput): UnitContext | Promise<UnitContext>;
}

export interface RepoHandle {
  root: string;
  readFile(path: string): Promise<string | undefined>;
  listFiles(glob: string): Promise<string[]>;
}

export interface FactsProvider {
  detect(repo: RepoHandle): Promise<string[]>;
}

export interface PluginSetupContext {
  logger: Logger;
  cacheDir: string;
  config: Readonly<ResolvedConfig>;
}

export interface KestrelPlugin {
  apiVersion: typeof PLUGIN_API_VERSION;
  id: string;
  name: string;
  version: string;
  languages: LanguageDefinition[];
  rulePacks?: RulePackRef[];
  context?: ContextProvider;
  facts?: FactsProvider;
  fileClasses?: {
    test?: string[];
    generated?: string[];
    exclude?: string[];
  };
  setup?(ctx: PluginSetupContext): void | Promise<void>;
}

export function definePlugin(plugin: KestrelPlugin): KestrelPlugin {
  return plugin;
}
