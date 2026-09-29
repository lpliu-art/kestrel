import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function initRepo(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "kestrel-"));
  git(cwd, ["init", "-b", "main"]);
  git(cwd, ["config", "user.email", "kestrel@example.com"]);
  git(cwd, ["config", "user.name", "Kestrel"]);
  await writeFile(join(cwd, "README.md"), "base\n");
  await writeFile(join(cwd, ".gitignore"), ".kestrel/\n");
  git(cwd, ["add", "README.md", ".gitignore"]);
  git(cwd, ["commit", "-m", "init"]);
  return cwd;
}

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

export async function write(
  cwd: string,
  path: string,
  text: string,
): Promise<void> {
  const abs = join(cwd, path);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, text);
}

export function cleanEnv(
  cwd: string,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  env.XDG_CONFIG_HOME = join(cwd, ".xdg");
  env.TYPESAFE_API_KEY = extra.TYPESAFE_API_KEY ?? "";
  env.KESTREL_PROVIDER = extra.KESTREL_PROVIDER ?? "";
  env.KESTREL_MODEL = extra.KESTREL_MODEL ?? "";
  env.KESTREL_PROFILE = extra.KESTREL_PROFILE ?? "";
  env.KESTREL_LANG = extra.KESTREL_LANG ?? "";
  env.CI = extra.CI ?? "";
  return env;
}
