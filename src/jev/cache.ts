import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { requestHash } from "../util/hash.ts";
import type { JevProvider, JevResponse, ProviderStats } from "./types.ts";

export interface ResponseCache {
  get(key: string): Promise<JevResponse | undefined>;
  set(key: string, value: JevResponse): Promise<void>;
  stats(): Promise<{ entries: number; bytes: number }>;
  clear(): Promise<void>;
}

export class FileCache implements ResponseCache {
  constructor(
    private readonly dir: string,
    private readonly ttlMs: number,
  ) {}

  async get(key: string): Promise<JevResponse | undefined> {
    const path = this.pathFor(key);
    try {
      const info = await stat(path);
      if (Date.now() - info.mtimeMs > this.ttlMs) return undefined;
      return JSON.parse(await readFile(path, "utf8")) as JevResponse;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: JevResponse): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(join(this.dir, key.slice(0, 2)), { recursive: true });
    const stored: JevResponse = {
      model: value.model,
      answers: value.answers,
      usage: value.usage,
    };
    await writeFile(path, JSON.stringify(stored));
  }

  async stats(): Promise<{ entries: number; bytes: number }> {
    let entries = 0;
    let bytes = 0;
    const walk = async (dir: string) => {
      let names: string[] = [];
      try {
        names = await readdir(dir);
      } catch {
        return;
      }
      for (const name of names) {
        const path = join(dir, name);
        const info = await stat(path);
        if (info.isDirectory()) await walk(path);
        else if (name.endsWith(".json")) {
          entries += 1;
          bytes += info.size;
        }
      }
    };
    await walk(this.dir);
    return { entries, bytes };
  }

  async clear(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }

  private pathFor(key: string): string {
    return join(this.dir, key.slice(0, 2), `${key}.json`);
  }
}

export function isPinnedModel(model: string): boolean {
  return /^jev-\d+\.\d+\.\d+$/.test(model);
}

export function withCache(
  inner: JevProvider,
  cache: ResponseCache,
  enabled: boolean,
  stats: ProviderStats,
  warn: (message: string) => void,
): JevProvider {
  let warned = false;
  return {
    name: inner.name,
    isAI: inner.isAI,
    async ask(req, opts) {
      stats.requests += 1;
      const pinned = isPinnedModel(req.model);
      if (!enabled || !pinned) {
        if (enabled && !pinned && !warned) {
          warned = true;
          warn(
            `Model ${req.model} is not a pinned version; the response cache is disabled.`,
          );
        }
        const response = await inner.ask(req, opts);
        addUsage(stats, response);
        return response;
      }
      const key = requestHash(req);
      const hit = await cache.get(key);
      if (hit) {
        stats.cachedRequests += 1;
        addUsage(stats, hit);
        return { ...hit, meta: { provider: inner.name, cached: true } };
      }
      const response = await inner.ask(req, opts);
      addUsage(stats, response);
      await cache.set(key, response);
      return response;
    },
    listModels: inner.listModels
      ? () => inner.listModels?.() ?? Promise.resolve([])
      : undefined,
  };
}

function addUsage(stats: ProviderStats, response: JevResponse): void {
  stats.inputTokens += response.usage.input_tokens;
  stats.outputTokens += response.usage.output_tokens;
}
