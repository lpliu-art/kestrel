import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { KestrelError } from "../util/errors.ts";
import { requestHash } from "../util/hash.ts";
import type { JevProvider, JevRequest, JevResponse } from "./types.ts";

export interface CassetteFile {
  version: 1;
  entries: Record<string, { response: JevResponse; request?: unknown }>;
}

export async function loadCassettes(
  dir: string,
): Promise<Map<string, JevResponse>> {
  const map = new Map<string, JevResponse>();
  let names: string[] = [];
  try {
    names = (await readdir(dir))
      .filter((name) => name.endsWith(".json"))
      .sort();
  } catch {
    throw new KestrelError(`Replay directory not found: ${dir}`, 2, "config");
  }
  for (const name of names) {
    const parsed = JSON.parse(
      await readFile(join(dir, name), "utf8"),
    ) as CassetteFile;
    for (const [key, entry] of Object.entries(parsed.entries ?? {})) {
      if (!map.has(key)) map.set(key, entry.response);
    }
  }
  return map;
}

export function createReplayProvider(
  entries: Map<string, JevResponse>,
  fallback?: JevProvider,
): JevProvider {
  const models = [...entries.values()].map((entry) => entry.model);
  const isAI =
    models.length > 0 && models.every((model) => model.startsWith("jev-"));
  return {
    name: "replay",
    isAI,
    async ask(req) {
      const key = requestHash(req);
      const hit = entries.get(key);
      if (hit)
        return {
          ...hit,
          meta: { ...hit.meta, provider: "replay", cached: false },
        };
      if (fallback) return fallback.ask(req);
      throw new KestrelError(
        `Replay cassette has no entry for request ${key.slice(0, 12)}. Record one with --record or pass --replay-fallback mock.`,
        3,
        "provider",
      );
    },
  };
}

export function withRecording(inner: JevProvider, dir: string): JevProvider {
  const entries: CassetteFile["entries"] = {};
  const flush = async () => {
    await mkdir(dir, { recursive: true });
    const cassette: CassetteFile = { version: 1, entries };
    await writeFile(
      join(dir, "recorded.json"),
      JSON.stringify(cassette, null, 2),
    );
  };
  return {
    name: inner.name,
    isAI: inner.isAI,
    async ask(req, opts) {
      const response = await inner.ask(req, opts);
      entries[requestHash(req)] = {
        request: {
          model: req.model,
          state: req.state,
          questions: req.questions,
        },
        response,
      };
      await flush();
      return response;
    },
  };
}

export function hashRequest(req: JevRequest): string {
  return requestHash(req);
}
