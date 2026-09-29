import picomatch from "picomatch";
import type { ChangedFile } from "../git/unified-diff.ts";

export type SkipReason =
  | "binary"
  | "secret_path"
  | "user_exclude"
  | "unsupported"
  | "default_path"
  | "deleted"
  | "too_large"
  | "submodule"
  | "no_added_lines"
  | "mode";

export interface GateDecision {
  file: ChangedFile;
  decision: "review" | "skip";
  reason?: SkipReason;
  languageId?: string;
}

export interface GateOptions {
  include: string[];
  exclude: string[];
  reviewTests: boolean;
  maxAddedLinesPerFile: number;
  secretGlobs: string[];
  defaultGlobs: string[];
  testGlobs: string[];
  generatedGlobs: string[];
  languageId?: string;
}

const ENV_FILE = /(^|\/)\.env($|\.)/i;
const ENV_TEMPLATE = /\.env\.(example|template|sample|dist)$/i;

export function gateFile(
  file: ChangedFile,
  options: GateOptions,
): GateDecision {
  const path = file.path.replaceAll("\\", "/");
  if (file.binary || file.status === "binary") return skip(file, "binary");
  if (file.status === "submodule") return skip(file, "submodule");
  if (isSecretPath(path, options.secretGlobs)) return skip(file, "secret_path");
  if (matches(path, options.exclude)) return skip(file, "user_exclude");
  const included = options.include.length > 0 && matches(path, options.include);
  if (!included && !options.languageId) return skip(file, "unsupported");
  if (
    !included &&
    (matches(path, options.defaultGlobs) ||
      matches(path, options.generatedGlobs) ||
      (!options.reviewTests && matches(path, options.testGlobs)))
  ) {
    return skip(file, "default_path");
  }
  if (file.status === "deleted") return skip(file, "deleted");
  if (file.status === "mode" && file.addedCount === 0)
    return skip(file, "mode");
  if (file.addedCount > options.maxAddedLinesPerFile)
    return skip(file, "too_large");
  if (file.addedCount === 0) return skip(file, "no_added_lines");
  return { file, decision: "review", languageId: options.languageId };
}

function skip(file: ChangedFile, reason: SkipReason): GateDecision {
  return { file, decision: "skip", reason };
}

export function matches(path: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  return picomatch(patterns, { dot: true, nocase: true })(
    path.replaceAll("\\", "/"),
  );
}

export function isSecretPath(path: string, globs: string[]): boolean {
  const norm = path.replaceAll("\\", "/");
  if (matches(norm, globs)) return true;
  if (ENV_FILE.test(norm) && !ENV_TEMPLATE.test(norm)) return true;
  return false;
}

export function isTestPath(path: string, globs: string[]): boolean {
  return matches(path, globs);
}
