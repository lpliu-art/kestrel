import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configJsonSchema } from "../config/schema.ts";
import { reportJsonSchema } from "../report/model.ts";
import { ruleJsonSchema } from "../rules/schema.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const files: Record<string, Record<string, unknown>> = {
  "config.schema.json": configJsonSchema(),
  "rule.schema.json": ruleJsonSchema(),
  "report.schema.json": reportJsonSchema(),
};

const dir = join(root, "schemas");
await mkdir(dir, { recursive: true });
for (const [name, schema] of Object.entries(files)) {
  await writeFile(join(dir, name), `${JSON.stringify(schema, null, 2)}\n`);
}
console.log(`wrote ${Object.keys(files).join(", ")}`);
