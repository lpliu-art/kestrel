import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { builtinRulePath } from "../../../util/package.ts";
import { definePlugin } from "../../api.ts";
import { heuristicContext } from "./context.ts";

async function readText(
  root: string,
  path: string,
): Promise<string | undefined> {
  try {
    return await readFile(join(root, path), "utf8");
  } catch {
    return undefined;
  }
}

export const typescriptPlugin = definePlugin({
  apiVersion: 1,
  id: "typescript",
  name: "TypeScript / JavaScript",
  version: "0.1.0",
  languages: [
    {
      id: "typescript",
      extensions: [".ts", ".mts", ".cts"],
      commentSyntax: { line: "//", block: ["/*", "*/"] },
    },
    {
      id: "tsx",
      extensions: [".tsx"],
      commentSyntax: { line: "//", block: ["/*", "*/"] },
    },
    {
      id: "javascript",
      extensions: [".js", ".mjs", ".cjs", ".jsx"],
      shebangs: ["node", "deno", "bun"],
      commentSyntax: { line: "//", block: ["/*", "*/"] },
    },
    {
      id: "vue",
      extensions: [".vue"],
      commentSyntax: { line: "//", block: ["/*", "*/"] },
    },
  ],
  rulePacks: [
    { path: builtinRulePath("typescript", "core.yml") },
    { path: builtinRulePath("typescript", "react.yml") },
    { path: builtinRulePath("typescript", "vue.yml") },
  ],
  context: heuristicContext("typescript"),
  facts: {
    async detect(repo) {
      const text = await readText(repo.root, "package.json");
      if (!text) return [];
      try {
        const pkg = JSON.parse(text) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
          peerDependencies?: Record<string, string>;
        };
        const deps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };
        const facts: string[] = [];
        if (deps.react) facts.push("react");
        if (deps.vue) facts.push("vue");
        if (deps.next) facts.push("next");
        if (deps.express) facts.push("express");
        return facts;
      } catch {
        return [];
      }
    },
  },
  fileClasses: {
    test: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.test.js",
      "**/*.spec.js",
      "**/__tests__/**",
    ],
    generated: ["**/*.gen.ts", "**/*.generated.ts", "**/*.d.ts"],
  },
});
