import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tagMatchesPackageVersion } from "../../src/release/notes.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

export function verifyTag(tag: string | undefined, version: string): string {
  if (!tag) return "Pass the git tag (vX.Y.Z).";
  if (!tagMatchesPackageVersion(tag, version)) {
    return `Tag ${tag} does not match package.json version ${version}. Expected v${version}.`;
  }
  return "";
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  const version = (
    JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      version: string;
    }
  ).version;
  const message = verifyTag(process.argv[2], version);
  if (message) {
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `tag ${process.argv[2]} matches package.json ${version}\n`,
    );
  }
}
