import type { ChangedFile, DiffLine, Hunk } from "../git/unified-diff.ts";

export interface ReviewUnit {
  id: string;
  path: string;
  languageId: string;
  pluginId: string;
  startLine: number;
  endLine: number;
  addedLineNumbers: number[];
  lines: DiffLine[];
  header?: string;
  sourceLines: string[];
  frameworks: string[];
  testsChanged: string[];
}

export function buildUnits(
  file: ChangedFile,
  sourceLines: string[],
  languageId: string,
  pluginId: string,
  limits: { maxAddedLinesPerUnit: number },
  meta?: {
    frameworks?: string[];
    testsChanged?: string[];
    enclosingAt?: (line: number) => string | undefined;
  },
): ReviewUnit[] {
  const max = Math.min(254, limits.maxAddedLinesPerUnit);
  const drafts: Array<{ lines: DiffLine[]; header?: string }> = [];
  for (const hunk of file.hunks) {
    for (const lines of splitHunk(hunk, max))
      drafts.push({ lines, header: hunk.header });
  }
  const merged = mergeDrafts(drafts, max, meta?.enclosingAt);
  return merged.map((draft, index) => {
    const span = lineSpan(draft.lines);
    return {
      id: `${file.path}:${span.start}-${span.end}#${index}`,
      path: file.path,
      languageId,
      pluginId,
      startLine: span.start,
      endLine: span.end,
      addedLineNumbers: span.added,
      lines: draft.lines,
      header: draft.header,
      sourceLines,
      frameworks: meta?.frameworks ?? [],
      testsChanged: meta?.testsChanged ?? [],
    };
  });
}

function splitHunk(hunk: Hunk, max: number): DiffLine[][] {
  const added = hunk.lines.filter((line) => line.kind === "added").length;
  if (added <= max)
    return hunk.lines.some((line) => line.kind === "added") ? [hunk.lines] : [];
  const windows: DiffLine[][] = [];
  let current: DiffLine[] = [];
  let count = 0;
  const flush = () => {
    if (current.some((line) => line.kind === "added")) windows.push(current);
    const overlap = current.slice(-5);
    current = [...overlap];
    count = overlap.filter((line) => line.kind === "added").length;
  };
  for (const line of hunk.lines) {
    if (line.kind === "added" && count >= max) flush();
    current.push(line);
    if (line.kind === "added") count += 1;
  }
  if (current.some((line) => line.kind === "added")) windows.push(current);
  return windows;
}

function mergeDrafts(
  drafts: Array<{ lines: DiffLine[]; header?: string }>,
  max: number,
  enclosingAt?: (line: number) => string | undefined,
): Array<{ lines: DiffLine[]; header?: string }> {
  const out: Array<{ lines: DiffLine[]; header?: string }> = [];
  for (const draft of drafts) {
    const prev = out.at(-1);
    const span = lineSpan(draft.lines);
    if (!prev) {
      out.push({ lines: [...draft.lines], header: draft.header });
      continue;
    }
    const prevSpan = lineSpan(prev.lines);
    const gap = span.start - prevSpan.end;
    const combined = prevSpan.added.length + span.added.length;
    if (
      gap >= 0 &&
      gap <= 6 &&
      combined <= max &&
      combined > 0 &&
      sameEnclosing(prevSpan.added[0], span.added[0], enclosingAt)
    ) {
      prev.lines.push(...draft.lines);
      continue;
    }
    out.push({ lines: [...draft.lines], header: draft.header });
  }
  return out;
}

function sameEnclosing(
  left: number | undefined,
  right: number | undefined,
  enclosingAt?: (line: number) => string | undefined,
): boolean {
  if (!enclosingAt || left === undefined || right === undefined) return true;
  const a = enclosingAt(left);
  const b = enclosingAt(right);
  if (a && b) return a === b;
  if (a || b) return false;
  return true;
}

function lineSpan(lines: DiffLine[]): {
  start: number;
  end: number;
  added: number[];
} {
  const added = lines
    .filter((line) => line.kind === "added" && line.newNo !== undefined)
    .map((line) => line.newNo as number);
  const numbered = lines
    .map((line) => line.newNo)
    .filter((no): no is number => no !== undefined);
  const start = numbered[0] ?? added[0] ?? 1;
  const end = numbered.at(-1) ?? added.at(-1) ?? start;
  return { start, end, added };
}
