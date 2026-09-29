import { spawn } from "node:child_process";
import { KestrelError } from "../util/errors.ts";

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

export async function git(
  args: string[],
  cwd: string,
  opts?: {
    timeoutMs?: number;
    maxBuffer?: number;
    allowFail?: boolean;
    /** Executable to spawn. Defaults to git on PATH. */
    command?: string;
  },
): Promise<GitResult> {
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const maxBuffer = opts?.maxBuffer ?? 50 * 1024 * 1024;
  const command = opts?.command ?? "git";
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outLen = 0;
    let errLen = 0;
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      fail(
        new KestrelError(`git timed out: git ${args.join(" ")}`, 2, "usage"),
      );
    }, timeoutMs);

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const ok = (result: GitResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      outLen += chunk.length;
      if (outLen > maxBuffer) {
        child.kill("SIGKILL");
        fail(new KestrelError("git output exceeded maxBuffer", 2, "usage"));
        return;
      }
      out.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errLen += chunk.length;
      if (errLen > maxBuffer) {
        child.kill("SIGKILL");
        fail(new KestrelError("git stderr exceeded maxBuffer", 2, "usage"));
        return;
      }
      err.push(chunk);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        fail(
          new KestrelError(
            "git is not installed or not on PATH (Git >= 2.30 required)",
            2,
            "usage",
          ),
        );
        return;
      }
      fail(error);
    });
    child.on("close", (code) => {
      const result: GitResult = {
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        code: code ?? 1,
      };
      if (result.code !== 0 && !opts?.allowFail) {
        const message =
          result.stderr.trim() ||
          `${command} ${args.join(" ")} failed (${result.code})`;
        fail(new KestrelError(message, 2, "usage"));
        return;
      }
      ok(result);
    });
  });
}
