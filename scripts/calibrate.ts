import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderCalibrationMarkdown } from "../src/eval/markdown.ts";
import { caseCountExceeds, filterDataset } from "../src/eval/plugins.ts";
import type { EvalReport } from "../src/eval/run.ts";
import {
  MISSING_API_KEY_MESSAGE,
  needsApiKey,
  redactSecret,
} from "../src/eval/secrets.ts";
import { applyThresholdsToDir } from "../src/eval/thresholds.ts";
import { isKestrelError } from "../src/util/errors.ts";

interface RawDataset {
  cases?: Array<{ labels: Array<{ ruleId: string }> }>;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function runCalibrate(argv: string[], env: NodeJS.ProcessEnv): number {
  const provider = readArg(argv, "--provider") ?? "mock";
  const dataset = readArg(argv, "--dataset");
  const plugin = readArg(argv, "--plugin") ?? "";
  const maxRaw = readArg(argv, "--max-requests");
  const budget = readArg(argv, "--budget-tokens");
  const outDir = resolve(readArg(argv, "--out-dir") ?? "calibration");
  const rulesDir = resolve(
    readArg(argv, "--rules-dir") ?? join(root, "src/plugins/builtin"),
  );
  const apply = argv.includes("--apply-thresholds");
  if (!dataset) {
    process.stderr.write("Pass --dataset <path>.\n");
    return 2;
  }
  if (needsApiKey(provider) && !env.TYPESAFE_API_KEY) {
    process.stderr.write(`${MISSING_API_KEY_MESSAGE}\n`);
    return 1;
  }
  const maxRequests =
    maxRaw === undefined ? undefined : Number.parseInt(maxRaw, 10);
  if (
    maxRequests !== undefined &&
    (!Number.isFinite(maxRequests) || maxRequests < 0)
  ) {
    process.stderr.write(`Invalid --max-requests ${maxRaw}.\n`);
    return 2;
  }
  const datasetPath = resolve(dataset);
  let filtered: RawDataset;
  try {
    const parsed = JSON.parse(readFileSync(datasetPath, "utf8")) as RawDataset;
    if (plugin) {
      if (!Array.isArray(parsed.cases)) {
        process.stderr.write(
          "Plugin filter needs a dataset with a cases array.\n",
        );
        return 2;
      }
      filtered = filterDataset(parsed as Required<RawDataset>, plugin);
      if (!filtered.cases || filtered.cases.length === 0) {
        process.stderr.write(`No dataset cases match plugin ${plugin}.\n`);
        return 2;
      }
    } else {
      filtered = parsed;
    }
  } catch (error) {
    return fail(error, env.TYPESAFE_API_KEY);
  }
  const cases = Array.isArray(filtered.cases) ? filtered.cases.length : 0;
  if (caseCountExceeds(cases, maxRequests)) {
    process.stderr.write(
      `Refusing to start: ${cases} dataset cases exceed max-requests ${maxRequests}. Each case sends at least one Jev request. Narrow --plugin or raise max-requests.\n`,
    );
    return 2;
  }
  mkdirSync(outDir, { recursive: true });
  const evalDataset = join(outDir, "dataset.json");
  writeFileSync(evalDataset, `${JSON.stringify(filtered, null, 2)}\n`);
  const args = [
    join(root, "bin/kestrel.mjs"),
    "eval",
    evalDataset,
    "--provider",
    provider,
    "--calibrate",
    "--out",
    join(outDir, "calibration.json"),
  ];
  if (plugin) args.push("--plugin", plugin);
  if (maxRequests !== undefined)
    args.push("--max-requests", String(maxRequests));
  if (budget) args.push("--budget-tokens", budget);
  const child = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    encoding: "utf8",
  });
  const secret = env.TYPESAFE_API_KEY;
  if (child.stdout) process.stdout.write(redactSecret(child.stdout, secret));
  if (child.stderr) process.stderr.write(redactSecret(child.stderr, secret));
  if (child.error) {
    process.stderr.write(
      redactSecret(child.error.message, secret).concat("\n"),
    );
  }
  if ((child.status ?? 1) !== 0) return child.status ?? 1;
  const report = JSON.parse(
    readFileSync(join(outDir, "calibration.json"), "utf8"),
  ) as EvalReport;
  writeFileSync(
    join(outDir, "calibration.md"),
    renderCalibrationMarkdown(report),
  );
  if (apply) {
    if (!report.realModel) {
      process.stderr.write(
        "Refusing to apply thresholds: this report is not from live Jev. Mock numbers are not written into rule packs.\n",
      );
      return 2;
    }
    const changed = applyThresholdsToDir(
      rulesDir,
      report.proposals.balanced,
      plugin || undefined,
    );
    writeFileSync(
      join(outDir, "thresholds-applied.txt"),
      `${changed.join("\n")}\n`,
    );
    process.stdout.write(`applied thresholds to ${changed.length} rules\n`);
  }
  process.stdout.write(`wrote ${join(outDir, "calibration.json")}\n`);
  process.stdout.write(`wrote ${join(outDir, "calibration.md")}\n`);
  return 0;
}

function fail(error: unknown, secret: string | undefined): number {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${redactSecret(message, secret)}\n`);
  return isKestrelError(error) ? error.exitCode : 2;
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
  process.exitCode = runCalibrate(process.argv.slice(2), process.env);
}
