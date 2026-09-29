export interface EnclosingScope {
  kind: string;
  name?: string;
  startLine: number;
  endLine: number;
  text: string;
}

const SIGNATURES: Record<string, RegExp> = {
  typescript:
    /^\s*(export\s+)?(default\s+)?(async\s+)?function\b|^\s*(export\s+)?(default\s+)?class\b|^\s*(public|private|protected|async|static|readonly|\s)*[\w]+\s*\([^;]*\)\s*\{?\s*$/,
  tsx: /^\s*(export\s+)?(default\s+)?(async\s+)?function\b|^\s*(export\s+)?class\b/,
  javascript: /^\s*(export\s+)?(async\s+)?function\b|^\s*class\b/,
  vue: /^\s*(export\s+)?(async\s+)?function\b|^\s*(setup|const)\b/,
  python: /^\s*(async\s+)?def\s+\w+|^\s*class\s+\w+/,
  java: /^\s*(public|private|protected|static|final|\s)*[\w<>[\]]+\s+\w+\s*\([^;]*\)\s*\{?\s*$|^\s*(public|private|protected)?\s*(class|interface|enum)\b/,
  go: /^\s*func\s+(\([^)]+\)\s*)?\w+/,
  rust: /^\s*(pub\s+)?(async\s+)?fn\s+\w+|^\s*(pub\s+)?(struct|enum|impl)\b/,
  csharp:
    /^\s*(public|private|protected|internal|static|async|\s)*[\w<>[\]]+\s+\w+\s*\([^;]*\)\s*\{?\s*$|^\s*(public|private|protected|internal)?\s*(class|interface|enum|struct)\b/,
};

export function findEnclosing(
  sourceLines: string[],
  startLine: number,
  languageId: string,
  maxLines = 60,
): EnclosingScope | undefined {
  const origin = sourceLines[startLine - 1] ?? "";
  const originIndent = indentOf(
    origin.trim() ? origin : firstNonEmpty(sourceLines, startLine - 1),
  );
  const signature = SIGNATURES[languageId] ?? SIGNATURES.typescript ?? /$a/;
  const from = Math.max(0, startLine - 1 - maxLines);
  for (let index = startLine - 2; index >= from; index--) {
    const line = sourceLines[index] ?? "";
    if (!line.trim()) continue;
    if (indentOf(line) < originIndent && signature.test(line)) {
      const end = Math.min(sourceLines.length, index + maxLines);
      return {
        kind: kindOf(line),
        name: nameOf(line),
        startLine: index + 1,
        endLine: end,
        text: sourceLines.slice(index, end).join("\n"),
      };
    }
  }
  return undefined;
}

export function extractImports(sourceLines: string[], limit = 40): string[] {
  const imports: string[] = [];
  for (const line of sourceLines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("import ") ||
      trimmed.startsWith("from ") ||
      trimmed.startsWith("package ") ||
      trimmed.startsWith("using ") ||
      trimmed.startsWith("use ") ||
      /require\(/.test(trimmed)
    ) {
      imports.push(trimmed);
      if (imports.length >= limit) break;
    }
  }
  return imports;
}

function indentOf(line: string): number {
  const match = /^\s*/.exec(line);
  return match ? match[0].length : 0;
}

function firstNonEmpty(lines: string[], start: number): string {
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim()) return line;
  }
  return "";
}

function kindOf(line: string): string {
  if (/\bclass\b/.test(line)) return "class";
  if (/\b(def|func|function|fn)\b/.test(line)) return "function";
  return "block";
}

function nameOf(line: string): string | undefined {
  const match =
    /\b(?:function|class|def|func|fn|interface|enum)\s+(\w+)/.exec(line) ??
    /\b(\w+)\s*\(/.exec(line);
  return match?.[1];
}
