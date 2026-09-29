import { describe, expect, it } from "vitest";
import { BudgetGuard } from "../../src/jev/budget.ts";
import { createMockProvider } from "../../src/jev/mock.ts";
import { judgeUnit } from "../../src/pipeline/judge-unit.ts";
import { buildReviewState } from "../../src/pipeline/state.ts";
import type { ReviewUnit } from "../../src/units/build.ts";

describe("mock throughput", () => {
  it("finishes 100 units in under 2 seconds", async () => {
    const provider = createMockProvider([]);
    const units: ReviewUnit[] = Array.from({ length: 100 }, (_, index) => ({
      id: `src/file.ts:${index}-${index}#0`,
      path: "src/file.ts",
      languageId: "typescript",
      pluginId: "typescript",
      startLine: index + 1,
      endLine: index + 1,
      addedLineNumbers: [index + 1],
      lines: [{ kind: "added", text: "const value = 1;", newNo: index + 1 }],
      header: "@@ -1 +1 @@",
      sourceLines: ["const value = 1;"],
      frameworks: [],
      testsChanged: [],
    }));
    const started = performance.now();
    for (const unit of units) {
      await judgeUnit({
        unit,
        rules: [],
        state: buildReviewState({ unit, rules: [], redact: false }),
        provider,
        budget: new BudgetGuard(2_000_000),
        model: "jev-1.13.0",
        profile: "balanced",
        language: "en",
        strategy: "two-pass",
        maxRules: 40,
        warnings: [],
      });
    }
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
