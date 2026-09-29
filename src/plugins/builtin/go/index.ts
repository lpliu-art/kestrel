import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { builtinRulePath } from "../../../util/package.ts";
import { definePlugin } from "../../api.ts";
import { heuristicContext } from "../typescript/context.ts";

export const goPlugin = definePlugin({
  apiVersion: 1,
  id: "go",
  name: "Go",
  version: "0.1.0",
  languages: [
    {
      id: "go",
      extensions: [".go"],
      commentSyntax: { line: "//", block: ["/*", "*/"] },
    },
  ],
  rulePacks: [{ path: builtinRulePath("go", "core.yml") }],
  context: heuristicContext("go"),
  facts: {
    async detect(repo) {
      try {
        const text = await readFile(join(repo.root, "go.mod"), "utf8");
        const facts: string[] = [];
        if (text.includes("gin-gonic/gin")) facts.push("gin");
        return facts;
      } catch {
        return [];
      }
    },
  },
  fileClasses: {
    test: ["**/*_test.go"],
    generated: ["**/*.pb.go"],
  },
});
