import { builtinRulePath } from "../../../util/package.ts";
import { definePlugin } from "../../api.ts";
import { heuristicContext } from "../typescript/context.ts";

export const csharpPlugin = definePlugin({
  apiVersion: 1,
  id: "csharp",
  name: "C#",
  version: "0.3.0",
  languages: [
    {
      id: "csharp",
      extensions: [".cs"],
      commentSyntax: { line: "//", block: ["/*", "*/"] },
    },
  ],
  rulePacks: [{ path: builtinRulePath("csharp", "core.yml") }],
  context: heuristicContext("csharp"),
  fileClasses: {
    test: ["**/*Test.cs", "**/*Tests.cs", "**/Tests/**"],
  },
});
