import { definePlugin } from "kestrel-review/plugin";

export default definePlugin({
  apiVersion: 1,
  id: "starter",
  name: "Starter",
  version: "0.1.0",
  languages: [
    {
      id: "typescript",
      extensions: [".ts"],
      override: true,
    },
  ],
  rulePacks: [
    { path: new URL("./rules/starter.yml", import.meta.url).pathname },
  ],
});
