import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { builtinRulePath } from "../../../util/package.ts";
import { definePlugin } from "../../api.ts";
import { heuristicContext } from "../typescript/context.ts";

export const rustPlugin = definePlugin({
  apiVersion: 1,
  id: "rust",
  name: "Rust",
  version: "0.3.0",
  languages: [
    {
      id: "rust",
      extensions: [".rs"],
      commentSyntax: { line: "//", block: ["/*", "*/"] },
    },
  ],
  rulePacks: [{ path: builtinRulePath("rust", "core.yml") }],
  context: heuristicContext("rust"),
  facts: {
    async detect(repo) {
      try {
        const text = await readFile(join(repo.root, "Cargo.toml"), "utf8");
        const facts: string[] = [];
        if (text.includes("tokio")) facts.push("tokio");
        return facts;
      } catch {
        return [];
      }
    },
  },
  fileClasses: {
    test: ["**/*_test.rs", "**/tests/**"],
  },
});
