import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function moduleRequire(): NodeRequire {
  const url = import.meta.url;
  if (typeof url === "string" && url.length > 0) return createRequire(url);
  return createRequire(process.execPath);
}

let cachedRoot: string | undefined;

export function packageRoot(): string {
  if (cachedRoot) return cachedRoot;
  const packed = seaPayloadRoot();
  if (packed) {
    cachedRoot = packed;
    return packed;
  }
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

function seaPayloadRoot(): string | undefined {
  try {
    const sea = moduleRequire()("node:sea") as { isSea?: () => boolean };
    if (!sea.isSea?.()) return undefined;
  } catch {
    return undefined;
  }
  return join(dirname(process.execPath), "payload");
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
