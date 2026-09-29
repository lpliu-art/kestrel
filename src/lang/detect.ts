import { basename, extname } from "node:path";
import picomatch from "picomatch";
import type { LanguageDefinition } from "../plugins/api.ts";

export interface LanguageOverride {
  glob: string;
  languageId: string;
}

export function detectLanguage(
  path: string,
  head: string | undefined,
  languages: LanguageDefinition[],
  overrides: LanguageOverride[] = [],
): string | undefined {
  const norm = path.replaceAll("\\", "/");
  for (const override of overrides) {
    if (picomatch(override.glob, { dot: true, nocase: true })(norm))
      return override.languageId;
  }
  const base = basename(norm).toLowerCase();
  for (const language of languages) {
    if (language.filenames?.some((name) => name.toLowerCase() === base))
      return language.id;
  }
  const ext = extname(norm).toLowerCase();
  if (ext) {
    for (const language of languages) {
      if (language.extensions.some((item) => item.toLowerCase() === ext))
        return language.id;
    }
  }
  if (head) {
    const token = shebangToken(head);
    if (token) {
      for (const language of languages) {
        if (
          language.shebangs?.some(
            (item) => token === item || token.startsWith(item),
          )
        )
          return language.id;
      }
    }
    const sample = head.slice(0, 2048);
    for (const language of languages) {
      if (language.sniff?.(sample)) return language.id;
    }
  }
  return undefined;
}

function shebangToken(head: string): string | undefined {
  const match = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(head);
  if (!match) return undefined;
  const program = basename(match[1] ?? "").toLowerCase();
  if (program === "env" && match[2]) return match[2].toLowerCase();
  return program || undefined;
}

export function languageForPlugin(
  languages: LanguageDefinition[],
  languageId: string | undefined,
): LanguageDefinition | undefined {
  if (!languageId) return undefined;
  return languages.find((language) => language.id === languageId);
}
