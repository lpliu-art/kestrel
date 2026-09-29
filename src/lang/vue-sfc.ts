import type { ChangedFile, Hunk } from "../git/unified-diff.ts";

export interface VueBlock {
  kind: "script" | "template";
  languageId: string;
  startLine: number;
  endLine: number;
}

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const TEMPLATE = /<template\b([^>]*)>([\s\S]*?)<\/template>/gi;

export function vueBlocks(source: string): VueBlock[] {
  return [
    ...blocksOf(source, SCRIPT, "script"),
    ...blocksOf(source, TEMPLATE, "template"),
  ];
}

export function clipFileToLines(
  file: ChangedFile,
  startLine: number,
  endLine: number,
): ChangedFile | undefined {
  const hunks: Hunk[] = [];
  for (const hunk of file.hunks) {
    const lines = hunk.lines.filter((line) => {
      const no = line.newNo;
      return no !== undefined && no >= startLine && no <= endLine;
    });
    if (lines.length === 0) continue;
    hunks.push({
      ...hunk,
      newStart: lines[0]?.newNo ?? startLine,
      newLines: lines.length,
      lines,
    });
  }
  if (hunks.length === 0) return undefined;
  const addedLineNumbers = hunks.flatMap((hunk) =>
    hunk.lines.flatMap((line) =>
      line.kind === "added" && line.newNo !== undefined ? [line.newNo] : [],
    ),
  );
  if (addedLineNumbers.length === 0) return undefined;
  return {
    ...file,
    hunks,
    addedCount: addedLineNumbers.length,
    deletedCount: 0,
    addedLineNumbers,
  };
}

export function reviewSlices(
  file: ChangedFile,
  languageId: string,
  source: string,
): Array<{ file: ChangedFile; languageId: string }> {
  if (languageId !== "vue") return [{ file, languageId }];
  const slices = vueBlocks(source).flatMap((block) => {
    const clipped = clipFileToLines(file, block.startLine, block.endLine);
    return clipped ? [{ file: clipped, languageId: block.languageId }] : [];
  });
  return slices.length > 0 ? slices : [{ file, languageId }];
}

function blocksOf(
  source: string,
  pattern: RegExp,
  kind: VueBlock["kind"],
): VueBlock[] {
  const blocks: VueBlock[] = [];
  pattern.lastIndex = 0;
  for (const match of source.matchAll(pattern)) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const openEnd = (match.index ?? 0) + match[0].indexOf(">") + 1;
    const tagLine = source.slice(0, openEnd).split("\n").length;
    const leading = /^\r?\n/.exec(body);
    const startLine = leading ? tagLine + 1 : tagLine;
    const content = leading ? body.slice(leading[0].length) : body;
    const lines = content.replace(/\r?\n$/, "").split("\n");
    if (!content.trim()) continue;
    blocks.push({
      kind,
      languageId: kind === "template" ? "vue" : scriptLanguage(attrs),
      startLine,
      endLine: startLine + Math.max(0, lines.length - 1),
    });
  }
  return blocks;
}

function scriptLanguage(attrs: string): string {
  if (/lang\s*=\s*["']ts["']/i.test(attrs)) return "typescript";
  if (/lang\s*=\s*["']tsx["']/i.test(attrs)) return "tsx";
  return "javascript";
}
