export type LineKind = "context" | "added" | "deleted";

export interface DiffLine {
  kind: LineKind;
  text: string;
  oldNo?: number;
  newNo?: number;
  noNewline?: boolean;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
}

export type FileStatus =
  | "added"
  | "deleted"
  | "modified"
  | "renamed"
  | "binary"
  | "mode"
  | "submodule";

export interface ChangedFile {
  oldPath?: string;
  path: string;
  status: FileStatus;
  hunks: Hunk[];
  addedCount: number;
  deletedCount: number;
  binary: boolean;
  addedLineNumbers: number[];
}

interface DraftFile {
  oldPath?: string;
  newPath?: string;
  status: FileStatus;
  binary: boolean;
  hunks: Hunk[];
  sawDevNullOld: boolean;
  sawDevNullNew: boolean;
  renamed: boolean;
  isNew: boolean;
  isDeleted: boolean;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function parseUnifiedDiff(input: string): ChangedFile[] {
  const text = input.replace(/^\uFEFF/, "");
  const lines = text.split("\n");
  const files: ChangedFile[] = [];
  let draft: DraftFile | undefined;
  let hunk: Hunk | undefined;
  let oldNo = 0;
  let newNo = 0;

  const finish = () => {
    if (!draft) return;
    if (hunk) {
      draft.hunks.push(hunk);
      hunk = undefined;
    }
    files.push(materialize(draft));
    draft = undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i] ?? "";
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line.startsWith("diff --git ")) {
      finish();
      const paths = parseDiffGit(line);
      draft = {
        oldPath: paths?.oldPath,
        newPath: paths?.newPath,
        status: "modified",
        binary: false,
        hunks: [],
        sawDevNullOld: false,
        sawDevNullNew: false,
        renamed: false,
        isNew: false,
        isDeleted: false,
      };
      continue;
    }
    if (!draft) continue;
    if (line.startsWith("new file mode ")) {
      draft.isNew = true;
      continue;
    }
    if (line.startsWith("deleted file mode ")) {
      draft.isDeleted = true;
      continue;
    }
    if (line.startsWith("old mode ") || line.startsWith("new mode ")) {
      if (draft.status === "modified") draft.status = "mode";
      continue;
    }
    if (
      line.startsWith("rename from ") ||
      line.startsWith("rename to ") ||
      line.startsWith("similarity index ")
    ) {
      draft.renamed = true;
      continue;
    }
    if (
      line.startsWith("Binary files ") ||
      line.startsWith("GIT binary patch")
    ) {
      draft.binary = true;
      draft.status = "binary";
      continue;
    }
    if (line.startsWith("--- ")) {
      const path = stripPrefix(line.slice(4));
      if (path === "/dev/null") draft.sawDevNullOld = true;
      else draft.oldPath = path;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const path = stripPrefix(line.slice(4));
      if (path === "/dev/null") draft.sawDevNullNew = true;
      else draft.newPath = path;
      continue;
    }
    const hunkMatch = HUNK_RE.exec(line);
    if (hunkMatch) {
      if (hunk) draft.hunks.push(hunk);
      const oldStart = Number(hunkMatch[1]);
      const oldLines = hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]);
      const newStart = Number(hunkMatch[3]);
      const newLines = hunkMatch[4] === undefined ? 1 : Number(hunkMatch[4]);
      hunk = {
        oldStart,
        oldLines,
        newStart,
        newLines,
        header: line,
        lines: [],
      };
      oldNo = oldStart;
      newNo = newStart;
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith("\\")) {
      const prev = hunk.lines.at(-1);
      if (prev) prev.noNewline = true;
      continue;
    }
    if (line.startsWith("+")) {
      hunk.lines.push({ kind: "added", text: line.slice(1), newNo });
      newNo += 1;
      continue;
    }
    if (line.startsWith("-")) {
      hunk.lines.push({ kind: "deleted", text: line.slice(1), oldNo });
      oldNo += 1;
      continue;
    }
    if (line.startsWith(" ")) {
      hunk.lines.push({ kind: "context", text: line.slice(1), oldNo, newNo });
      oldNo += 1;
      newNo += 1;
      continue;
    }
    if (line.includes("Subproject commit")) {
      draft.status = "submodule";
    }
  }
  finish();
  return files;
}

function materialize(draft: DraftFile): ChangedFile {
  const path = draft.sawDevNullNew
    ? (draft.oldPath ?? draft.newPath ?? "")
    : (draft.newPath ?? draft.oldPath ?? "");
  const oldPath = draft.oldPath;
  let status = draft.status;
  if (draft.binary) status = "binary";
  else if (draft.status === "submodule") status = "submodule";
  else if (draft.isDeleted || draft.sawDevNullNew) status = "deleted";
  else if (draft.isNew || draft.sawDevNullOld) status = "added";
  else if (draft.renamed) status = "renamed";
  else if (draft.status === "mode" && draft.hunks.length === 0) status = "mode";
  else status = "modified";

  const addedLineNumbers: number[] = [];
  let deletedCount = 0;
  for (const hunk of draft.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "added" && line.newNo !== undefined)
        addedLineNumbers.push(line.newNo);
      if (line.kind === "deleted") deletedCount += 1;
    }
  }
  return {
    oldPath,
    path,
    status,
    hunks: draft.hunks,
    addedCount: addedLineNumbers.length,
    deletedCount,
    binary: draft.binary,
    addedLineNumbers,
  };
}

function parseDiffGit(
  line: string,
): { oldPath: string; newPath: string } | undefined {
  const rest = line.slice("diff --git ".length);
  if (rest.startsWith('"')) {
    const parsed = splitQuoted(rest);
    if (!parsed) return undefined;
    return { oldPath: stripPrefix(parsed[0]), newPath: stripPrefix(parsed[1]) };
  }
  const idx = rest.indexOf(" b/");
  if (idx === -1) return undefined;
  return {
    oldPath: stripPrefix(rest.slice(0, idx)),
    newPath: stripPrefix(rest.slice(idx + 1)),
  };
}

function splitQuoted(input: string): [string, string] | undefined {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === " " && !quoted) {
      if (current) parts.push(current);
      current = "";
      continue;
    }
    current += ch ?? "";
  }
  if (current) parts.push(current);
  if (parts.length < 2) return undefined;
  return [parts[0] ?? "", parts[1] ?? ""];
}

function stripPrefix(path: string): string {
  if (path === "/dev/null") return path;
  if (path.startsWith("a/") || path.startsWith("b/")) return path.slice(2);
  return path;
}

export function splitSourceLines(text: string): string[] {
  if (text.length === 0) return [];
  const parts = text.split("\n");
  if (text.endsWith("\n")) parts.pop();
  return parts.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

export function fileFromSource(
  path: string,
  source: string,
  binary = false,
): ChangedFile {
  if (binary || source.includes("\0")) {
    return {
      path,
      status: "binary",
      hunks: [],
      addedCount: 0,
      deletedCount: 0,
      binary: true,
      addedLineNumbers: [],
    };
  }
  const lines = splitSourceLines(source);
  const hunk: Hunk = {
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: lines.length,
    header: `@@ -0,0 +1,${lines.length} @@`,
    lines: lines.map((text, index) => ({
      kind: "added" as const,
      text,
      newNo: index + 1,
    })),
  };
  return {
    path,
    status: "added",
    hunks: lines.length ? [hunk] : [],
    addedCount: lines.length,
    deletedCount: 0,
    binary: false,
    addedLineNumbers: lines.map((_, index) => index + 1),
  };
}
