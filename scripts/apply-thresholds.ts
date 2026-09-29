import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { EvalReport } from "../src/eval/run.ts";
import { applyThresholdsToDir } from "../src/eval/thresholds.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function runApply(argv: string[]): number {
  const reportPath = readArg(argv, "--report");
  const plugin = readArg(argv, "--plugin") ?? "";
  const rulesDir = resolve(
    readArg(argv, "--rules-dir") ?? join(root, "src/plugins/builtin"),
  );
  if (!reportPath) {
    process.stderr.write("Pass --report <calibration.json>.\n");
    return 2;
  }
  const report = JSON.parse(
    readFileSync(resolve(reportPath), "utf8"),
  ) as EvalReport;
  if (!report.realModel) {
    process.stderr.write(
      "Refusing to apply thresholds: this report is not from live Jev. Mock numbers are not written into rule packs.\n",
    );
    return 2;
  }
  const proposal = report.proposals?.balanced;
  if (!proposal || typeof proposal.report !== "number") {
    process.stderr.write("Calibration report has no balanced proposal.\n");
    return 2;
  }
  const changed = applyThresholdsToDir(rulesDir, proposal, plugin || undefined);
  process.stdout.write(
    changed.length === 0
      ? "No threshold changes.\n"
      : `updated ${changed.length} rules\n${changed.join("\n")}\n`,
  );
  return 0;
}

function readArg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  return argv[index + 1];
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  process.exitCode = runApply(process.argv.slice(2));
}
