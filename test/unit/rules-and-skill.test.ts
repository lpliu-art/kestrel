import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/load.ts";
import { loadPlugins } from "../../src/plugins/loader.ts";
import { lintRules } from "../../src/rules/lint.ts";
import { loadRules } from "../../src/rules/load.ts";
import { testRules } from "../../src/rules/test-runner.ts";
import { packageRoot } from "../../src/util/package.ts";

describe("builtin rules", () => {
  it("lints clean and passes every positive and negative example", async () => {
    const cwd = packageRoot();
    const config = loadConfig({
      cwd,
      env: { XDG_CONFIG_HOME: join(cwd, ".xdg-missing") },
    });
    config.rulePacks = [];
    const registry = await loadPlugins(config, cwd, true);
    const rules = await loadRules(registry.plugins, config, cwd);
    expect(rules.length).toBeGreaterThanOrEqual(30);
    expect(lintRules(rules)).toEqual([]);
    const report = await testRules(rules, "en");
    expect(report.failed).toEqual([]);
  }, 30_000);
});

describe("skill packaging", () => {
  it("has frontmatter and the agent command", () => {
    const skill = readFileSync(
      join(packageRoot(), "skills/kestrel/SKILL.md"),
      "utf8",
    );
    expect(skill.startsWith("---\n")).toBe(true);
    expect(skill).toMatch(/^name:\s*kestrel/m);
    expect(skill).toMatch(/^description:/m);
    const command = readFileSync(
      join(packageRoot(), "plugins/kestrel/claude-code/commands/review.md"),
      "utf8",
    );
    expect(command).toContain("kestrel review --format json --audience agent");
  });
});
