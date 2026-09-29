import { builtinRulePath } from "../../../util/package.ts";
import { definePlugin } from "../../api.ts";

export const corePlugin = definePlugin({
  apiVersion: 1,
  id: "core",
  name: "Kestrel core",
  version: "0.1.0",
  languages: [
    {
      id: "package-json",
      extensions: [],
      filenames: ["package.json"],
    },
  ],
  rulePacks: [{ path: builtinRulePath("core", "core.yml") }],
  fileClasses: {
    exclude: ["**/package-lock.json", "**/yarn.lock", "**/pnpm-lock.yaml"],
  },
});
