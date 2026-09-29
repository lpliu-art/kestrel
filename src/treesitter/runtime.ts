import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Language, Parser, type Tree } from "web-tree-sitter";

const require = createRequire(import.meta.url);

interface GrammarSpec {
  pkg: string;
  file: string;
}

/** WASM grammars verified against web-tree-sitter 0.25.10. */
const GRAMMARS: Record<string, GrammarSpec> = {
  typescript: {
    pkg: "tree-sitter-typescript",
    file: "tree-sitter-typescript.wasm",
  },
  tsx: { pkg: "tree-sitter-typescript", file: "tree-sitter-tsx.wasm" },
  javascript: {
    pkg: "tree-sitter-javascript",
    file: "tree-sitter-javascript.wasm",
  },
  python: { pkg: "tree-sitter-python", file: "tree-sitter-python.wasm" },
  java: { pkg: "tree-sitter-java", file: "tree-sitter-java.wasm" },
  go: { pkg: "tree-sitter-go", file: "tree-sitter-go.wasm" },
  rust: { pkg: "tree-sitter-rust", file: "tree-sitter-rust.wasm" },
  csharp: { pkg: "tree-sitter-c-sharp", file: "tree-sitter-c_sharp.wasm" },
};

type LoadState = "idle" | "ready";

let state: LoadState = "idle";
let initPromise: Promise<void> | undefined;
const languages = new Map<string, Language | null>();
const warnings: string[] = [];
let forcedFailure: string | undefined;

export function grammarIds(): string[] {
  return Object.keys(GRAMMARS);
}

export function forceGrammarFailureForTests(message = "forced"): void {
  forcedFailure = message;
  resetTreesitterForTests();
}

export function clearGrammarFailureForTests(): void {
  forcedFailure = undefined;
  resetTreesitterForTests();
}

export function resetTreesitterForTests(): void {
  state = "idle";
  initPromise = undefined;
  languages.clear();
  warnings.length = 0;
}

export function drainGrammarWarnings(): string[] {
  const copy = [...warnings];
  warnings.length = 0;
  return copy;
}

export function grammarReady(languageId: string): boolean {
  return languages.get(languageId) != null;
}

export async function ensureTreesitter(): Promise<void> {
  if (state === "ready") return;
  if (!initPromise) initPromise = loadAll();
  await initPromise;
}

async function loadAll(): Promise<void> {
  if (forcedFailure) {
    for (const id of Object.keys(GRAMMARS)) languages.set(id, null);
    warnings.push(
      `tree-sitter grammars failed to load (${forcedFailure}); using the heuristic context and regex triggers.`,
    );
    state = "ready";
    return;
  }
  try {
    await Parser.init();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const id of Object.keys(GRAMMARS)) languages.set(id, null);
    warnings.push(
      `tree-sitter runtime failed to initialize (${message}); using the heuristic context and regex triggers.`,
    );
    state = "ready";
    return;
  }
  for (const [id, spec] of Object.entries(GRAMMARS)) {
    try {
      const wasmPath = require.resolve(`${spec.pkg}/${spec.file}`);
      const language = await Language.load(readFileSync(wasmPath));
      languages.set(id, language);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      languages.set(id, null);
      warnings.push(
        `tree-sitter grammar for ${id} failed to load (${message}); using the heuristic context and regex triggers.`,
      );
    }
  }
  state = "ready";
}

export function parseLanguage(
  languageId: string,
  source: string,
): Tree | undefined {
  const language = languages.get(languageId);
  if (!language) return undefined;
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source);
  return tree ?? undefined;
}

export function languageFor(languageId: string): Language | undefined {
  const language = languages.get(languageId);
  return language ?? undefined;
}
