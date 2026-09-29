import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../../src/git/unified-diff.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/diffs");

describe("unified diff", () => {
  it("parses a rename, a binary file, a mode change, and a deletion", () => {
    const files = parseUnifiedDiff(
      readFileSync(join(dir, "mixed.diff"), "utf8"),
    );
    const byPath = new Map(files.map((file) => [file.path, file]));
    expect(byPath.get("new.ts")?.status).toBe("renamed");
    expect(byPath.get("new.ts")?.oldPath).toBe("old.ts");
    expect(byPath.get("new.ts")?.addedLineNumbers).toEqual([1]);
    expect(byPath.get("blob.bin")?.binary).toBe(true);
    expect(byPath.get("script.sh")?.status).toBe("mode");
    expect(byPath.get("gone.ts")?.status).toBe("deleted");
  });

  it("keeps a no-newline marker and strips CR", () => {
    const [file] = parseUnifiedDiff(
      readFileSync(join(dir, "nonewline.diff"), "utf8"),
    );
    const added = file?.hunks[0]?.lines.find((line) => line.kind === "added");
    expect(added?.text).toBe("const cr = 1;");
    expect(added?.noNewline).toBe(true);
  });
});
