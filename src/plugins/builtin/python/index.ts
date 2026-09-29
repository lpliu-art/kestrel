import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { builtinRulePath } from "../../../util/package.ts";
import { definePlugin } from "../../api.ts";
import { heuristicContext } from "../typescript/context.ts";

export const pythonPlugin = definePlugin({
  apiVersion: 1,
  id: "python",
  name: "Python",
  version: "0.1.0",
  languages: [
    {
      id: "python",
      extensions: [".py"],
      shebangs: ["python", "python3"],
      commentSyntax: { line: "#" },
    },
  ],
  rulePacks: [{ path: builtinRulePath("python", "core.yml") }],
  context: heuristicContext("python"),
  facts: {
    async detect(repo) {
      const chunks = await Promise.all(
        ["pyproject.toml", "requirements.txt", "Pipfile"].map(async (path) => {
          try {
            return await readFile(join(repo.root, path), "utf8");
          } catch {
            return "";
          }
        }),
      );
      const text = chunks.join("\n").toLowerCase();
      const facts: string[] = [];
      if (text.includes("django")) facts.push("django");
      if (text.includes("fastapi")) facts.push("fastapi");
      if (text.includes("flask")) facts.push("flask");
      return facts;
    },
  },
  fileClasses: {
    test: ["**/test_*.py", "**/*_test.py", "**/tests/**"],
  },
});
