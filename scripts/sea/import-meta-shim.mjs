import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

function scriptFilename() {
  if (typeof __filename === "string" && __filename.length > 0) {
    try {
      const sea = createRequire(__filename)("node:sea");
      if (sea.isSea?.()) return process.execPath;
    } catch {
      // The CJS entry is not a single-executable application.
    }
    return __filename;
  }
  return process.execPath;
}

export const importMetaUrl = pathToFileURL(scriptFilename()).href;
