import { Query, type Node as SyntaxNode } from "web-tree-sitter";
import type { UnitContext } from "../plugins/api.ts";
import {
  type EnclosingScope,
  extractImports,
  findEnclosing,
} from "../units/context-heuristic.ts";
import { grammarReady, languageFor, parseLanguage } from "./runtime.ts";

const FUNCTION_TYPES = new Set([
  "function_declaration",
  "function",
  "method_definition",
  "arrow_function",
  "function_definition",
  "method_declaration",
  "constructor_declaration",
  "func_literal",
  "function_item",
]);

const CLASS_TYPES = new Set([
  "class_declaration",
  "class",
  "class_definition",
  "interface_declaration",
  "enum_declaration",
]);

const IMPORT_QUERIES: Record<string, string> = {
  typescript: "(import_statement) @imp",
  tsx: "(import_statement) @imp",
  javascript: "(import_statement) @imp",
  python: "[(import_statement) (import_from_statement)] @imp",
  java: "[(package_declaration) (import_declaration)] @imp",
  go: "[(package_clause) (import_declaration)] @imp",
  rust: "(use_declaration) @imp",
  csharp: "(using_directive) @imp",
};

export function astUnitContext(
  source: string,
  languageId: string,
  startLine: number,
  endLine: number,
  maxLines: number,
): UnitContext | undefined {
  if (!grammarReady(languageId)) return undefined;
  const tree = parseLanguage(languageId, source);
  if (!tree) return undefined;
  try {
    const lines = splitLines(source);
    const enclosing = enclosingFromTree(
      tree.rootNode,
      lines,
      startLine,
      endLine,
      maxLines,
    );
    const imports =
      importsFromTree(languageId, tree.rootNode) ?? extractImports(lines);
    return { enclosing, imports };
  } finally {
    tree.delete();
  }
}

export function enclosingIdentity(
  source: string,
  languageId: string,
  line: number,
): string | undefined {
  if (grammarReady(languageId)) {
    const found = readEnclosing(source, languageId, line);
    if (!found) return undefined;
    return `ast:${found.kind}:${found.name ?? ""}:${found.startLine}`;
  }
  const lines = splitLines(source);
  const found = findEnclosing(lines, line, languageId);
  if (!found) return undefined;
  return `heuristic:${found.kind}:${found.name ?? ""}:${found.startLine}`;
}

export function readEnclosing(
  source: string,
  languageId: string,
  line: number,
  maxLines = 10_000,
): EnclosingScope | undefined {
  if (!grammarReady(languageId)) return undefined;
  const tree = parseLanguage(languageId, source);
  if (!tree) return undefined;
  try {
    return enclosingFromTree(
      tree.rootNode,
      splitLines(source),
      line,
      line,
      maxLines,
    );
  } finally {
    tree.delete();
  }
}

function enclosingFromTree(
  root: SyntaxNode,
  lines: string[],
  startLine: number,
  endLine: number,
  maxLines: number,
): EnclosingScope | undefined {
  const leaf = nodeAtLine(root, startLine);
  if (!leaf) return undefined;
  let functionNode: SyntaxNode | undefined;
  let classNode: SyntaxNode | undefined;
  for (
    let current: SyntaxNode | null = leaf;
    current;
    current = current.parent
  ) {
    if (!functionNode && FUNCTION_TYPES.has(current.type))
      functionNode = current;
    if (!classNode && CLASS_TYPES.has(current.type)) classNode = current;
  }
  const node = functionNode ?? classNode;
  if (!node) return undefined;
  const start = node.startPosition.row + 1;
  const end = Math.max(start, node.endPosition.row + 1);
  const text = clipNodeText(lines, start, end, startLine, endLine, maxLines);
  return {
    kind: node.type,
    name: nodeName(node),
    startLine: start,
    endLine: end,
    text,
  };
}

function nodeName(node: SyntaxNode): string | undefined {
  const named = node.childForFieldName("name")?.text;
  if (named) return named;
  if (node.type === "arrow_function" || node.type === "function") {
    const parent = node.parent;
    if (parent?.type === "variable_declarator")
      return parent.childForFieldName("name")?.text;
  }
  return undefined;
}

function clipNodeText(
  lines: string[],
  start: number,
  end: number,
  hunkStart: number,
  hunkEnd: number,
  maxLines: number,
): string {
  const span = lines.slice(start - 1, end);
  if (span.length <= maxLines) return span.join("\n");
  const signatureEnd = signatureLineCount(span);
  const signature = span.slice(0, signatureEnd);
  const windowStart = Math.max(start, hunkStart - 15);
  const windowEnd = Math.min(end, hunkEnd + 15);
  const window = lines.slice(windowStart - 1, windowEnd);
  if (windowStart <= start + signature.length) return window.join("\n");
  return [...signature, "…", ...window].join("\n");
}

function signatureLineCount(span: string[]): number {
  const limit = Math.min(span.length, 8);
  for (let index = 0; index < limit; index++) {
    const line = span[index] ?? "";
    if (line.includes("{") || line.trimEnd().endsWith(":")) return index + 1;
  }
  return 1;
}

function importsFromTree(
  languageId: string,
  root: SyntaxNode,
): string[] | undefined {
  const language = languageFor(languageId);
  const pattern = IMPORT_QUERIES[languageId];
  if (!language || !pattern) return undefined;
  try {
    const query = new Query(language, pattern);
    const imports: string[] = [];
    for (const capture of query.captures(root)) {
      const text = capture.node.text.trim();
      if (!text) continue;
      imports.push(text);
      if (imports.length >= 40) break;
    }
    query.delete();
    return imports;
  } catch {
    return undefined;
  }
}

function nodeAtLine(root: SyntaxNode, line: number): SyntaxNode | undefined {
  const row = Math.max(0, line - 1);
  let current: SyntaxNode | null = root;
  let best: SyntaxNode = root;
  while (current) {
    best = current;
    let next: SyntaxNode | null = null;
    for (const child of current.namedChildren) {
      if (!child) continue;
      if (child.startPosition.row <= row && child.endPosition.row >= row) {
        next = child;
        break;
      }
    }
    current = next;
  }
  return best;
}

function splitLines(source: string): string[] {
  const lines = source.split("\n");
  if (source.endsWith("\n")) lines.pop();
  return lines;
}
