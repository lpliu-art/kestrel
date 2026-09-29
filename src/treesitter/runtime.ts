import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Language, Parser, type Tree } from "web-tree-sitter";

function moduleRequire(): NodeRequire {
  const url = import.meta.url;
  if (typeof url === "string" && url.length > 0) return createRequire(url);
  return createRequire(process.execPath);
}

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

interface SeaLike {
  isSea?: () => boolean;
  getAsset?: (key: string) => ArrayBuffer | Uint8Array | string | undefined;
}

let state: LoadState = "idle";
let initPromise: Promise<void> | undefined;
const languages = new Map<string, Language | null>();
const warnings: string[] = [];
let forcedFailure: string | undefined;
let wasmReader: ((name: string) => Uint8Array | undefined) | undefined;
let seaProbe: (() => SeaLike | undefined) | undefined;
let initOverride: ((wasm: Uint8Array | undefined) => Promise<void>) | undefined;

export function setWasmReaderForTests(
  reader: ((name: string) => Uint8Array | undefined) | undefined,
): void {
  wasmReader = reader;
  resetTreesitterForTests();
}

export function setSeaProbeForTests(
  probe: (() => SeaLike | undefined) | undefined,
): void {
  seaProbe = probe;
  resetTreesitterForTests();
}

export function grammarIds(): string[] {
  return Object.keys(GRAMMARS);
}

export function forceGrammarFailureForTests(message = "forced"): void {
  forcedFailure = message;
  resetTreesitterForTests();
}

export function setParserInitForTests(
  init: ((wasm: Uint8Array | undefined) => Promise<void>) | undefined,
): void {
  initOverride = init;
  resetTreesitterForTests();
}

export function clearGrammarFailureForTests(): void {
  forcedFailure = undefined;
  wasmReader = undefined;
  seaProbe = undefined;
  initOverride = undefined;
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

export function parserKind(
  languageId: string,
): "tree-sitter" | "regex-fallback" {
  return grammarReady(languageId) ? "tree-sitter" : "regex-fallback";
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
    await initParser();
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
      const language = await Language.load(await grammarBytes(spec));
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

async function initParser(): Promise<void> {
  const wasm = await readWasm("tree-sitter.wasm");
  if (initOverride) {
    await initOverride(wasm);
    return;
  }
  if (!wasm) {
    await Parser.init();
    return;
  }
  const init = Parser.init as (options?: {
    wasmBinary?: Uint8Array;
  }) => Promise<void>;
  await init({ wasmBinary: wasm });
}

async function grammarBytes(spec: GrammarSpec): Promise<Uint8Array> {
  const injected = wasmReader?.(spec.file);
  if (injected) return injected;
  const fromSea = await seaAsset(spec.file);
  if (fromSea) return fromSea;
  return readFileSync(moduleRequire().resolve(`${spec.pkg}/${spec.file}`));
}

async function readWasm(name: string): Promise<Uint8Array | undefined> {
  const injected = wasmReader?.(name);
  if (injected) return injected;
  return seaAsset(name);
}

async function seaAsset(name: string): Promise<Uint8Array | undefined> {
  try {
    const sea = seaProbe ? seaProbe() : nodeSea();
    if (!sea?.isSea?.()) return undefined;
    return bytesOf(sea.getAsset?.(name));
  } catch {
    return undefined;
  }
}

function nodeSea(): SeaLike | undefined {
  const sea = moduleRequire()("node:sea") as SeaLike;
  return sea;
}

function bytesOf(asset: unknown): Uint8Array | undefined {
  if (asset instanceof Uint8Array) return new Uint8Array(asset);
  if (asset instanceof ArrayBuffer) return new Uint8Array(asset);
  return undefined;
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
