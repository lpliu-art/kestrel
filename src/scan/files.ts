import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { type ChangedFile, fileFromSource } from "../git/unified-diff.ts";
import { KestrelError } from "../util/errors.ts";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  "target",
  "vendor",
]);

export async function scanFiles(query: {
  cwd: string;
  paths?: string[];
}): Promise<ChangedFile[]> {
  const paths = query.paths ?? [];
  if (paths.length === 0) {
    throw new KestrelError(
      "kestrel scan requires at least one path",
      2,
      "usage",
    );
  }
  const files = [];
  for (const path of paths) {
    const abs = join(query.cwd, path);
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(abs);
    } catch {
      throw new KestrelError(`Cannot read ${path}`, 2, "usage");
    }
    if (info.isDirectory()) {
      for (const child of await walk(abs)) {
        const rel = relative(query.cwd, child).split(sep).join("/");
        const loaded = await loadOne(rel, child);
        if (loaded) files.push(loaded);
      }
    } else {
      const loaded = await loadOne(path.split(sep).join("/"), abs);
      if (loaded) files.push(loaded);
    }
  }
  return files;
}

async function walk(dir: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(abs)));
    else if (entry.isFile()) found.push(abs);
  }
  return found;
}

async function loadOne(path: string, abs: string) {
  const buf = await readFile(abs);
  if (buf.includes(0) || buf.length > 2_000_000) return undefined;
  return fileFromSource(path, buf.toString("utf8"));
}
