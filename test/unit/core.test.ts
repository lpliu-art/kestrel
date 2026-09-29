import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/load.ts";
import type { ChangedFile } from "../../src/git/unified-diff.ts";
import { FileCache, isPinnedModel, withCache } from "../../src/jev/cache.ts";
import { createHttpProvider } from "../../src/jev/http.ts";
import { RateLimiter } from "../../src/jev/rate-limit.ts";
import { estimateTokens } from "../../src/jev/tokens.ts";
import {
  emptyStats,
  type JevProvider,
  type JevResponse,
} from "../../src/jev/types.ts";
import { effectiveProbability } from "../../src/judge/decide.ts";
import { detectLanguage } from "../../src/lang/detect.ts";
import { redactText } from "../../src/security/redact.ts";
import { gateFile } from "../../src/select/gates.ts";

const sample = (path: string, added = 1): ChangedFile => ({
  path,
  status: "modified",
  hunks: [],
  addedCount: added,
  deletedCount: 0,
  binary: false,
  addedLineNumbers: added > 0 ? [1] : [],
});

describe("decisions and gates", () => {
  it("computes p_eff with one guard", () => {
    expect(effectiveProbability(0.9, [{ p: 0.05, weight: 1 }])).toBe(0.855);
    expect(effectiveProbability(0.9, [])).toBe(0.9);
  });

  it("skips secret paths and lets include bypass default paths only", () => {
    const secret = gateFile(sample(".env"), {
      include: ["**/.env"],
      exclude: [],
      reviewTests: false,
      maxAddedLinesPerFile: 1500,
      secretGlobs: [],
      defaultGlobs: [],
      testGlobs: [],
      generatedGlobs: [],
      languageId: "typescript",
    });
    expect(secret.reason).toBe("secret_path");
    const lock = gateFile(sample("yarn.lock"), {
      include: ["yarn.lock"],
      exclude: [],
      reviewTests: false,
      maxAddedLinesPerFile: 1500,
      secretGlobs: [],
      defaultGlobs: ["**/yarn.lock"],
      testGlobs: [],
      generatedGlobs: [],
      languageId: "typescript",
    });
    expect(lock.decision).toBe("review");
  });

  it("detects extensions and shebangs", () => {
    const languages = [
      { id: "python", extensions: [".py"], shebangs: ["python", "python3"] },
      { id: "javascript", extensions: [".js"], shebangs: ["node"] },
    ];
    expect(detectLanguage("src/app.py", "", languages)).toBe("python");
    expect(
      detectLanguage("bin/tool", "#!/usr/bin/env python3\n", languages),
    ).toBe("python");
  });
});

describe("redaction", () => {
  it("replaces the AWS example key with the exact marker", () => {
    const result = redactText('const key = "AKIAIOSFODNN7EXAMPLE";');
    expect(result.text).toContain("[REDACTED:aws-key]");
    expect(result.text).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });
});

describe("cache and rate limit", () => {
  it("counts a second pinned request as cached", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kestrel-cache-"));
    const cache = new FileCache(dir, 86_400_000);
    const stats = emptyStats();
    let calls = 0;
    const inner: JevProvider = {
      name: "mock",
      isAI: false,
      async ask() {
        calls += 1;
        const response: JevResponse = {
          model: "mock-1",
          answers: { q: { type: "noul", noul: 0.2 } },
          usage: { input_tokens: 3, output_tokens: 1 },
        };
        return response;
      },
    };
    const wrapped = withCache(inner, cache, true, stats, () => {});
    const req = {
      model: "jev-1.13.0",
      state: { hunk: "L1 + const x = 1;" },
      questions: {},
    };
    await wrapped.ask(req);
    await wrapped.ask(req);
    expect(calls).toBe(1);
    expect(stats.cachedRequests).toBe(1);
    expect(stats.requests).toBe(2);
    expect(isPinnedModel("jev-latest")).toBe(false);
  });

  it("waits on a fake clock when the token bucket is empty", async () => {
    let now = 0;
    const slept: number[] = [];
    const limiter = new RateLimiter(
      { requestsPerMinute: 1, tokensPerSecond: 100 },
      {
        now: () => now,
        sleep: async (ms) => {
          slept.push(ms);
          now += ms;
        },
      },
    );
    await limiter.acquire(1);
    await limiter.acquire(1);
    expect(slept.length).toBeGreaterThan(0);
  });
});

describe("http provider", () => {
  it("maps 401 and 422 without retrying, and retries 429", async () => {
    const seen: number[] = [];
    const fetchImpl: typeof fetch = async () => {
      seen.push(1);
      const status = seen.length === 1 ? 429 : 200;
      return new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {},
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        {
          status,
        },
      );
    };
    const provider = createHttpProvider({
      apiKey: "test",
      fetch: fetchImpl,
      sleep: async () => {},
    });
    const ok = await provider.ask({
      model: "jev-1.13.0",
      state: "x",
      questions: {},
    });
    expect(ok.model).toBe("jev-1.13.0");
    expect(seen.length).toBe(2);

    const denied = createHttpProvider({
      apiKey: "test",
      fetch: async () => new Response("no", { status: 401 }),
      sleep: async () => {},
    });
    await expect(
      denied.ask({ model: "jev-1.13.0", state: "x", questions: {} }),
    ).rejects.toMatchObject({
      exitCode: 3,
      category: "auth",
    });
    const invalid = createHttpProvider({
      apiKey: "test",
      fetch: async () => new Response("bad", { status: 422 }),
      sleep: async () => {},
    });
    await expect(
      invalid.ask({ model: "jev-1.13.0", state: "x", questions: {} }),
    ).rejects.toMatchObject({
      category: "validation",
    });
  });
});

describe("config", () => {
  it("rejects unknown keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kestrel-cfg-"));
    await writeFile(join(dir, ".kestrel.yml"), "nope: true\n");
    expect(() =>
      loadConfig({ cwd: dir, env: { XDG_CONFIG_HOME: join(dir, "xdg") } }),
    ).toThrow(/Invalid config/);
  });
});

describe("tokens", () => {
  it("estimates from utf8 bytes", () => {
    expect(estimateTokens("abcd")).toBe(2);
  });
});
