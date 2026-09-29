import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cachedRoot: string | undefined;

export function packageRoot(): string {
  if (cachedRoot) return cachedRoot;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
          name?: string;
        };
        if (pkg.name === "kestrel-review") {
          cachedRoot = dir;
          return dir;
        }
      } catch {
        // keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate the kestrel-review package root");
}

export function toolVersion(): string {
  const pkg = JSON.parse(
    readFileSync(join(packageRoot(), "package.json"), "utf8"),
  ) as {
    version: string;
  };
  return pkg.version;
}

export function builtinRulePath(plugin: string, file: string): string {
  return join(
    packageRoot(),
    "src",
    "plugins",
    "builtin",
    plugin,
    "rules",
    file,
  );
}
