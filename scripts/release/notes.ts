import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { changelogSection } from "../../src/release/notes.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  const version = process.argv[2];
  if (!version) {
    process.stderr.write("Pass the package version (X.Y.Z).\n");
    process.exitCode = 1;
  } else {
    try {
      const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
      process.stdout.write(changelogSection(changelog, version));
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    }
  }
}
