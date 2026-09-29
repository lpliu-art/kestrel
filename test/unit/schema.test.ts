import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configJsonSchema } from "../../src/config/schema.ts";
import { reportJsonSchema } from "../../src/report/model.ts";
import { ruleJsonSchema } from "../../src/rules/schema.ts";
import { packageRoot } from "../../src/util/package.ts";

describe("json schemas", () => {
  it("matches the committed documents", () => {
    const root = packageRoot();
    expect(
      JSON.parse(
        readFileSync(join(root, "schemas/config.schema.json"), "utf8"),
      ),
    ).toEqual(configJsonSchema());
    expect(
      JSON.parse(readFileSync(join(root, "schemas/rule.schema.json"), "utf8")),
    ).toEqual(ruleJsonSchema());
    expect(
      JSON.parse(
        readFileSync(join(root, "schemas/report.schema.json"), "utf8"),
      ),
    ).toEqual(reportJsonSchema());
  });
});
