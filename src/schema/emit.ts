import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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

export async function writeSchemas(rootDir = root): Promise<string[]> {
  const dir = join(rootDir, "schemas");
  await mkdir(dir, { recursive: true });
  const names = Object.keys(files);
  for (const name of names) {
    const schema = files[name];
    if (!schema) continue;
    await writeFile(join(dir, name), `${JSON.stringify(schema, null, 2)}\n`);
  }
  return names;
}

const entry = process.argv[1];
if (entry && resolve(entry) === fileURLToPath(import.meta.url)) {
  const names = await writeSchemas();
  console.log(`wrote ${names.join(", ")}`);
}
