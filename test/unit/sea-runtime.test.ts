import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaults.ts";
import { runDoctor } from "../../src/doctor/run.ts";
import {
  clearGrammarFailureForTests,
  drainGrammarWarnings,
  ensureTreesitter,
  forceGrammarFailureForTests,
  grammarIds,
  grammarReady,
  parserKind,
  setParserInitForTests,
  setSeaProbeForTests,
  setWasmReaderForTests,
} from "../../src/treesitter/runtime.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "package.json"));

afterEach(() => {
  clearGrammarFailureForTests();
});

describe("embedded tree-sitter bytes", () => {
  it("loads grammars from wasm bytes without reading tree-sitter.wasm from disk", async () => {
    const runtime = readFileSync(
      require.resolve("web-tree-sitter/tree-sitter.wasm"),
    );
    const javascript = readFileSync(
      require.resolve("tree-sitter-javascript/tree-sitter-javascript.wasm"),
    );
    setWasmReaderForTests((name) => {
      if (name === "tree-sitter.wasm") return runtime;
      if (name === "tree-sitter-javascript.wasm") return javascript;
      return undefined;
    });
    await ensureTreesitter();
    expect(parserKind("javascript")).toBe("tree-sitter");
    expect(grammarReady("typescript")).toBe(true);
    expect(drainGrammarWarnings()).toEqual([]);
  });

  it("uses SEA asset bytes ahead of the npm package", async () => {
    setSeaProbeForTests(() => ({
      isSea: () => true,
      getAsset: (name) => {
        if (name === "tree-sitter-javascript.wasm") return new Uint8Array([9]);
        if (name === "tree-sitter-python.wasm") {
          return new Uint8Array([1, 2, 3]).buffer;
        }
        return undefined;
      },
    }));
    await ensureTreesitter();
    expect(grammarReady("javascript")).toBe(false);
    expect(grammarReady("python")).toBe(false);
    expect(grammarReady("typescript")).toBe(true);
    const warnings = drainGrammarWarnings().join(" ");
    expect(warnings).toMatch(/javascript/);
    expect(warnings).toMatch(/python/);
  });

  it("ignores non-binary assets, a thrown lookup, and a probe that is not a SEA", async () => {
    setSeaProbeForTests(() => ({
      isSea: () => true,
      getAsset: (name) => (name === "tree-sitter.wasm" ? "nope" : undefined),
    }));
    await ensureTreesitter();
    expect(grammarReady("java")).toBe(true);

    setSeaProbeForTests(() => ({
      isSea: () => true,
      getAsset: () => {
        throw new Error("missing asset");
      },
    }));
    await ensureTreesitter();
    expect(grammarReady("go")).toBe(true);

    setSeaProbeForTests(() => ({ isSea: () => false }));
    await ensureTreesitter();
    expect(grammarReady("rust")).toBe(true);
    expect(grammarReady("csharp")).toBe(true);
  });
});

describe("doctor parser lines", () => {
  it("prints tree-sitter for each grammar and regex-fallback when loading is disabled", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "kestrel-doctor-parser-"));
    const config = defaultConfig();
    const loaded = await runDoctor({ cwd, config, env: {} });
    expect(loaded.exitCode).toBe(0);
    for (const id of grammarIds()) {
      expect(loaded.text).toContain(`parser: tree-sitter (${id})`);
    }
    expect(loaded.text).not.toContain("regex-fallback");

    forceGrammarFailureForTests("forced");
    const fallback = await runDoctor({ cwd, config, env: {} });
    expect(fallback.exitCode).toBe(1);
    for (const id of grammarIds()) {
      expect(fallback.text).toContain(`parser: regex-fallback (${id})`);
    }
    expect(fallback.text).not.toContain("parser: tree-sitter");
  });
});

describe("parser init failure", () => {
  it("keeps reviewing with regex fallback when startup throws", async () => {
    setParserInitForTests(() => Promise.reject(new Error("wasm-boom")));
    await ensureTreesitter();
    expect(drainGrammarWarnings().join(" ")).toMatch(
      /runtime failed to initialize \(wasm-boom\)/,
    );
    expect(parserKind("javascript")).toBe("regex-fallback");

    setParserInitForTests(() => Promise.reject("wasm-string"));
    await ensureTreesitter();
    expect(drainGrammarWarnings().join(" ")).toMatch(/wasm-string/);
  });
});
