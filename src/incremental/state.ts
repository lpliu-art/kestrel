import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { git } from "../git/exec.ts";

const FILE = ".kestrel/incremental.json";

export interface IncrementalState {
  head: string;
}

export async function readIncremental(
  cwd: string,
): Promise<IncrementalState | undefined> {
  try {
    const parsed = JSON.parse(await readFile(join(cwd, FILE), "utf8")) as {
      head?: unknown;
    };
    return typeof parsed.head === "string" && parsed.head
      ? { head: parsed.head }
      : undefined;
  } catch {
    return undefined;
  }
}

export async function writeIncremental(
  cwd: string,
  head: string,
): Promise<void> {
  const dir = join(cwd, ".kestrel");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "incremental.json"),
    `${JSON.stringify({ head }, null, 2)}\n`,
  );
}

export async function incrementalSince(
  cwd: string,
  headRev: string,
): Promise<{ since?: string; warning?: string }> {
  const state = await readIncremental(cwd);
  if (!state) return {};
  const head = await git(["rev-parse", "--verify", headRev], cwd, {
    allowFail: true,
  });
  if (head.code !== 0) return {};
  const resolved = head.stdout.trim();
  if (state.head === resolved) return { since: resolved };
  const ancestor = await git(
    ["merge-base", "--is-ancestor", state.head, resolved],
    cwd,
    { allowFail: true },
  );
  if (ancestor.code !== 0) {
    return {
      warning: `Incremental state ${state.head.slice(0, 7)} is not an ancestor of ${resolved.slice(0, 7)}; reviewing the full range.`,
    };
  }
  return { since: state.head };
}
