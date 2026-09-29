import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { scanFiles } from "../scan/files.ts";
import { KestrelError } from "../util/errors.ts";
import { git } from "./exec.ts";
import {
  type ChangedFile,
  fileFromSource,
  parseUnifiedDiff,
} from "./unified-diff.ts";

export type DiffMode = "workspace" | "staged" | "commit" | "range" | "scan";

export interface DiffQuery {
  cwd: string;
  mode: DiffMode;
  commit?: string;
  from?: string;
  to?: string;
  paths?: string[];
  /** Diff this commit to the head instead of the merge-base. */
  since?: string;
}

export interface DiffSet {
  mode: DiffMode;
  base?: string;
  head?: string;
  files: ChangedFile[];
}

const DIFF_ARGS = [
  "--no-ext-diff",
  "--no-color",
  "-M",
  "-U3",
  "--src-prefix=a/",
  "--dst-prefix=b/",
];

export async function loadDiff(query: DiffQuery): Promise<DiffSet> {
  if (query.mode === "scan") {
    return { mode: "scan", files: await scanFiles(query) };
  }
  await assertGitRepo(query.cwd);
  if (query.mode === "staged") return loadStaged(query);
  if (query.mode === "commit") return loadCommit(query);
  if (query.mode === "range") return loadRange(query);
  return loadWorkspace(query);
}

async function assertGitRepo(cwd: string): Promise<void> {
  const result = await git(["rev-parse", "--is-inside-work-tree"], cwd, {
    allowFail: true,
  });
  if (result.code !== 0 || result.stdout.trim() !== "true") {
    throw new KestrelError(`Not a git repository: ${cwd}`, 2, "usage");
  }
}

async function loadWorkspace(query: DiffQuery): Promise<DiffSet> {
  if (query.since) {
    const since = await revParse(query.cwd, query.since, false);
    const head = await revParse(query.cwd, "HEAD", true);
    const diff = await git(
      ["diff", since, ...DIFF_ARGS, "--", ...(query.paths ?? [])],
      query.cwd,
    );
    return {
      mode: "workspace",
      base: since,
      ...(head ? { head } : {}),
      files: parseUnifiedDiff(diff.stdout),
    };
  }
  const head = await revParse(query.cwd, "HEAD", true);
  let files: ChangedFile[] = [];
  if (head) {
    const diff = await git(
      ["diff", "HEAD", ...DIFF_ARGS, "--", ...(query.paths ?? [])],
      query.cwd,
    );
    files = parseUnifiedDiff(diff.stdout);
  }
  const untracked = await git(
    [
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      ...(query.paths ?? []),
    ],
    query.cwd,
  );
  for (const rel of untracked.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)) {
    if (files.some((file) => file.path === rel)) continue;
    const source = await readWorkingFile(query.cwd, rel);
    files.push(fileFromSource(rel, source.text, source.binary));
  }
  return {
    mode: "workspace",
    base: head,
    head: head ? "WORKTREE" : undefined,
    files,
  };
}

async function loadStaged(query: DiffQuery): Promise<DiffSet> {
  const head = await revParse(query.cwd, "HEAD", true);
  const diff = await git(
    ["diff", "--cached", ...DIFF_ARGS, "--", ...(query.paths ?? [])],
    query.cwd,
  );
  return {
    mode: "staged",
    base: head,
    head: "INDEX",
    files: parseUnifiedDiff(diff.stdout),
  };
}

async function loadCommit(query: DiffQuery): Promise<DiffSet> {
  if (!query.commit)
    throw new KestrelError("--commit requires a revision", 2, "usage");
  const head = await revParse(query.cwd, query.commit, false);
  const base = await revParse(query.cwd, `${query.commit}^`, true);
  const diff = await git(
    ["show", "--format=", ...DIFF_ARGS, head, "--", ...(query.paths ?? [])],
    query.cwd,
  );
  return { mode: "commit", base, head, files: parseUnifiedDiff(diff.stdout) };
}

async function loadRange(query: DiffQuery): Promise<DiffSet> {
  if (!query.from)
    throw new KestrelError("--from requires a revision", 2, "usage");
  const to = query.to ?? "HEAD";
  const head = await revParse(query.cwd, to, false);
  if (query.since) {
    const since = await revParse(query.cwd, query.since, false);
    const diff = await git(
      ["diff", since, head, ...DIFF_ARGS, "--", ...(query.paths ?? [])],
      query.cwd,
    );
    return {
      mode: "range",
      base: since,
      head,
      files: parseUnifiedDiff(diff.stdout),
    };
  }
  const baseResult = await git(["merge-base", query.from, head], query.cwd, {
    allowFail: true,
  });
  if (baseResult.code !== 0) {
    throw new KestrelError(
      `Cannot resolve merge-base of ${query.from} and ${to}: ${baseResult.stderr.trim()}`,
      2,
      "usage",
    );
  }
  const base = baseResult.stdout.trim();
  const diff = await git(
    ["diff", base, head, ...DIFF_ARGS, "--", ...(query.paths ?? [])],
    query.cwd,
  );
  return { mode: "range", base, head, files: parseUnifiedDiff(diff.stdout) };
}

async function revParse(
  cwd: string,
  rev: string,
  allowFail: true,
): Promise<string | undefined>;
async function revParse(
  cwd: string,
  rev: string,
  allowFail: false,
): Promise<string>;
async function revParse(
  cwd: string,
  rev: string,
  allowFail: boolean,
): Promise<string | undefined> {
  const result = await git(["rev-parse", "--verify", rev], cwd, {
    allowFail: true,
  });
  if (result.code !== 0) {
    if (allowFail) return undefined;
    throw new KestrelError(`Unknown revision: ${rev}`, 2, "usage");
  }
  return result.stdout.trim();
}

async function readWorkingFile(
  cwd: string,
  path: string,
): Promise<{ text: string; binary: boolean }> {
  const abs = join(cwd, path);
  const buf = await readFile(abs);
  if (buf.includes(0) || buf.length > 2_000_000)
    return { text: "", binary: buf.includes(0) || buf.length > 2_000_000 };
  return { text: buf.toString("utf8"), binary: false };
}

export async function readNewSource(
  cwd: string,
  file: ChangedFile,
  diff: DiffSet,
): Promise<string | undefined> {
  if (file.binary || file.status === "deleted" || file.status === "submodule")
    return undefined;
  try {
    if (diff.mode === "workspace" || file.status === "added") {
      const buf = await readFile(join(cwd, file.path));
      if (buf.includes(0)) return undefined;
      return buf.toString("utf8");
    }
    if (diff.mode === "staged") {
      const shown = await git(["show", `:${file.path}`], cwd, {
        allowFail: true,
      });
      if (shown.code !== 0) return undefined;
      return shown.stdout;
    }
    const rev = diff.head;
    if (!rev || rev === "WORKTREE" || rev === "INDEX") return undefined;
    const shown = await git(["show", `${rev}:${file.path}`], cwd, {
      allowFail: true,
    });
    if (shown.code !== 0) return undefined;
    return shown.stdout;
  } catch {
    return undefined;
  }
}
