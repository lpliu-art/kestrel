import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { maskKey, resolveApiKey } from "../auth/credentials.ts";
import type { ResolvedConfig } from "../config/schema.ts";
import {
  ensureTreesitter,
  grammarIds,
  parserKind,
} from "../treesitter/runtime.ts";

const exec = promisify(execFile);

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runDoctor(input: {
  cwd: string;
  config: ResolvedConfig;
  env: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<{ exitCode: number; checks: DoctorCheck[]; text: string }> {
  const checks: DoctorCheck[] = [];
  checks.push(await gitCheck());
  checks.push(nodeCheck());
  const resolved = resolveApiKey(input.env);
  let keyDetail: string;
  if (!resolved.key) {
    keyDetail = "TYPESAFE_API_KEY is missing";
  } else if (resolved.source === "env") {
    keyDetail = `env (TYPESAFE_API_KEY) · ${maskKey(resolved.key)}`;
  } else {
    keyDetail = `file (${resolved.path ?? "credentials"}) · ${maskKey(resolved.key)}`;
  }
  checks.push({
    name: "api key",
    ok: true,
    detail: keyDetail,
  });
  checks.push(
    await modelCheck(input.config, resolved.key, input.fetchImpl ?? fetch),
  );
  checks.push(await cacheCheck(resolve(input.cwd, input.config.jev.cache.dir)));
  checks.push(...(await parserChecks()));
  const text = `${checks
    .map(
      (check) => `${check.ok ? "ok" : "fail"}  ${check.name}: ${check.detail}`,
    )
    .join("\n")}\n`;
  const exitCode = checks.some(
    (check) =>
      !check.ok &&
      (check.name === "git" ||
        check.name === "node" ||
        check.name === "model" ||
        check.name === "parser"),
  )
    ? 1
    : 0;
  return { exitCode, checks, text };
}

async function gitCheck(): Promise<DoctorCheck> {
  try {
    const { stdout } = await exec("git", ["--version"]);
    return { name: "git", ok: true, detail: stdout.trim() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name: "git", ok: false, detail: message };
  }
}

function nodeCheck(): DoctorCheck {
  const major = Number(process.versions.node.split(".")[0] ?? 0);
  return {
    name: "node",
    ok: major >= 22,
    detail: `v${process.versions.node}`,
  };
}

async function modelCheck(
  config: ResolvedConfig,
  key: string | undefined,
  fetchImpl: typeof fetch,
): Promise<DoctorCheck> {
  if (!key) {
    return {
      name: "model",
      ok: true,
      detail: "skipped (no TYPESAFE_API_KEY)",
    };
  }
  const base = (config.jev.baseURL ?? "https://api.typesafe.ai").replace(
    /\/$/,
    "",
  );
  try {
    const response = await fetchImpl(`${base}/v1/models`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!response.ok)
      return {
        name: "model",
        ok: false,
        detail: `GET /v1/models returned ${response.status}`,
      };
    return {
      name: "model",
      ok: true,
      detail: `${config.jev.model} reachable via ${base}/v1/models`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name: "model", ok: false, detail: message };
  }
}

async function parserChecks(): Promise<DoctorCheck[]> {
  await ensureTreesitter();
  return grammarIds().map((id) => {
    const kind = parserKind(id);
    return {
      name: "parser",
      ok: kind === "tree-sitter",
      detail: `${kind} (${id})`,
    };
  });
}

async function cacheCheck(dir: string): Promise<DoctorCheck> {
  try {
    const info = await walk(dir);
    return {
      name: "cache",
      ok: true,
      detail: `${dir} files=${info.files} bytes=${info.bytes}`,
    };
  } catch {
    return {
      name: "cache",
      ok: true,
      detail: `${dir} (absent)`,
    };
  }
}

async function walk(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await walk(path);
      files += nested.files;
      bytes += nested.bytes;
    } else {
      files += 1;
      bytes += (await stat(path)).size;
    }
  }
  return { files, bytes };
}
