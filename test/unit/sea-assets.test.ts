import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaults.ts";
import type { KestrelPlugin } from "../../src/plugins/api.ts";
import { loadRules } from "../../src/rules/load.ts";
import { builtinRulePath, toolVersion } from "../../src/util/package.ts";
import {
  clearSeaForTests,
  readSeaText,
  runningInSea,
  setSeaForTests,
} from "../../src/util/sea.ts";

const PACK = `pack: demo
version: 1.0.0
rules:
  - id: demo.security.marker
    title: { en: Marker }
    category: security
    trigger: { kind: always }
    question:
      question: Is the marker present?
    severity:
      levels: ["No", "Yes"]
      map: [low, high]
      default: high
    message:
      en: { body: Embedded marker. }
    examples:
      positive: [{ code: marker }]
      negative: [{ code: clean }]
`;

const PROJECT = `pack: project
version: 1.0.0
rules:
  - id: demo.security.marker
    title: { en: Project marker }
    category: security
    trigger: { kind: always }
    question:
      question: Is the project marker present?
    severity:
      levels: ["No", "Yes"]
      map: [low, high]
      default: low
    message:
      en: { body: Project marker. }
    examples:
      positive: [{ code: marker }]
      negative: [{ code: clean }]
`;

afterEach(() => {
  clearSeaForTests();
});

describe("SEA text assets", () => {
  it("reads nothing outside a single executable", () => {
    expect(runningInSea()).toBe(false);
    expect(readSeaText("package.json")).toBeUndefined();
    expect(builtinRulePath("core", "core.yml")).toContain(
      "src/plugins/builtin/core/rules/core.yml",
    );
    expect(toolVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("decodes string, byte, and buffer assets and ignores a thrown lookup", () => {
    setSeaForTests({
      isSea: () => true,
      getAsset: (key) => {
        if (key === "plain") return "hello";
        if (key === "bytes") return new TextEncoder().encode("bytes");
        if (key === "buffer") {
          const bytes = new TextEncoder().encode("buffer");
          return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          );
        }
        if (key === "bad") return 1 as unknown as string;
        throw new Error("missing");
      },
    });
    expect(runningInSea()).toBe(true);
    expect(readSeaText("plain")).toBe("hello");
    expect(readSeaText("bytes")).toBe("bytes");
    expect(readSeaText("buffer")).toBe("buffer");
    expect(readSeaText("bad")).toBeUndefined();
    expect(readSeaText("missing")).toBeUndefined();
    expect(builtinRulePath("python", "core.yml")).toBe(
      "sea:builtin/python/rules/core.yml",
    );
    setSeaForTests({
      isSea: () => true,
      getAsset: () => undefined,
    });
    expect(toolVersion()).toMatch(/^\d+\.\d+\.\d+/);
    setSeaForTests({
      isSea: () => true,
      getAsset: (key) =>
        key === "package.json" ? '{"version":"9.9.9"}' : undefined,
    });
    expect(toolVersion()).toBe("9.9.9");
    setSeaForTests(() => {
      throw new Error("no sea");
    });
    expect(runningInSea()).toBe(false);
  });
});

describe("embedded builtin rules", () => {
  it("loads an embedded pack and lets a project pack replace it", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "kestrel-sea-rules-"));
    await mkdir(join(cwd, ".kestrel", "rules"), { recursive: true });
    await writeFile(join(cwd, ".kestrel", "rules", "local.yml"), PROJECT);
    setSeaForTests({
      isSea: () => true,
      getAsset: (key) =>
        key === "builtin/demo/rules/core.yml" ? PACK : undefined,
    });
    const plugin: KestrelPlugin = {
      apiVersion: 1,
      id: "demo",
      name: "Demo",
      version: "0.0.0",
      languages: [],
      rulePacks: [{ path: "sea:builtin/demo/rules/core.yml" }],
    };
    const config = defaultConfig();
    config.rulePacks = [];
    const embedded = await loadRules([plugin], config, cwd);
    expect(embedded.map((rule) => rule.id)).toEqual(["demo.security.marker"]);
    expect(embedded[0]?.layer).toBe("builtin");
    expect(embedded[0]?.message.en.body).toBe("Embedded marker.");

    config.rulePacks = [".kestrel/rules/**/*.yml"];
    const layered = await loadRules([plugin], config, cwd);
    expect(layered).toHaveLength(1);
    expect(layered[0]?.layer).toBe("project");
    expect(layered[0]?.message.en.body).toBe("Project marker.");

    setSeaForTests({
      isSea: () => true,
      getAsset: () => {
        throw new Error("missing asset");
      },
    });
    await expect(loadRules([plugin], config, cwd)).rejects.toThrow(
      /Missing embedded rule pack/,
    );
  });
});
