import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { builtinRulePath } from "../../../util/package.ts";
import { definePlugin } from "../../api.ts";
import { heuristicContext } from "../typescript/context.ts";

export const javaPlugin = definePlugin({
  apiVersion: 1,
  id: "java",
  name: "Java",
  version: "0.1.0",
  languages: [
    {
      id: "java",
      extensions: [".java"],
      commentSyntax: { line: "//", block: ["/*", "*/"] },
    },
    {
      id: "xml",
      extensions: [],
      sniff(head) {
        return /<mapper[\s>]/.test(head);
      },
    },
  ],
  rulePacks: [{ path: builtinRulePath("java", "core.yml") }],
  context: heuristicContext("java"),
  facts: {
    async detect(repo) {
      const chunks = await Promise.all(
        ["pom.xml", "build.gradle", "build.gradle.kts"].map(async (path) => {
          try {
            return await readFile(join(repo.root, path), "utf8");
          } catch {
            return "";
          }
        }),
      );
      return chunks.join("\n").toLowerCase().includes("spring")
        ? ["spring"]
        : [];
    },
  },
  fileClasses: {
    test: ["**/*Test.java", "**/src/test/**"],
    generated: ["**/generated/**"],
  },
});
