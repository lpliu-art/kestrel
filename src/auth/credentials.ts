import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { parse, stringify } from "yaml";
import { KestrelError } from "../util/errors.ts";
import { credentialsPath, globalConfigPath, userConfigDir } from "./paths.ts";

export type KeySource = "env" | "file" | "none";

export interface ResolvedApiKey {
  key: string | undefined;
  source: KeySource;
  path?: string;
}

/** Resolve the Jev API key. Env wins over the credentials file. Never logs the key. */
export function resolveApiKey(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedApiKey {
  const fromEnv = env.TYPESAFE_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, source: "env" };
  const path = credentialsPath(env);
  if (!existsSync(path)) return { key: undefined, source: "none" };
  try {
    const raw = readFileSync(path, "utf8").trim();
    if (!raw) return { key: undefined, source: "none", path };
    const key = parseCredentialsBody(raw);
    if (!key) return { key: undefined, source: "none", path };
    return { key, source: "file", path };
  } catch (error) {
    throw new KestrelError(
      `Cannot read credentials ${path}: ${(error as Error).message}`,
      3,
      "auth",
    );
  }
}

export function writeCredentials(
  key: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const trimmed = key.trim();
  if (!trimmed) {
    throw new KestrelError("API key must not be empty.", 2, "usage");
  }
  const dir = userConfigDir(env);
  mkdirSync(dir, { recursive: true });
  const path = credentialsPath(env);
  writeFileSync(path, `${trimmed}\n`, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") {
    try {
      chmodSync(path, 0o600);
    } catch {
      // best-effort on filesystems that ignore mode
    }
  }
  return path;
}

export function clearCredentials(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const path = credentialsPath(env);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

export function maskKey(key: string): string {
  if (key.length <= 4) return "****";
  return `…${key.slice(-4)}`;
}

export function statusText(
  resolved: ResolvedApiKey,
  lang: "zh-CN" | "en" = "en",
): string {
  if (resolved.source === "none" || !resolved.key) {
    return lang === "en"
      ? "API key: none (set TYPESAFE_API_KEY, or run kestrel auth set)"
      : "API key：无（设置 TYPESAFE_API_KEY，或运行 kestrel auth set）";
  }
  const tail = maskKey(resolved.key);
  if (resolved.source === "env") {
    return lang === "en"
      ? `API key: env (TYPESAFE_API_KEY) · ${tail}`
      : `API key：环境变量 TYPESAFE_API_KEY · ${tail}`;
  }
  const where = resolved.path ?? "credentials";
  return lang === "en"
    ? `API key: file (${where}) · ${tail}`
    : `API key：文件（${where}） · ${tail}`;
}

export function readSkipKeyPrompt(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const path = globalConfigPath(env);
  if (!existsSync(path)) return false;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = (parse(raw) ?? {}) as { auth?: { skipKeyPrompt?: boolean } };
    return parsed.auth?.skipKeyPrompt === true;
  } catch {
    return false;
  }
}

export function writeSkipKeyPrompt(
  skip: boolean,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const path = globalConfigPath(env);
  mkdirSync(dirname(path), { recursive: true });
  let doc: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const parsed = parse(readFileSync(path, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        doc = parsed as Record<string, unknown>;
      }
    } catch {
      doc = {};
    }
  }
  const auth =
    doc.auth && typeof doc.auth === "object" && !Array.isArray(doc.auth)
      ? { ...(doc.auth as Record<string, unknown>) }
      : {};
  auth.skipKeyPrompt = skip;
  doc.auth = auth;
  if (!doc.version) doc.version = 1;
  writeFileSync(path, stringify(doc), "utf8");
}

function parseCredentialsBody(raw: string): string | undefined {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  for (const line of lines) {
    const match = /^TYPESAFE_API_KEY\s*=\s*(.*)$/.exec(line);
    if (match) {
      let value = match[1]?.trim() ?? "";
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return value || undefined;
    }
  }
  // Single-line bare key
  if (lines.length === 1) return lines[0];
  return undefined;
}
