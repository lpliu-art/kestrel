import type { ResolvedConfig } from "./schema.ts";

export const DEFAULT_EXCLUDES = [
  "**/*.gen.ts",
  "**/*.generated.*",
  "**/*_generated.*",
  "**/*.min.js",
  "**/*.min.css",
  "**/*.bundle.js",
  "**/migrations/**",
];

export const DEFAULT_PATH_GLOBS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/vendor/**",
  "**/target/**",
  "**/coverage/**",
  "**/*.min.js",
  "**/*.min.css",
  "**/*.bundle.js",
  "**/*.generated.*",
  "**/*_generated.*",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/go.sum",
  "**/Cargo.lock",
  "**/poetry.lock",
  "**/composer.lock",
  "**/*.snap",
  "**/.kestrel/**",
];

export const DEFAULT_TEST_GLOBS = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.test.js",
  "**/*.test.jsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/*.spec.js",
  "**/*.spec.jsx",
  "**/*_test.go",
  "**/test_*.py",
  "**/*_test.py",
  "**/*Test.java",
  "**/tests/**",
  "**/__tests__/**",
  "**/testdata/**",
];

export const SECRET_PATH_GLOBS = [
  "**/.ssh/**",
  "**/id_rsa",
  "**/id_rsa*",
  "**/.npmrc",
  "**/.pypirc",
  "**/.netrc",
  "**/.aws/credentials",
  "**/.git-credentials",
];

export function defaultConfig(): ResolvedConfig {
  return {
    version: 1,
    jev: {
      provider: "typesafe",
      model: "jev-1.13.0",
      timeoutMs: 10_000,
      concurrency: 8,
      rateLimit: { requestsPerMinute: 1000, tokensPerSecond: 200_000 },
      strategy: "two-pass",
      price: { inputPerMTok: 0.042 },
      budget: { maxInputTokens: 2_000_000 },
      cache: { enabled: true, dir: ".kestrel/cache", ttlDays: 30 },
    },
    profile: "balanced",
    output: {
      language: "zh-CN",
      formats: ["terminal"],
      showUncertain: "collapsed",
    },
    files: {
      include: [],
      exclude: [...DEFAULT_EXCLUDES],
      reviewTests: false,
    },
    limits: {
      maxAddedLinesPerFile: 1500,
      maxAddedLinesPerUnit: 120,
      maxRulesPerUnit: 40,
    },
    plugins: [],
    rulePacks: [".kestrel/rules/**/*.yml"],
    rules: { disable: [], enable: [], overrides: {} },
    checks: [],
    static: { sarif: [], filterMode: "added" },
    gate: { failOn: "high", minProbability: 0.8 },
    privacy: {
      redactSecrets: true,
      maxEnclosingLines: 120,
      sendImports: "auto",
    },
    languages: { overrides: [] },
    warnings: [],
  };
}

export const CONFIG_TEMPLATE = `# Kestrel Review configuration
# https://github.com/lpliu-art/kestrel
version: 1

jev:
  provider: typesafe          # typesafe | http | mock | replay
  model: jev-1.13.0           # pin a version to enable the response cache
  timeoutMs: 10000
  concurrency: 8
  strategy: two-pass          # two-pass | single-pass
  price: { inputPerMTok: 0.042 }
  budget: { maxInputTokens: 2000000 }
  cache: { enabled: true, dir: .kestrel/cache, ttlDays: 30 }

profile: balanced             # chill | balanced | assertive

output:
  language: zh-CN             # zh-CN | en
  formats: [terminal]         # terminal | json | sarif | markdown
  showUncertain: collapsed    # hidden | collapsed | expanded

files:
  include: []
  exclude: ["**/*.gen.ts", "**/migrations/**"]
  reviewTests: false

limits:
  maxAddedLinesPerFile: 1500
  maxAddedLinesPerUnit: 120
  maxRulesPerUnit: 40

plugins: []
rulePacks: [".kestrel/rules/**/*.yml"]

rules:
  disable: ["core.todo.new-without-ticket"]
  enable: []
  overrides: {}

checks: []                    # compiled to Noul questions; see README
# - id: team.api.validate-body
#   paths: ["src/api/**"]
#   ask: "Request handlers must validate the body before use"
#   expect: true
#   severity: high

static:
  sarif: []                   # globs of ESLint/Ruff/Semgrep/golangci-lint SARIF
  filterMode: added           # added | diff_context

gate:
  failOn: high                # low | medium | high | critical
  minProbability: 0.8

privacy:
  redactSecrets: true
  maxEnclosingLines: 120
  sendImports: auto           # auto | never
`;
