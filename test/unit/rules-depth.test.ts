import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaults.ts";
import { fileFromSource } from "../../src/git/unified-diff.ts";
import { decideRule, mapSeverity } from "../../src/judge/decide.ts";
import { decideVerdict, reviewExitCode } from "../../src/judge/verdict.ts";
import type { Finding } from "../../src/report/model.ts";
import {
  batchQuestions,
  compilePass2,
  compileRuleQuestions,
  defaultLocate,
  needsPass2,
} from "../../src/rules/compile.ts";
import { lintRules } from "../../src/rules/lint.ts";
import {
  applyOverrides,
  loadPackFiles,
  loadRules,
  matchGlob,
  parsePack,
} from "../../src/rules/load.ts";
import type { LoadedRule } from "../../src/rules/schema.ts";
import {
  applies,
  compileRegex,
  lineHits,
  matchTrigger,
} from "../../src/rules/trigger.ts";
import type { ReviewUnit } from "../../src/units/build.ts";
import { buildUnits } from "../../src/units/build.ts";
import { KestrelError } from "../../src/util/errors.ts";

function rule(partial: Partial<LoadedRule> & { id: string }): LoadedRule {
  return {
    title: { en: "Example issue" },
    category: "correctness",
    dimension: "correctness",
    trigger: { kind: "regex", on: "added", pattern: "TODO" },
    question: {
      question: "Do the added lines in `hunk` contain the issue?",
      focus: "Added lines",
      true: { what: "The issue is present" },
      false: { what: "The issue is absent" },
    },
    severity: {
      levels: ["Low impact", "High impact"],
      map: ["low", "high"],
      default: "high",
    },
    message: {
      en: { body: "Line {{line}} has {{name}}.", why: "It matters." },
    },
    examples: {
      positive: [{ code: "TODO now\n" }],
      negative: [{ code: "done\n" }],
    },
    pluginId: "core",
    layer: "builtin",
    pack: "core",
    ...partial,
  };
}

function unit(text: string, extra: Partial<ReviewUnit> = {}): ReviewUnit {
  const file = fileFromSource(
    "src/example.ts",
    text.endsWith("\n") ? text : `${text}\n`,
  );
  const built = buildUnits(file, text.split("\n"), "typescript", "typescript", {
    maxAddedLinesPerUnit: 40,
  });
  const first = built[0];
  if (!first) throw new Error("fixture produced no unit");
  return { ...first, ...extra };
}

describe("rule lint and packs", () => {
  it("reports structural problems and accepts a checks question in Chinese", () => {
    const broken = rule({
      id: "local.correctness.broken",
      trigger: { kind: "regex", flags: "g" },
      question: {
        question: "这不是英文问题",
        true: { what: "yes" },
      },
      severity: {
        levels: ["Low", "High", "Critical"],
        map: ["low", "high"],
        default: "high",
      },
      examples: { positive: [], negative: [] },
      mock: { positive: "(", negative: "ok", guardPositive: "[" },
      message: { en: { body: "Uses {{missing}}." } },
    });
    const twin = rule({ id: "local.correctness.broken" });
    const treesitter = rule({
      id: "local.correctness.tree",
      trigger: { kind: "treesitter" },
    });
    const checks = rule({
      id: "team.api.validate-body",
      pluginId: "checks",
      question: {
        question: "是否违反团队规则？",
        true: { what: "yes" },
        false: { what: "no" },
      },
      message: { en: { body: "Line {{line}} violates the team rule." } },
    });
    const messages = lintRules([broken, twin, treesitter, checks]).map(
      (issue) => issue.message,
    );
    expect(messages).toEqual(
      expect.arrayContaining([
        "duplicate rule id",
        "regex trigger is missing a pattern",
        "question needs both true and false criteria",
        "question must be English (ASCII)",
        "severity.levels and severity.map must have the same length",
        "examples need at least one positive and one negative",
        "mock regex does not compile: (",
        "unknown template variable {{missing}}",
        "treesitter trigger is missing a query",
      ]),
    );
    expect(lintRules([checks])).toEqual([]);
    expect(compileRegex("(", "g")).toBeUndefined();
  });

  it("rejects a bad pack and applies disable, enable, and overrides", async () => {
    expect(() =>
      parsePack(":\n  - [", "pack.yml", "project", "project"),
    ).toThrow(KestrelError);
    expect(() =>
      parsePack("pack: x\nversion: 1\nrules: []\n", "pack.yml", "p", "project"),
    ).toThrow(/Invalid rule pack/);
    const style = rule({
      id: "local.style.names",
      category: "style",
      deprecated: true,
    });
    const kept = rule({ id: "local.correctness.kept" });
    const config = defaultConfig();
    config.rules.disable = ["local.correctness.kept"];
    config.rules.enable = ["local.correctness.kept"];
    config.rules.overrides["local.correctness.kept"] = {
      thresholds: { report: 0.9 },
      severity: { min: "medium", max: "high", default: "medium" },
    };
    const applied = applyOverrides(
      [
        style,
        kept,
        parsePack(
          `pack: local
version: "1"
rules:
  - id: local.test.gap
    title: { en: "Missing test" }
    category: test
    trigger: { kind: always }
    question:
      question: "Is a test missing?"
      true: { what: "yes" }
      false: { what: "no" }
    severity:
      levels: ["Low impact", "High impact"]
      map: [low, high]
      default: low
    message:
      en: { body: "Line {{line}} needs a test." }
    examples:
      positive:
        - code: |
            change
      negative:
        - code: |
            tested
`,
          "local.yml",
          "project",
          "project",
        )[0] as LoadedRule,
      ],
      config,
    );
    const gap = applied.find((item) => item.id === "local.test.gap");
    expect(gap?.dimension).toBe("test_gap");
    expect(applied.some((item) => item.deprecated)).toBe(false);
    const overridden = applied.find(
      (item) => item.id === "local.correctness.kept",
    );
    expect(overridden?.thresholds?.report).toBe(0.9);
    expect(overridden?.thresholds?.uncertain).toBe(0.55);
    expect(overridden?.severity.default).toBe("medium");

    const cwd = await mkdtemp(join(tmpdir(), "kestrel-packs-"));
    await writeFile(
      join(cwd, "extra.yml"),
      `pack: extra
version: "1"
rules:
  - id: local.security.extra
    title: { en: "Extra" }
    category: security
    trigger: { kind: always }
    question:
      question: "Is it extra?"
      true: { what: "yes" }
      false: { what: "no" }
    severity:
      levels: ["Low impact", "High impact"]
      map: [low, high]
      default: high
    message:
      en: { body: "Line {{line}} is extra." }
    examples:
      positive:
        - code: |
            bad
      negative:
        - code: |
            good
`,
    );
    const loaded = await loadRules(
      [],
      { ...defaultConfig(), rulePacks: ["extra.yml"] },
      cwd,
    );
    expect(loaded.map((item) => item.id)).toContain("local.security.extra");
    expect(await matchGlob("nope/**", join(cwd, "missing"))).toEqual([]);
    expect(await loadPackFiles(["extra.yml"], cwd)).toHaveLength(1);
  });
});

describe("triggers", () => {
  it("respects language, path, framework, size, and ignore comments", () => {
    const sample = unit("const value = 1;\nTODO now\n");
    expect(
      applies(
        rule({ id: "a.b.c", applies: { languages: ["python"] } }),
        sample,
      ),
    ).toBe(false);
    expect(
      applies(rule({ id: "a.b.c", applies: { paths: ["lib/**"] } }), sample),
    ).toBe(false);
    expect(
      applies(
        rule({ id: "a.b.c", applies: { frameworks: ["react"] } }),
        sample,
      ),
    ).toBe(false);
    expect(
      applies(rule({ id: "a.b.c", applies: { minAddedLines: 9 } }), sample),
    ).toBe(false);
    const ignored = unit("const value = 1; // kestrel-ignore\nTODO now\n");
    expect(
      matchTrigger(rule({ id: "local.correctness.todo" }), ignored).matched,
    ).toBe(false);
    const other = unit(
      "const value = 1; // kestrel-ignore other.rule.id\nTODO now\n",
    );
    expect(
      matchTrigger(rule({ id: "local.correctness.todo" }), other).matched,
    ).toBe(true);
    expect(
      matchTrigger(rule({ id: "a.b.c", deprecated: true }), sample).matched,
    ).toBe(false);
    expect(
      lineHits(rule({ id: "a.b.c", trigger: { kind: "always" } }), "TODO"),
    ).toBe(false);
  });

  it("falls back from an unavailable grammar and matches across lines", () => {
    const sample = unit("const name = 'a' +\n  'b';\n");
    const treesitter = rule({
      id: "local.correctness.concat",
      applies: { languages: ["cobol"] },
      trigger: {
        kind: "treesitter",
        query: "(string) @hit",
        pattern: "'a' \\+\\s*'b'",
        flags: "s",
      },
    });
    const hit = matchTrigger(treesitter, { ...sample, languageId: "cobol" });
    expect(hit.matched).toBe(true);
    expect(hit.anchors[0]?.groups.length).toBeGreaterThanOrEqual(0);
    const removed = rule({
      id: "local.correctness.removed",
      trigger: { kind: "removed" },
    });
    expect(matchTrigger(removed, sample).matched).toBe(false);
    const withDelete = unit("kept\n");
    withDelete.lines.push({ kind: "deleted", text: "old", oldNo: 1 });
    expect(matchTrigger(removed, withDelete).matched).toBe(true);
    const always = rule({
      id: "local.correctness.always",
      trigger: { kind: "always" },
    });
    const suppressed = unit(
      "code // kestrel-ignore local.correctness.always\n",
    );
    expect(matchTrigger(always, suppressed).suppressed).toBe(true);
  });
});

describe("question compiler and decisions", () => {
  it("compiles guards, slots, and a batch that must split", () => {
    const sample = rule({
      id: "local.correctness.slots",
      guards: [{ id: "test", question: "Is this only a test?", weight: 1 }],
      slots: {
        name: { from: "regex:1" },
        captured: { from: "capture:hit" },
        chosen: { from: "choose" },
      },
      question: {
        question: "Is the issue present?",
        true: { what: "yes" },
        false: { what: "no" },
      },
    });
    const questions = compileRuleQuestions(sample);
    expect(questions["g.local.correctness.slots.test"]?.type).toBe("noul");
    const pass2 = compilePass2(
      sample,
      [2, 3],
      [
        {
          line: 2,
          text: "TODO(name)",
          groups: ["name"],
          captures: { hit: "name" },
        },
      ],
    );
    expect(pass2["slot.local.correctness.slots.chosen"]?.type).toBe("choice");
    expect(defaultLocate(sample)).toBe("trigger");
    expect(defaultLocate({ ...sample, locate: "unit" })).toBe("unit");
    expect(
      defaultLocate({
        ...sample,
        trigger: { kind: "always" },
        locate: undefined,
      }),
    ).toBe("choose");
    expect(needsPass2(sample, [])).toBe(true);
    expect(needsPass2(sample, [{ line: 1, text: "x", groups: [] }])).toBe(
      false,
    );
    expect(needsPass2({ ...sample, locate: "unit" }, [])).toBe(false);
    const huge = "x".repeat(20_000);
    const batches = batchQuestions(
      huge,
      {
        shared: { type: "noul", instructions: "shared?" },
        one: { type: "noul", instructions: huge },
        two: { type: "noul", instructions: huge },
      },
      ["shared"],
      { total: 8_000, single: 30_000 },
    );
    expect(batches.length).toBeGreaterThan(1);
  });

  it("drops a low score, locates a chosen line, and fills slots", () => {
    const sample = rule({
      id: "local.correctness.slots",
      locate: "choose",
      slots: {
        name: { from: "regex:1" },
        captured: { from: "capture:hit" },
        chosen: { from: "choose" },
      },
      severity: {
        levels: ["Low impact", "High impact"],
        map: ["low", "high"],
        default: "medium",
        min: "low",
        max: "high",
      },
    });
    const review = unit("TODO(name)\n");
    expect(
      decideRule({
        rule: sample,
        unit: review,
        anchors: [],
        answers: { "r.local.correctness.slots": { type: "noul", noul: 0.1 } },
        profile: "balanced",
        language: "en",
        model: "mock-1",
      }),
    ).toBeUndefined();
    expect(mapSeverity(0, 0.1, sample)).toBe("medium");
    const finding = decideRule({
      rule: sample,
      unit: review,
      anchors: [
        {
          line: 1,
          text: "TODO(name)",
          groups: ["name"],
          captures: { hit: "name" },
        },
      ],
      answers: {
        "r.local.correctness.slots": { type: "noul", noul: 0.9 },
        "g.local.correctness.slots.test": { type: "noul", noul: 0.05 },
        "s.local.correctness.slots": {
          type: "score",
          score: 1,
          confidence: 0.2,
          legend: {},
          probabilities: {},
        },
      },
      pass2: {
        "loc.local.correctness.slots": {
          type: "choice",
          choice: "L1",
          confidence: 0.8,
          probabilities: { L1: 0.8 },
        },
        "slot.local.correctness.slots.chosen": {
          type: "choice",
          choice: "other",
          confidence: 0.4,
          probabilities: {},
        },
      },
      profile: "balanced",
      language: "zh-CN",
      model: "mock-1",
    });
    expect(finding?.location.anchor).toBe("choice");
    expect(finding?.message).toContain("name");
    expect(finding?.trace?.questions.length).toBeGreaterThan(0);
    const bare = {
      id: "f1",
      ruleId: "core.meta.reviewer-directed-text",
      severity: "low",
      band: "report",
      pEff: 0.2,
    } as Finding;
    expect(
      decideVerdict([bare], { failOn: "high", minProbability: 0.8 }).decision,
    ).toBe("comment");
    expect(
      reviewExitCode(
        { decision: "approve", blocking: [], reasons: [] },
        "partial",
        { gate: false, strict: true },
      ),
    ).toBe(4);
  });
});
