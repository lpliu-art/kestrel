import type { DiffLine } from "../git/unified-diff.ts";

export function serializeHunk(
  header: string | undefined,
  lines: DiffLine[],
  deletedStart = 1,
): string {
  const out: string[] = [];
  if (header) out.push(header);
  let deleted = deletedStart;
  for (const line of lines) {
    if (line.kind === "added" && line.newNo !== undefined) {
      out.push(`L${line.newNo} + ${line.text}`);
    } else if (line.kind === "context" && line.newNo !== undefined) {
      out.push(`L${line.newNo}   ${line.text}`);
    } else if (line.kind === "deleted") {
      out.push(`D${deleted} - ${line.text}`);
      deleted += 1;
    }
  }
  return out.join("\n");
}

export interface ParsedHunkLine {
  kind: "added" | "context" | "deleted";
  no?: number;
  text: string;
}

export function parseStateHunk(hunk: string): {
  text: string;
  added: ParsedHunkLine[];
  deleted: ParsedHunkLine[];
} {
  const added: ParsedHunkLine[] = [];
  const deleted: ParsedHunkLine[] = [];
  for (const line of hunk.split("\n")) {
    const addedMatch = /^L(\d+) \+ (.*)$/.exec(line);
    if (addedMatch) {
      added.push({
        kind: "added",
        no: Number(addedMatch[1]),
        text: addedMatch[2] ?? "",
      });
      continue;
    }
    const deletedMatch = /^D(\d+) - (.*)$/.exec(line);
    if (deletedMatch)
      deleted.push({
        kind: "deleted",
        no: Number(deletedMatch[1]),
        text: deletedMatch[2] ?? "",
      });
  }
  return { text: hunk, added, deleted };
}
