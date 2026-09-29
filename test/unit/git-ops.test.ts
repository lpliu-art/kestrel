import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDiff, readNewSource } from "../../src/git/diff-provider.ts";
import { git } from "../../src/git/exec.ts";
import {
  fileFromSource,
  parseUnifiedDiff,
  splitSourceLines,
} from "../../src/git/unified-diff.ts";
import { KestrelError } from "../../src/util/errors.ts";
import { git as gitSync, initRepo, write } from "../helpers/git-repo.ts";

describe("loadDiff", () => {
  it("collects worktree edits, untracked files, and a path filter", async () => {
    const cwd = await initRepo();
    await write(cwd, "src/a.ts", "export const a = 1;\n");
    gitSync(cwd, ["add", "src/a.ts"]);
    gitSync(cwd, ["commit", "-m", "add a"]);
    await write(cwd, "src/a.ts", "export const a = 2;\n");
    await write(cwd, "src/new.ts", "export const n = 1;\n");
    const all = await loadDiff({ cwd, mode: "workspace" });
    expect(all.files.map((file) => file.path).sort()).toEqual([
      "src/a.ts",
      "src/new.ts",
    ]);
    expect(all.head).toBe("WORKTREE");
    const filtered = await loadDiff({
      cwd,
      mode: "workspace",
      paths: ["src/a.ts"],
    });
    expect(filtered.files.map((file) => file.path)).toEqual(["src/a.ts"]);
    const edited = all.files.find((file) => file.path === "src/a.ts");
    expect(edited).toBeDefined();
    if (!edited) return;
    expect(await readNewSource(cwd, edited, all)).toContain("a = 2");
  });

  it("reads staged, single-commit, and range diffs", async () => {
    const cwd = await initRepo();
    await write(cwd, "src/a.ts", "export const a = 1;\n");
    gitSync(cwd, ["add", "src/a.ts"]);
    const staged = await loadDiff({ cwd, mode: "staged" });
    expect(staged.head).toBe("INDEX");
    expect(staged.files[0]?.status).toBe("added");
    const stagedFile = staged.files[0];
    expect(stagedFile).toBeDefined();
    if (!stagedFile) return;
    expect(await readNewSource(cwd, stagedFile, staged)).toContain("a = 1");
    gitSync(cwd, ["commit", "-m", "add a"]);
    await write(cwd, "src/a.ts", "export const a = 2;\n");
    gitSync(cwd, ["add", "src/a.ts"]);
    gitSync(cwd, ["commit", "-m", "edit a"]);
    const commit = await loadDiff({ cwd, mode: "commit", commit: "HEAD" });
    expect(commit.files[0]?.addedLineNumbers).toEqual([1]);
    const commitFile = commit.files[0];
    expect(commitFile).toBeDefined();
    if (!commitFile) return;
    expect(await readNewSource(cwd, commitFile, commit)).toContain("a = 2");
    const range = await loadDiff({
      cwd,
      mode: "range",
      from: "HEAD~1",
      to: "HEAD",
    });
    expect(range.mode).toBe("range");
    expect(range.files[0]?.path).toBe("src/a.ts");
  });

  it("reviews an unborn repository and rejects bad revisions", async () => {
    const empty = await mkdtemp(join(tmpdir(), "kestrel-empty-"));
    gitSync(empty, ["init", "-b", "main"]);
    await write(empty, "src/only.ts", "export const only = 1;\n");
    const diff = await loadDiff({ cwd: empty, mode: "workspace" });
    expect(diff.base).toBeUndefined();
    expect(diff.files[0]?.status).toBe("added");
    const plain = await mkdtemp(join(tmpdir(), "kestrel-plain-"));
    await expect(loadDiff({ cwd: plain, mode: "workspace" })).rejects.toThrow(
      /Not a git repository/,
    );
    const cwd = await initRepo();
    await expect(
      loadDiff({ cwd, mode: "commit", commit: "no-such-rev" }),
    ).rejects.toBeInstanceOf(KestrelError);
    await expect(loadDiff({ cwd, mode: "commit" })).rejects.toThrow(
      /--commit requires/,
    );
    await expect(loadDiff({ cwd, mode: "range" })).rejects.toThrow(
      /--from requires/,
    );
    await expect(
      loadDiff({ cwd, mode: "range", from: "no-such-base" }),
    ).rejects.toThrow(/merge-base/);
  });

  it("skips new source for deletions, binaries, and missing blobs", async () => {
    const cwd = await initRepo();
    await write(cwd, "src/gone.ts", "export const gone = 1;\n");
    await write(cwd, "blob.bin", Buffer.from([0, 1, 2, 3]).toString("binary"));
    gitSync(cwd, ["add", "src/gone.ts"]);
    gitSync(cwd, ["commit", "-m", "add gone"]);
    gitSync(cwd, ["rm", "src/gone.ts"]);
    const staged = await loadDiff({ cwd, mode: "staged" });
    const deleted = staged.files.find((file) => file.path === "src/gone.ts");
    expect(deleted?.status).toBe("deleted");
    expect(deleted).toBeDefined();
    if (!deleted) return;
    expect(await readNewSource(cwd, deleted, staged)).toBeUndefined();
    await writeFile(join(cwd, "blob.bin"), Buffer.from([0, 1, 2]));
    const workspace = await loadDiff({ cwd, mode: "workspace" });
    const binary = workspace.files.find((file) => file.path === "blob.bin");
    expect(binary?.binary).toBe(true);
    expect(binary).toBeDefined();
    if (!binary) return;
    expect(await readNewSource(cwd, binary, workspace)).toBeUndefined();
    const huge = Buffer.alloc(2_000_001, 97);
    await writeFile(join(cwd, "huge.txt"), huge);
    const withHuge = await loadDiff({
      cwd,
      mode: "workspace",
      paths: ["huge.txt"],
    });
    expect(withHuge.files[0]?.binary).toBe(true);
  });

  it("parses a quoted path, a gitlink, and a mode-only change", async () => {
    const cwd = await initRepo();
    await write(cwd, "my file.ts", "export const spaced = 1;\n");
    gitSync(cwd, ["add", "my file.ts"]);
    gitSync(cwd, ["commit", "-m", "space"]);
    await write(cwd, "my file.ts", "export const spaced = 2;\n");
    const spaced = await loadDiff({ cwd, mode: "workspace" });
    expect(spaced.files[0]?.path).toBe("my file.ts");
    expect(spaced.files[0]?.addedLineNumbers).toEqual([1]);

    await write(cwd, "script.sh", "echo hi\n");
    gitSync(cwd, ["add", "script.sh"]);
    gitSync(cwd, ["commit", "-m", "script"]);
    gitSync(cwd, ["update-index", "--chmod=+x", "script.sh"]);
    const mode = await loadDiff({
      cwd,
      mode: "staged",
      paths: ["script.sh"],
    });
    expect(mode.files[0]?.status).toBe("mode");

    const child = await mkdtemp(join(tmpdir(), "kestrel-child-"));
    gitSync(child, ["init", "-b", "main"]);
    gitSync(child, ["config", "user.email", "kestrel@example.com"]);
    gitSync(child, ["config", "user.name", "Kestrel"]);
    await writeFile(join(child, "lib.txt"), "lib\n");
    gitSync(child, ["add", "lib.txt"]);
    gitSync(child, ["commit", "-m", "lib"]);
    const hash = gitSync(child, ["rev-parse", "HEAD"]).trim();
    await mkdir(join(cwd, "vendor"), { recursive: true });
    gitSync(cwd, [
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${hash},vendor/lib`,
    ]);
    gitSync(cwd, ["commit", "-m", "link"]);
    const linked = await loadDiff({ cwd, mode: "commit", commit: "HEAD" });
    const gitlink = linked.files.find((file) => file.path === "vendor/lib");
    expect(gitlink?.status).toBe("submodule");
    expect(gitlink).toBeDefined();
    if (!gitlink) return;
    expect(await readNewSource(cwd, gitlink, linked)).toBeUndefined();
  });
});

describe("git exec", () => {
  it("returns a failed command when allowFail is set and throws otherwise", async () => {
    const cwd = await initRepo();
    const failed = await git(["rev-parse", "no-such-rev"], cwd, {
      allowFail: true,
    });
    expect(failed.code).not.toBe(0);
    await expect(git(["rev-parse", "no-such-rev"], cwd)).rejects.toThrow(
      /no-such-rev|unknown revision|fatal/i,
    );
    await expect(
      git(["-e", "process.exit(3)"], cwd, { command: process.execPath }),
    ).rejects.toThrow(/failed \(3\)/);
  });

  it("reports a missing binary, a timeout, and an oversized stream", async () => {
    const cwd = await initRepo();
    await expect(
      git(["--version"], cwd, { command: "/no/such/kestrel-git" }),
    ).rejects.toThrow(/not installed/);
    await expect(
      git(["-e", "setTimeout(() => {}, 10_000)"], cwd, {
        command: process.execPath,
        timeoutMs: 80,
      }),
    ).rejects.toThrow(/timed out/);
    await expect(
      git(["-e", "process.stdout.write('x'.repeat(1000))"], cwd, {
        command: process.execPath,
        maxBuffer: 32,
      }),
    ).rejects.toThrow(/maxBuffer/);
    await expect(
      git(["-e", "process.stderr.write('y'.repeat(1000))"], cwd, {
        command: process.execPath,
        maxBuffer: 32,
      }),
    ).rejects.toThrow(/maxBuffer/);
  });
});

describe("unified diff edges", () => {
  it("parses quoted paths, a gitlink line, and an empty source", () => {
    const quoted = parseUnifiedDiff(
      [
        'diff --git "a/my file.ts" "b/my file.ts"',
        "--- a/my file.ts",
        "+++ b/my file.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
      ].join("\n"),
    );
    expect(quoted[0]?.path).toBe("my file.ts");
    expect(quoted[0]?.oldPath).toBe("my file.ts");
    const broken = parseUnifiedDiff("diff --git a/only\n");
    expect(broken[0]?.path).toBe("");
    const empty = fileFromSource("empty.ts", "");
    expect(empty.hunks).toEqual([]);
    expect(fileFromSource("bin.dat", "a\0b").binary).toBe(true);
    expect(splitSourceLines("a\r\nb\r\n")).toEqual(["a", "b"]);
    expect(splitSourceLines("")).toEqual([]);
  });
});
