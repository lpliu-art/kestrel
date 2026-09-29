<a id="english"></a>
<div align="center">

# Kestrel 🦅

**Multi-language AI code review with calibrated probabilities: fast, testable, and deterministic enough to gate merges.**
**多语言 AI 代码评审：每条发现都有校准概率，结果可复现，可以直接当合并门禁用。**

[![npm version](https://img.shields.io/npm/v/kestrel-review.svg)](https://www.npmjs.com/package/kestrel-review)
[![npm downloads](https://img.shields.io/npm/dm/kestrel-review.svg)](https://www.npmjs.com/package/kestrel-review)
[![License: Apache-2.0](https://img.shields.io/npm/l/kestrel-review.svg)](https://github.com/lpliu-art/kestrel/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/lpliu-art/kestrel/ci.yml?branch=main&label=CI)](https://github.com/lpliu-art/kestrel/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/kestrel-review.svg)](https://www.npmjs.com/package/kestrel-review)

**English** · [简体中文](#zh-cn)

</div>

> **Like a kestrel: hover over the whole diff, strike only at confirmed problems.**
>
> Kestrel Review (npm package `kestrel-review`, command `kestrel`) is an open-source, plugin-based, multi-language code review tool: a CLI, a GitHub Action, and an Agent Skill. Judgments come from TypeSafe AI's System One model **Jev**. Jev does not write prose. It answers typed questions with calibrated choices, scores, and probabilities. Comment text comes from rule templates.

> **Status:** 0.4.3 (phase P3). Kestrel is a community project and is **not affiliated with TypeSafe AI**. A real review needs `TYPESAFE_API_KEY`. Without a key, use `--provider mock`. Mock results are not AI judgments, and mock calibration numbers are not Jev numbers.

## Contents

[Why Kestrel](#why-kestrel) · [Features](#features) · [Quick start](#quick-start) · [Mock mode](#try-it-without-an-api-key-mock-mode) · [Commands](#commands) · [Supported languages](#supported-languages) · [How Jev works](#how-jev-works) · [Configuration](#configuration) · [Team checks and SARIF filtering](#team-checks-and-static-alerts) · [GitHub Action](#github-action) · [GitLab CI](#gitlab-ci) · [Coding agents](#in-coding-agents) · [Rules and plugins](#writing-rules-and-plugins) · [Evaluation and calibration](#evaluation-and-calibration) · [Single-file binaries](#single-file-binaries) · [Privacy](#privacy-and-security) · [In this version](#in-this-version) · [Docs](#documentation)

## Why Kestrel

Most AI reviewers ask an LLM to read the code and then write comments. That is slow and expensive, results change between runs, line numbers drift, and it is hard to gate a merge on the output. Kestrel treats review as **rules as questions**:

1. A deterministic pipeline reads the git diff, selects files, cuts review units with a per-language plugin, and matches rule triggers.
2. Each rule becomes Jev questions (hit, counter-evidence guard, severity, line location). All questions for one review unit go in one request, and units run in parallel.
3. Probabilities put each result in a band: report, uncertain, or drop. Comments anchor to real added lines.
4. Chinese and English comment text comes from templates. The optional LLM narrator is off by default. It rewrites comment text only. It does not change Jev's judgments, severities, or which findings are reported.

What you get:

- **Calibrated and gateable.** Every finding has a probability, a severity, and the model version. `--gate` fails only on findings at or above the chosen severity with p ≥ 0.8 by default.
- **Explainable.** `kestrel explain <findingId>` prints every question, answer, and probability behind a finding.
- **Low noise.** Guard questions look for counter-evidence (already validated, already parameterized, test code, and so on) and lower the probability before a finding is reported.
- **Testable offline.** `mock` and `replay` providers need no key and no network, so tests and CI run without secrets.

## Features

- 🧩 **Seven builtin plugins, 97 builtin rules:** core (cross-language), TypeScript/JavaScript with React and Vue rule packs, Python, Java, Go, Rust, and C#. Rules are YAML data with their own positive and negative examples.
- 🌳 **tree-sitter syntax analysis** for the enclosing function or class and for `treesitter` triggers, with automatic fallback to heuristics and regex triggers if a grammar fails to load.
- 🧾 **Outputs:** terminal, JSON (with a per-finding `trace`), SARIF 2.1.0 (GitHub Code Scanning), and Markdown.
- 🐙 **GitHub Action and PR review comments** with fingerprint dedupe and a sticky summary comment. **GitLab** merge-request discussions with `kestrel gitlab post`.
- 🧹 **False-positive filtering for external SARIF.** `--sarif-in` reads SARIF from ESLint, Ruff, golangci-lint, Semgrep, and similar tools and keeps only alerts on the diff that Jev judges real and worth fixing.
- 🗣️ **Natural-language team rules.** Write a one-sentence `checks` entry in `.kestrel.yml` and it compiles to a Jev question.
- 🔍 **`explain`, `doctor`, and `view`.** Trace a finding, check your environment and parsers, and write a local static HTML report.
- 🧭 **`--explore`.** Asks an LLM for suspects on deep-review files and keeps only the ones a Jev `x.support` check confirms.
- 📏 **`eval --calibrate`.** Scores a labeled dataset and proposes chill, balanced, and assertive thresholds.
- 📦 **Single-file binaries** for Linux, macOS, and Windows on GitHub Releases. No Node.js install needed.
- 🤖 **Agent Skill** (`skills/kestrel/SKILL.md`) plus Claude Code `review` and `explain` commands.
- 🧪 **Mock mode** runs the full pipeline with no API key and no network. Its output is clearly labeled as not AI.
- 🔒 **Privacy first.** Secrets are redacted before anything is sent, `--preview --show-payload` shows the exact payload without calling a provider, and the Action runs with `--untrusted` by default.

## Quick start

Requirements: **Git**, plus **Node.js 22 or newer** for the npm package. The single-file binaries bundle their own runtime.

### npx (no install)

```bash
npx kestrel-review review --provider mock   # try the pipeline without a key (NOT an AI judgment)
```

### Global install

```bash
npm install -g kestrel-review
kestrel --version
kestrel doctor
```

### Single-file binary from GitHub Releases

Each `v*` release attaches three single-file binaries and `SHA256SUMS`: `kestrel-linux-x64`, `kestrel-macos-<arch>` (0.4.3 ships `kestrel-macos-arm64`), and `kestrel-windows-x64.exe`.

```bash
# Linux x64
curl -fsSLO https://github.com/lpliu-art/kestrel/releases/latest/download/kestrel-linux-x64
curl -fsSLO https://github.com/lpliu-art/kestrel/releases/latest/download/SHA256SUMS
sha256sum -c SHA256SUMS --ignore-missing
chmod +x kestrel-linux-x64 && ./kestrel-linux-x64 --version

# macOS (Apple silicon): download kestrel-macos-arm64, then
shasum -a 256 -c SHA256SUMS --ignore-missing
```

On Windows, download `kestrel-windows-x64.exe` from the [Releases page](https://github.com/lpliu-art/kestrel/releases).

### Real review with Jev

```bash
export TYPESAFE_API_KEY=ts-...
kestrel review                  # uncommitted changes
kestrel review --staged         # staged changes only (pre-commit)
kestrel review --from main      # current branch against main
npx kestrel-review review --from main   # same, without a global install
```

The default comment language is `zh-CN`. Pass `--lang en` or set `output.language: en` in `.kestrel.yml` for English.

### Store a Jev API key

On a first interactive run with no key, Kestrel asks once (input is hidden). Press Enter to skip and continue in mock mode; the skip is remembered in the user config so it does not ask again. Never prompts in CI or non-interactive runs.

```bash
kestrel auth set                 # hidden prompt
kestrel auth set --key ts-...    # or pipe: printf '%s' 'ts-...' | kestrel auth set
kestrel auth status              # shows env | file | none and the last 4 characters only
kestrel auth clear               # remove the stored key
```

The key is stored at `$XDG_CONFIG_HOME/kestrel/credentials` (default `~/.config/kestrel/credentials`) on Linux and macOS, and `%APPDATA%\kestrel\credentials` on Windows, with mode `0600` on POSIX. `TYPESAFE_API_KEY` always wins over the file. `kestrel doctor` reports where the key comes from. Never log the key.

### From source

```bash
git clone https://github.com/lpliu-art/kestrel.git && cd kestrel
npm ci
npm run build
node bin/kestrel.mjs review --provider mock
```

## Try it without an API key (mock mode)

With no API key, `--provider mock` runs the whole pipeline offline and produces terminal, JSON, SARIF, and Markdown output. The mock provider uses deterministic heuristics. It is for tests and demos, and every report says so.

This is real 0.4.3 output for a change that concatenates SQL and calls `console.log`:

```bash
kestrel review --provider mock --lang en
```

```
MOCK — not an AI judgment; for tests and demos only
✔ 1 files changed · 1 reviewable · 0 skipped
✔ 1 review units · 2 requests (0 cached) · 223ms · ~$0.000083 · mock-1
✖ HIGH  src/user.ts:2  [ts.security.sql-string-concat] p=0.85
  SQL is built by concatenating a non-constant value at line 2; this may allow SQL injection.
  Hint: Use a parameterized query, e.g. `db.query('... WHERE id = $1', [id])`.
✖ MEDIUM  src/user.ts:3  [core.debug.leftover] p=0.90
  Line 3 adds debug output that looks unintentional.
  Hint: Remove the debug call or switch to the project logger.
Pull request risk high (0.81). Test changes do not cover this diff. Tests: none.
Deep-review suggested: src/user.ts (risk 0.90)
Verdict: REQUEST_CHANGES — 1 finding(s) with severity ≥ high and p ≥ 0.80
```

With `--gate`, a high finding with p ≥ 0.8 makes the command exit 1.

## Commands

```bash
kestrel review --staged
kestrel review --commit HEAD
kestrel review --from main
kestrel review --format json --out kestrel.json
kestrel review --format sarif --out kestrel.sarif
kestrel review --format markdown --out kestrel.md
kestrel review --preview --show-payload
kestrel review --gate --fail-on high
kestrel review --sarif-in 'reports/*.sarif'
kestrel explain f_2078a579 --report kestrel.json
kestrel explain pr --report kestrel.json
kestrel doctor
kestrel scan src
kestrel review --incremental --from main
kestrel review --llm
kestrel github post --report kestrel.json --pr 1 --sticky --event auto
kestrel gitlab post --report kestrel.json --project group/app --mr 1
kestrel eval eval/internal/dataset.json --provider mock --calibrate
kestrel view --report kestrel.json
kestrel review --explore
kestrel rules test
kestrel rules lint
kestrel rules show team.api.validate-body --config .kestrel.yml
```

More commands:

| Command | What it does |
|---|---|
| `kestrel review [paths...]` | Review a git diff (working copy, `--staged`, `--commit <rev>`, or `--from <rev> [--to <rev>]`) |
| `kestrel scan <paths...>` | Audit whole files as virtual all-added units |
| `kestrel explain <findingId> --report <file>` | Show the questions, answers, and probabilities behind a finding. `explain pr` shows the pull-request risk and test gap |
| `kestrel doctor` | Check Git, Node, tree-sitter parsers, the API key, model reachability, and the cache |
| `kestrel view` | Write a static HTML viewer for session logs and a JSON report (default `.kestrel/view.html`) |
| `kestrel eval <dataset>` | Score a labeled dataset and propose thresholds (`--calibrate`, `--apply`, `--plugin`, `--max-requests`, `--budget-tokens`) |
| `kestrel rules list \| show \| lint \| check \| test \| new` | Inspect, lint, test, and scaffold rules |
| `kestrel plugins list \| info <id>` | List language plugins |
| `kestrel config init \| print \| validate` | Create, print, and validate `.kestrel.yml` |
| `kestrel cache stats \| clear` | Manage the response cache |
| `kestrel auth set \| status \| clear` | Store, inspect (last 4 chars only), or remove the Jev API key |
| `kestrel github post` / `kestrel gitlab post` | Post a JSON report as PR review comments or MR discussions |

Useful `review` flags: `--provider typesafe|http|mock|replay|llm-shim`, `--profile chill|balanced|assertive`, `--lang zh-CN|en`, `--format` (repeatable) with `--out-json`, `--out-sarif`, `--out-md`, `--audience human|agent`, `--min-p`, `--show-uncertain hidden|collapsed|expanded`, `--sarif-include-uncertain`, `--budget-tokens`, `--concurrency`, `--no-cache`, `--record <dir>` / `--replay <dir>` / `--replay-fallback`, `--untrusted`, `--strict`, `--otel <url>`, and `--config <path>`. Run `kestrel review --help` for the full list.

Exit codes:

| Code | Meaning |
|---|---|
| `0` | pass |
| `1` | gate failed |
| `2` | usage or config error |
| `3` | provider or auth error |
| `4` | partial run with `--strict` (also a failed `github post --strict` or `gitlab post --strict`) |

## Supported languages

| Plugin | Files | Parser | Builtin rules | Examples of what it checks |
|---|---|---|---|---|
| core | all reviewed languages, `package.json`, CI workflows | n/a | 12 | hardcoded secrets, leftover debug output, weak hashes, cleartext HTTP, TLS verification off, `eval`, empty catch, new install scripts, unpinned Actions, `pull_request_target` checkout, reviewer-directed text, new TODO without a ticket (off by default) |
| TypeScript / JavaScript | `.ts` `.mts` `.cts` `.tsx` `.js` `.mjs` `.cjs` `.jsx` `.vue` | tree-sitter (typescript, tsx, javascript) | 9 + 8 React + 8 Vue | SQL concatenation, command injection, dynamic code, XSS sinks, floating promises, `async` in `forEach`; React Hook order, effect deps and cleanup, `dangerouslySetInnerHTML`; Vue `v-html`, lost reactivity, `v-if` with `v-for`, prop mutation |
| Python | `.py` | tree-sitter | 12 | SQL formatting, `shell=True`, unsafe deserialization, `yaml.load`, path traversal, mutable default args, blocking calls in `async` |
| Java | `.java`, MyBatis mapper XML | tree-sitter | 12 | SQL concatenation, MyBatis `${}` interpolation, XXE, deserialization, swallowed exceptions, missing try-with-resources, Spring `@Transactional` self-invocation |
| Go | `.go` | tree-sitter | 12 | ignored errors, unclosed HTTP bodies, `defer` in loops, uncalled `cancel`, `rows.Err()` unchecked, HTTP client without timeout, `InsecureSkipVerify` |
| Rust | `.rs` | tree-sitter | 12 | `unwrap`/`expect`/`panic!`, `unsafe` blocks, `transmute`, Mutex held across `.await`, `block_on`, SQL built with `format!` |
| C# | `.cs` | tree-sitter | 12 | `async void`, `.Result`/`.Wait()`, SQL concatenation, `BinaryFormatter`, undisposed resources, `Path.Combine` with user input |

**Total: 97 builtin rules.** List them with `kestrel rules list`. Add languages or rules with your own plugin or rule pack (see [Writing rules and plugins](#writing-rules-and-plugins)).

## How Jev works

**Jev** is TypeSafe AI's "System One" model. It **does not generate text**. It answers typed questions in one parallel pass:

| Jev question type | Used for |
|---|---|
| **Noul** (yes/no probability) | main question "is this rule violated?", counter-evidence guards, dimension risks, prompt-injection check, team checks |
| **Score** (graded, 2–10 levels) | severity, how much a unit needs human attention |
| **Choice** (pick one option) | which added line to anchor the comment to (options are only lines that exist in the diff, plus `none`), template slot values |

How a finding is decided:

```
p_main = answers["r.<rule>"].noul
p_eff  = p_main × Π_g (1 − answers["g.<rule>.<guard>"].noul) ^ w_g
band   = report     if p_eff ≥ τ_report
         uncertain  if p_eff ≥ τ_uncertain
         drop       otherwise
```

| Profile | τ_report | τ_uncertain | Uncertain findings |
|---|---|---|---|
| `chill` | 0.85 | 0.70 | hidden |
| `balanced` (default) | 0.75 | 0.55 | collapsed |
| `assertive` | 0.60 | 0.40 | expanded |

- **Severity**: the Score answer maps to the rule's `severity.map` (for example `[low, medium, high, critical]`).
- **Location**: a Choice question picks the line and can only pick a line that is really in the diff. If Jev is not confident, the comment falls back to the unit level and says the location is uncertain.
- **Wording**: `en` and `zh-CN` text comes from the rule's templates. The optional LLM narrator (`--llm`) can rewrite it, then Jev checks the rewrite (`v.addresses`, `v.unrelated`, `v.contradicts`). On any error Kestrel falls back to the template.
- **Pull-request conclusion**: `pr.risk` and `pr.tests` give a whole-change risk and test-gap score. They do not add findings or change the gate.

The providers are `typesafe` (`@typesafe-ai/sdk` 0.6.0, model `jev-1.13.0`), `http`, `mock`, `replay`, and the opt-in `llm-shim`. `llm-shim` is not the default. Its output is marked DEGRADED and is not a Jev judgment.

See the [technical design](https://github.com/lpliu-art/kestrel/blob/main/docs/03-technical-design.md) (Chinese) for the full question set.

## Configuration

Configuration lives in `.kestrel.yml`. Create one with `kestrel config init`, then check it with `kestrel config validate`. See [`examples/.kestrel.yml`](https://github.com/lpliu-art/kestrel/blob/main/examples/.kestrel.yml) and the JSON Schema at [`schemas/config.schema.json`](https://github.com/lpliu-art/kestrel/blob/main/schemas/config.schema.json).

```yaml
version: 1
jev:
  provider: typesafe          # typesafe | http | mock | replay
  model: jev-1.13.0           # pin a version to enable the response cache
profile: balanced             # chill | balanced | assertive
output:
  language: en                # zh-CN (default) | en
  formats: [terminal]         # terminal | json | sarif | markdown
  showUncertain: collapsed    # hidden | collapsed | expanded
files:
  exclude: ["**/*.gen.ts", "**/migrations/**"]
plugins: []                   # third-party plugins load only when listed here
rulePacks: [".kestrel/rules/**/*.yml"]
rules:
  disable: ["core.todo.new-without-ticket"]
checks:                       # natural-language team rules, see below
  - id: team.api.validate-body
    paths: ["src/api/**"]
    ask: "Request handlers must validate the body before use"
    expect: true
    severity: high
static:
  sarif: []                   # globs of ESLint/Ruff/Semgrep/golangci-lint SARIF
  filterMode: added           # added | diff_context
gate:
  failOn: high                # low | medium | high | critical
  minProbability: 0.8
llm:                          # optional narrator, off unless enabled
  enabled: false
  protocol: openai            # openai | anthropic
  baseURL: https://api.openai.com/v1
  apiKeyEnv: KESTREL_LLM_API_KEY
privacy:
  redactSecrets: true
```

Environment variables: `KESTREL_PROVIDER`, `KESTREL_MODEL`, `KESTREL_PROFILE`, `KESTREL_LANG`, `TYPESAFE_API_KEY`, and `KESTREL_LLM_API_KEY`. The narrator, `--explore`, and `llm-shim` also read `llm.protocol` (`openai` or `anthropic`), `llm.baseURL`, and `llm.model`. OpenTelemetry exports when `--otel` or `OTEL_EXPORTER_OTLP_ENDPOINT` is set, and it does not attach source code.

## Team checks and static alerts

`checks` in `.kestrel.yml` compile to Noul questions. `expect: true` asks "Does `hunk` violate this team rule: …?" and does not invert the probability. `rules show <id>` prints the compiled question. Optional positive and negative examples run under `rules test`.

```yaml
checks:
  - id: team.api.validate-body
    paths: ["src/api/**"]
    ask: "Request handlers must validate the body before use"
    expect: true
    severity: high
    examples:
      positive:
        - code: |
            db.insert(req.body)
      negative:
        - code: |
            const body = schema.parse(req.body)
```

`--sarif-in <glob>` (or `static.sarif`) reads SARIF from ESLint, Ruff, golangci-lint, Semgrep, and similar tools. Each alert on the diff is asked whether it is real and whether a careful reviewer would require a fix. Kestrel keeps it when `real × matters` reaches the report threshold. Counts are in the report's `static` field. `--untrusted` does not run static tools. It only reads SARIF you already have.

## GitHub Action

`action.yml` at the repository root is a composite action. It runs a review, writes the Markdown summary to the job summary, posts PR review comments with a sticky summary, and can upload SARIF to Code Scanning.

```yaml
# .github/workflows/kestrel.yml
name: Kestrel
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
permissions:
  contents: read
  pull-requests: write
  security-events: write
jobs:
  kestrel:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: lpliu-art/kestrel@v0
        with:
          typesafe_api_key: ${{ secrets.TYPESAFE_API_KEY }}
          language: en        # or zh-CN
          fail_on: high       # enables the gate
          sarif: "true"       # upload kestrel.sarif to Code Scanning
```

| Input | Default | Description |
|---|---|---|
| `typesafe_api_key` | (none) | TypeSafe API key. Omit it to skip, unless `allow_mock` is `true` |
| `version` | `latest` | npm version of `kestrel-review`, or `local` to run the checked-out repository |
| `model` | `jev-1.13.0` | Jev model |
| `profile` | `balanced` | `chill`, `balanced`, or `assertive` |
| `language` | `en` | Comment language: `en` or `zh-CN` |
| `fail_on` | `""` | Enable the gate with `low`, `medium`, `high`, or `critical` |
| `post` | `review` | `review`, `summary`, or `none` |
| `sarif` | `"false"` | Upload `kestrel.sarif` to Code Scanning |
| `untrusted` | `"true"` | Do not load third-party code plugins |
| `allow_mock` | `"false"` | Run the mock provider when no API key is available |

Values that a pull request can influence are passed through `env:`. With no `TYPESAFE_API_KEY` and `allow_mock` not `true`, the job warns and skips (exit 0). If `GITHUB_TOKEN` cannot submit `REQUEST_CHANGES`, `github post --event auto` posts `COMMENT` instead. This repository's dogfood workflow uses `version: local` and `allow_mock: true`, so it does not need a published npm package. Full example: [`examples/github-actions/kestrel.yml`](https://github.com/lpliu-art/kestrel/blob/main/examples/github-actions/kestrel.yml).

## GitLab CI

Live merge-request discussions need `GITLAB_TOKEN` (or `CI_JOB_TOKEN`) with API access. This example uses the mock provider so a pipeline can run without a Jev key. Set `TYPESAFE_API_KEY` as a CI/CD variable and drop `--provider mock` for real reviews.

```yaml
kestrel:
  image: node:22
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  variables:
    GIT_DEPTH: "0"
  script:
    - npx -y kestrel-review@0.4.3 review --from "$CI_MERGE_REQUEST_DIFF_BASE_SHA" --provider mock --format json --out kestrel.json --incremental
    - npx -y kestrel-review@0.4.3 gitlab post --report kestrel.json --project "$CI_PROJECT_PATH" --mr "$CI_MERGE_REQUEST_IID"
```

Template: [`examples/gitlab-ci/kestrel.yml`](https://github.com/lpliu-art/kestrel/blob/main/examples/gitlab-ci/kestrel.yml).

## In coding agents

Kestrel does the fast judging and locating. The host agent (Claude Code, Codex, Cursor) writes the explanations and fixes.

```bash
npx skills add lpliu-art/kestrel --skill kestrel         # generic Agent Skill
/plugin marketplace add lpliu-art/kestrel                # Claude Code
/plugin install kestrel@kestrel                          # then /kestrel:review or /kestrel:explain
```

The skill is [`skills/kestrel/SKILL.md`](https://github.com/lpliu-art/kestrel/blob/main/skills/kestrel/SKILL.md). It runs `kestrel review --format json --audience agent` and tells the agent to report only `report`-band findings. Portable, Codex, and Cursor plugin manifests are in [`plugins/kestrel/agent`](https://github.com/lpliu-art/kestrel/tree/main/plugins/kestrel/agent).

## Writing rules and plugins

A rule is YAML data:

| Part | Role |
|---|---|
| Trigger (`regex` / `treesitter` / `always` / `removed`) | decides when to ask |
| Main question (a Noul: in English, one judgment) | decides whether the rule is violated |
| Guard questions | supply counter-evidence to cut false positives |
| Severity (a Score with 2–10 levels) | grades how serious the problem is |
| Templates (`en`, `zh-CN`) | produce the comment text (`{{line}}`, `{{file}}`, `{{symbol}}`, `{{p}}`, `{{severity}}`, `{{snippet}}`, and rule slots) |
| Examples | the rule's own unit tests, run offline by `kestrel rules test` |

```yaml
- id: py.security.shell-true
  title: { en: "subprocess with shell=True", zh-CN: "subprocess 使用 shell=True" }
  category: security
  applies: { languages: [python] }
  trigger: { kind: regex, on: added, pattern: 'subprocess\.\w+\(.*shell\s*=\s*True' }
  question:
    question: "Do the added lines run a shell command built from a non-constant value with shell=True?"
    true:  { what: "A variable or user input is part of the shell command string" }
    false: { what: "The command is a constant string or an argument list" }
  guards:
    - { id: quoted, question: "Is every non-constant part passed through shlex.quote before use?" }
  severity: { levels: ["Constant input", "Internal input", "External input"], map: [low, medium, high], default: high }
  locate: trigger
  message:
    en:    { body: "Line {{line}} runs a concatenated command with shell=True; this may allow command injection." }
    zh-CN: { body: "第 {{line}} 行以 shell=True 执行拼接的命令，可能导致命令注入。" }
  examples:
    positive: [{ code: "subprocess.run('ls ' + path, shell=True)" }]
    negative: [{ code: "subprocess.run(['ls', path])" }]
```

Project rules go in `.kestrel/rules/**/*.yml`. A later rule with the same id overrides a builtin one. Scaffold a rule with `kestrel rules new <id>`, then run `kestrel rules lint` and `kestrel rules test`.

A language plugin is an npm package (`kestrel-plugin-<lang>`) or a local file whose default export is built with `definePlugin` from `kestrel-review/plugin`. It declares languages and rule packs, plus optional context providers and static-tool adapters. A plugin loads only when it is listed under `plugins:` in `.kestrel.yml`. See the [rule authoring guide](https://github.com/lpliu-art/kestrel/blob/main/docs/rule-authoring.md) (Chinese), the [plugin starter](https://github.com/lpliu-art/kestrel/tree/main/examples/plugin-starter), and the JSON Schemas in [`schemas/`](https://github.com/lpliu-art/kestrel/tree/main/schemas).

## Evaluation and calibration

`kestrel eval` scores a labeled dataset: precision, recall, F1, and false-positive rate per rule and per plugin, reliability bins and ECE, proposed chill/balanced/assertive thresholds, and a comparison of the heuristic `p_eff` with logistic fusion.

```bash
kestrel eval eval/internal/dataset.json --provider mock --calibrate                              # offline check (not Jev numbers)
kestrel eval eval/internal/dataset.json --provider typesafe --calibrate --out calibration.json   # live Jev
```

Mock numbers describe the deterministic mock provider, not Jev, and `--apply` refuses a mock run. The repository's `Calibrate` workflow (`workflow_dispatch`) runs the live calibration with the `TYPESAFE_API_KEY` secret and can open a pull request with balanced thresholds. See [Calibrate with a real Jev key](https://github.com/lpliu-art/kestrel/blob/main/docs/07-calibrate.en.md).

## Single-file binaries

`node scripts/sea/build.mjs` writes one file, `dist/sea/kestrel` (`kestrel.exe` on Windows). Grammar wasm, builtin rule YAML, and `package.json` are SEA assets. The binary runs `--version`, `doctor`, `rules`, `review`, and `view` from a directory that contains only that file. The viewer HTML, CSS, and JS are compiled into the program. The npm package still reads wasm and rule YAML from disk. A project's `.kestrel.yml`, `.kestrel/rules/`, and team checks still load from disk and override an embedded rule with the same id.

Releases: pushing a `v*` tag runs [`.github/workflows/release.yml`](https://github.com/lpliu-art/kestrel/blob/main/.github/workflows/release.yml), which publishes `kestrel-review` to npm and attaches the Linux, macOS, and Windows binaries plus `SHA256SUMS` to a GitHub Release. `workflow_dispatch` re-runs a tag.

## Privacy and security

- Kestrel sends only redacted diff hunks and limited context to the configured Jev provider. Private keys, AWS keys, GitHub/Slack/OpenAI tokens, database connection strings, and quoted values assigned to names like `password`, `secret`, `token`, or `api_key` are replaced with `[REDACTED:<kind>]` before sending.
- `--preview --show-payload` shows everything that would be sent, with no network call.
- `--provider mock` and `--provider replay` never call the network.
- A missing `TYPESAFE_API_KEY` fails closed (exit 3) in CI and non-interactive shells.
- `--untrusted` (the Action default) does not load third-party code plugins or run static tools.
- Report vulnerabilities privately. See [SECURITY.md](https://github.com/lpliu-art/kestrel/blob/main/SECURITY.md).

## In this version

- **Builtin rules:** 97 across seven plugins. core, Python, Java, Go, Rust, and C# have 12 each. TypeScript/JavaScript has 9 core rules plus 8 React and 8 Vue rules. Every rule has positive and negative examples.
- **tree-sitter** (`web-tree-sitter` 0.25.10) supplies the enclosing function or class and `treesitter` triggers. If a grammar WASM fails to load, context falls back to the heuristic and triggers fall back to regex. Adjacent small hunks merge only inside the same enclosing function.
- **Providers:** `typesafe` (`@typesafe-ai/sdk` 0.6.0, model `jev-1.13.0`), `http`, `mock`, `replay`, and opt-in `llm-shim`. Tests and CI need no key and no network.
- **Outputs:** terminal, JSON, SARIF 2.1.0, and Markdown. JSON findings include a `trace`, and `explain` prints the questions, answers, and probabilities.
- **`doctor`** checks Git, Node, the API key, model reachability (`GET /v1/models` when a key is set), the cache directory, and the parser for each supported language. A loaded grammar prints `parser: tree-sitter (<language>)`. A failed grammar prints `parser: regex-fallback (<language>)` and the command exits 1.
- **Single binary** with embedded grammars, rule packs, and viewer (see [Single-file binaries](#single-file-binaries)).
- **GitHub Action**, pull-request comments (fingerprint dedupe, sticky summary), GitLab MR discussions, and SARIF filtering.
- **Optional LLM narrator** (since 0.3.0): OpenAI-compatible `/chat/completions` or Anthropic `/v1/messages`, off by default, checked by Jev, template fallback on any error.
- **`eval` / calibration, `view`, `--explore`, OpenTelemetry** (since 0.4.0).
- **Agent Skill:** `skills/kestrel/SKILL.md`, plus Claude Code `review` and `explain` commands.
- **`kestrel auth`:** store a Jev API key in the user credentials file, with a one-time interactive prompt on first run.

Live Jev cassettes need `TYPESAFE_API_KEY`. CI uses mock and replay. See the [CHANGELOG](https://github.com/lpliu-art/kestrel/blob/main/CHANGELOG.md) and the [implementation plan](https://github.com/lpliu-art/kestrel/blob/main/docs/05-implementation-plan.md).

## Documentation

| Document | Language |
|---|---|
| [Project overview (docs README)](https://github.com/lpliu-art/kestrel/blob/main/docs/README.en.md) · [中文](https://github.com/lpliu-art/kestrel/blob/main/docs/README.md) | EN / 中文 |
| [Research](https://github.com/lpliu-art/kestrel/blob/main/docs/01-research.md) | 中文 |
| [Concept](https://github.com/lpliu-art/kestrel/blob/main/docs/02-concept.md) | 中文 |
| [Technical design](https://github.com/lpliu-art/kestrel/blob/main/docs/03-technical-design.md) | 中文 |
| [Architecture diagrams](https://github.com/lpliu-art/kestrel/blob/main/docs/04-architecture.md) | 中文 |
| [Implementation plan](https://github.com/lpliu-art/kestrel/blob/main/docs/05-implementation-plan.md) | 中文 |
| [Repository layout](https://github.com/lpliu-art/kestrel/blob/main/docs/06-repo-layout.md) | 中文 |
| [Calibrate with a real Jev key](https://github.com/lpliu-art/kestrel/blob/main/docs/07-calibrate.en.md) · [中文](https://github.com/lpliu-art/kestrel/blob/main/docs/07-calibrate.md) | EN / 中文 |
| [Rule authoring](https://github.com/lpliu-art/kestrel/blob/main/docs/rule-authoring.md) | 中文 |
| [CHANGELOG](https://github.com/lpliu-art/kestrel/blob/main/CHANGELOG.md) · [CONTRIBUTING](https://github.com/lpliu-art/kestrel/blob/main/CONTRIBUTING.md) · [SECURITY](https://github.com/lpliu-art/kestrel/blob/main/SECURITY.md) | EN |

## Credits and disclaimer

The design borrows ideas from [alibaba/open-code-review](https://github.com/alibaba/open-code-review), [PR-Agent](https://github.com/The-PR-Agent/pr-agent), [reviewdog](https://github.com/reviewdog/reviewdog), [Danger](https://github.com/danger/danger-js), [Semgrep](https://github.com/semgrep/semgrep), [SonarQube](https://github.com/SonarSource/sonarqube), and CodeRabbit's public docs. "Jev" and "TypeSafe" are names of their respective owners. Kestrel is not affiliated with TypeSafe AI.

## License

[Apache-2.0](https://github.com/lpliu-art/kestrel/blob/main/LICENSE).

---

<a id="zh-cn"></a>

## 简体中文

[English](#english) · **简体中文**

> **像红隼一样：悬停扫视整个 diff，只对确认的问题俯冲。**
>
> Kestrel Review（npm 包名 `kestrel-review`，命令 `kestrel`）是一个开源、插件化、多语言的 AI 代码评审工具，形态包括 CLI、GitHub Action 和 Agent Skill。判断来自 TypeSafe AI 的 System One 模型 **Jev**：它不生成文本，只对 typed 问题返回校准过的选择、分数和概率。评论文字来自规则模板。

> **状态：** 0.4.3（P3）。Kestrel 是社区项目，**与 TypeSafe AI 无隶属关系**。真实评审需要 `TYPESAFE_API_KEY`。没有密钥时请使用 `--provider mock`（结果不是 AI 判断）。mock 校准数字不是 Jev 的数字。

### 为什么是 Kestrel

大多数 AI 评审让模型“读完代码再写评论”：慢、贵、不稳定、行号会漂，也很难拿来做合并门禁。Kestrel 把评审做成 **规则即问题**：

1. 确定性管线读取 git diff，按语言插件切出审查单元并做触发器匹配；
2. 每条规则编译成 Jev 问题（是否命中、反证守卫、严重度、行定位），一个单元一次请求，多个单元并行作答；
3. 用概率阈值分档（report / uncertain / drop），评论锚在真实新增行上；
4. 中文和英文评论文字来自模板。可选的 LLM 叙述器默认关闭，只改写评论文字，不改变 Jev 的判断、严重度或哪些发现会被报告。

你能得到：

- **可校准、可门禁**：每条发现都带概率、严重度和模型版本。`--gate` 默认只在严重度达到阈值且 p ≥ 0.8 时失败。
- **可解释**：`kestrel explain <findingId>` 列出一条发现背后的全部问题、答案和概率。
- **低噪声**：守卫问题寻找反证（已校验、已参数化、测试代码等），先压低概率再决定是否报告。
- **可离线测试**：`mock` 和 `replay` 不需要密钥也不联网，测试和 CI 不依赖任何 secret。

### 功能

- 🧩 **7 个内置插件、97 条内置规则**：core（跨语言）、TypeScript/JavaScript（含 React、Vue 规则包）、Python、Java、Go、Rust、C#。规则是 YAML 数据，自带正反例。
- 🌳 **tree-sitter 语法分析**：提供封闭函数/类和 `treesitter` 触发器；语法加载失败时自动退回启发式和正则触发器。
- 🧾 **多种输出**：终端、JSON（每条发现带 `trace`）、SARIF 2.1.0（GitHub Code Scanning）、Markdown。
- 🐙 **GitHub Action 与 PR 评审评论**：指纹去重、粘性汇总评论。**GitLab**：`kestrel gitlab post` 发 MR 讨论。
- 🧹 **外部 SARIF 误报过滤**：`--sarif-in` 读入 ESLint、Ruff、golangci-lint、Semgrep 等工具的 SARIF，只保留落在 diff 上、Jev 判断为真实且值得修的告警。
- 🗣️ **自然语言团队规则**：在 `.kestrel.yml` 的 `checks` 里写一句话，就会编译成 Jev 问题。
- 🔍 **`explain`、`doctor`、`view`**：追溯发现、检查环境与解析器、生成本地静态 HTML 报告。
- 🧭 **`--explore`**：让 LLM 对需要深审的文件提出嫌疑点，只保留通过 Jev `x.support` 校验的。
- 📏 **`eval --calibrate`**：在标注数据集上打分，给出 chill / balanced / assertive 阈值建议。
- 📦 **单文件二进制**：GitHub Releases 提供 Linux、macOS、Windows 版本，无需安装 Node.js。
- 🤖 **Agent Skill**（`skills/kestrel/SKILL.md`）以及 Claude Code 命令 `review` / `explain`。
- 🧪 **mock 模式**：无需 API key、无需联网即可跑通完整管线，输出明确标注“非 AI 判断”。
- 🔒 **隐私优先**：发送前脱敏；`--preview --show-payload` 不调用 Provider 就能看到完整载荷；Action 默认 `--untrusted`。

### 快速开始

需要 **Git**；使用 npm 包还需要 **Node.js ≥ 22**。单文件二进制自带运行时。

**npx（免安装）**

```bash
npx kestrel-review review --provider mock   # 无密钥体验完整管线（不是 AI 判断）
```

**全局安装**

```bash
npm install -g kestrel-review
kestrel --version
kestrel doctor
```

**从 GitHub Releases 下载单文件二进制**

GitHub Release `v*` 附带三个单文件二进制和 `SHA256SUMS`：`kestrel-linux-x64`、`kestrel-macos-<arch>`（0.4.3 提供 `kestrel-macos-arm64`）、`kestrel-windows-x64.exe`。

```bash
# Linux x64
curl -fsSLO https://github.com/lpliu-art/kestrel/releases/latest/download/kestrel-linux-x64
curl -fsSLO https://github.com/lpliu-art/kestrel/releases/latest/download/SHA256SUMS
sha256sum -c SHA256SUMS --ignore-missing
chmod +x kestrel-linux-x64 && ./kestrel-linux-x64 --version

# macOS（Apple 芯片）：下载 kestrel-macos-arm64 后
shasum -a 256 -c SHA256SUMS --ignore-missing
```

Windows 请从 [Releases 页面](https://github.com/lpliu-art/kestrel/releases) 下载 `kestrel-windows-x64.exe`。

**用 Jev 做真实评审**

```bash
export TYPESAFE_API_KEY=ts-...
kestrel review                  # 未提交的改动
kestrel review --staged         # 只看暂存区（pre-commit）
kestrel review --from main      # 当前分支对比 main
npx kestrel-review review --from main   # 不全局安装也可以
```

默认评论语言是 `zh-CN`；需要英文时加 `--lang en` 或在 `.kestrel.yml` 设置 `output.language: en`。

**保存 Jev API 密钥**

首次交互式运行且找不到密钥时，Kestrel 会询问一次（输入隐藏）。直接回车跳过并以 mock 继续；跳过会记入用户配置，之后不再询问。CI 和非交互式运行从不提示。

```bash
kestrel auth set                 # 隐藏输入
kestrel auth set --key ts-...    # 或管道：printf '%s' 'ts-...' | kestrel auth set
kestrel auth status              # 显示来源 env | file | none，只展示末 4 位
kestrel auth clear               # 删除已保存的密钥
```

密钥保存在 Linux/macOS 的 `$XDG_CONFIG_HOME/kestrel/credentials`（默认 `~/.config/kestrel/credentials`），Windows 为 `%APPDATA%\kestrel\credentials`；POSIX 上文件权限为 `0600`。环境变量 `TYPESAFE_API_KEY` 优先于文件。`kestrel doctor` 会报告密钥来源。永远不要把密钥打进日志。

**从源码运行**

```bash
git clone https://github.com/lpliu-art/kestrel.git && cd kestrel
npm ci
npm run build
node bin/kestrel.mjs review --provider mock
```

### 无密钥体验（mock 模式）

没有 API key 时，`--provider mock` 可以离线跑通终端、JSON、SARIF 和 Markdown。mock 使用确定性启发式，只用于测试和演示，每份报告都会注明。

以下是 0.4.3 对一段拼接 SQL 和 `console.log` 的改动的真实输出：

```bash
kestrel review --provider mock --lang zh-CN
```

```
MOCK — 非 AI 判断，仅用于测试/演示
✔ 1 files changed · 1 reviewable · 0 skipped
✔ 1 review units · 2 requests (0 cached) · 206ms · ~$0.000083 · mock-1
✖ HIGH  src/user.ts:2  [ts.security.sql-string-concat] p=0.85
  第 2 行通过拼接非常量值构造 SQL，可能导致 SQL 注入。
  建议：改用参数化查询，例如 `db.query('... WHERE id = $1', [id])`。
✖ MEDIUM  src/user.ts:3  [core.debug.leftover] p=0.90
  第 3 行新增了看起来并非有意保留的调试输出。
  建议：删掉该调试调用，或改用项目统一的日志接口。
PR 风险高（0.81）。测试变更没有覆盖这次改动。相关测试：无。
建议深审 src/user.ts（风险 0.90）
Verdict: REQUEST_CHANGES — 1 finding(s) with severity ≥ high and p ≥ 0.80
```

加上 `--gate` 时，存在 high 且 p ≥ 0.8 的发现会以退出码 1 结束。

### 常用命令

```bash
kestrel review --staged
kestrel review --commit HEAD
kestrel review --from main
kestrel review --format json --out kestrel.json
kestrel review --format sarif --out kestrel.sarif
kestrel review --format markdown --out kestrel.md
kestrel review --preview --show-payload
kestrel review --gate --fail-on high
kestrel review --sarif-in 'reports/*.sarif'
kestrel explain f_2078a579 --report kestrel.json
kestrel explain pr --report kestrel.json
kestrel doctor
kestrel scan src
kestrel review --incremental --from main
kestrel review --llm
kestrel github post --report kestrel.json --pr 1 --sticky --event auto
kestrel gitlab post --report kestrel.json --project group/app --mr 1
kestrel eval eval/internal/dataset.json --provider mock --calibrate
kestrel view --report kestrel.json
kestrel review --explore
kestrel rules test
kestrel rules lint
kestrel rules show team.api.validate-body --config .kestrel.yml
```

更多命令：

| 命令 | 作用 |
|---|---|
| `kestrel review [paths...]` | 评审 git diff（工作区、`--staged`、`--commit <rev>` 或 `--from <rev> [--to <rev>]`） |
| `kestrel scan <paths...>` | 把整个文件当作全部新增来审计 |
| `kestrel explain <findingId> --report <file>` | 显示一条发现背后的问题、答案和概率；`explain pr` 显示 PR 风险和测试缺口 |
| `kestrel doctor` | 检查 Git、Node、tree-sitter 解析器、API key、模型可达性和缓存 |
| `kestrel view` | 为会话日志和 JSON 报告生成静态 HTML 查看器（默认 `.kestrel/view.html`） |
| `kestrel eval <dataset>` | 在标注数据集上打分并给出阈值建议（`--calibrate`、`--apply`、`--plugin`、`--max-requests`、`--budget-tokens`） |
| `kestrel rules list \| show \| lint \| check \| test \| new` | 查看、检查、测试和生成规则 |
| `kestrel plugins list \| info <id>` | 列出语言插件 |
| `kestrel config init \| print \| validate` | 生成、打印和校验 `.kestrel.yml` |
| `kestrel cache stats \| clear` | 管理响应缓存 |
| `kestrel auth set \| status \| clear` | 保存、查看（只显示末 4 位）或清除 Jev API 密钥 |
| `kestrel github post` / `kestrel gitlab post` | 把 JSON 报告发成 PR 评审评论或 MR 讨论 |

`review` 常用参数：`--provider typesafe|http|mock|replay|llm-shim`、`--profile chill|balanced|assertive`、`--lang zh-CN|en`、可重复的 `--format` 配合 `--out-json` / `--out-sarif` / `--out-md`、`--audience human|agent`、`--min-p`、`--show-uncertain hidden|collapsed|expanded`、`--sarif-include-uncertain`、`--budget-tokens`、`--concurrency`、`--no-cache`、`--record <dir>` / `--replay <dir>` / `--replay-fallback`、`--untrusted`、`--strict`、`--otel <url>`、`--config <path>`。完整列表见 `kestrel review --help`。

退出码：

| 退出码 | 含义 |
|---|---|
| `0` | 通过 |
| `1` | 门禁失败 |
| `2` | 用法或配置错误 |
| `3` | Provider / 鉴权错误 |
| `4` | 部分完成且带了 `--strict`（`github post --strict`、`gitlab post --strict` 在 API 失败时也是 4） |

### 支持的语言

| 插件 | 文件 | 解析器 | 内置规则 | 检查示例 |
|---|---|---|---|---|
| core | 所有被评审的语言、`package.json`、CI 工作流 | 无 | 12 | 硬编码密钥、遗留调试输出、弱哈希、明文 HTTP、关闭 TLS 校验、`eval`、空 catch、新增 install 脚本、未固定版本的 Action、`pull_request_target` 检出、针对评审者的话术、无工单的新 TODO（默认关闭） |
| TypeScript / JavaScript | `.ts` `.mts` `.cts` `.tsx` `.js` `.mjs` `.cjs` `.jsx` `.vue` | tree-sitter（typescript、tsx、javascript） | 9 + React 8 + Vue 8 | SQL 拼接、命令注入、动态代码、XSS sink、悬空 Promise、`forEach` 里的 `async`；React Hook 顺序、effect 依赖与清理、`dangerouslySetInnerHTML`；Vue `v-html`、响应性丢失、`v-if` 与 `v-for` 同用、修改 prop |
| Python | `.py` | tree-sitter | 12 | SQL 格式化、`shell=True`、不安全反序列化、`yaml.load`、路径穿越、可变默认参数、`async` 中的阻塞调用 |
| Java | `.java`、MyBatis mapper XML | tree-sitter | 12 | SQL 拼接、MyBatis `${}` 插值、XXE、反序列化、吞异常、未用 try-with-resources、Spring `@Transactional` 自调用 |
| Go | `.go` | tree-sitter | 12 | 忽略错误、HTTP body 未关闭、循环里的 `defer`、未调用 `cancel`、未检查 `rows.Err()`、HTTP 客户端无超时、`InsecureSkipVerify` |
| Rust | `.rs` | tree-sitter | 12 | `unwrap`/`expect`/`panic!`、`unsafe` 块、`transmute`、跨 `.await` 持有 Mutex、`block_on`、用 `format!` 拼 SQL |
| C# | `.cs` | tree-sitter | 12 | `async void`、`.Result`/`.Wait()`、SQL 拼接、`BinaryFormatter`、未释放资源、`Path.Combine` 拼接用户输入 |

**共 97 条内置规则**，可用 `kestrel rules list` 查看。可以通过自己的插件或规则包扩展语言和规则（见[编写规则与插件](#zh-rules)）。

### Jev 如何工作

Jev 是 TypeSafe AI 的 “System One” 模型，**不生成文本**，只在一次并行作答中回答 typed 问题：

| Jev 问题类型 | 用途 |
|---|---|
| **Noul**（是/否概率） | 主问题“是否违反该规则”、反证守卫、维度风险、提示注入检测、团队 checks |
| **Score**（2–10 级分数） | 严重度、单元需要人工细看的程度 |
| **Choice**（单选） | 评论锚定到哪一行新增代码（选项只包含 diff 中真实存在的行，外加 `none`）、模板插槽取值 |

一条发现如何判定：

```
p_main = answers["r.<rule>"].noul
p_eff  = p_main × Π_g (1 − answers["g.<rule>.<guard>"].noul) ^ w_g
band   = report     若 p_eff ≥ τ_report
         uncertain  若 p_eff ≥ τ_uncertain
         drop       其他情况
```

| 画像 | τ_report | τ_uncertain | uncertain 发现 |
|---|---|---|---|
| `chill` | 0.85 | 0.70 | 隐藏 |
| `balanced`（默认） | 0.75 | 0.55 | 折叠 |
| `assertive` | 0.60 | 0.40 | 展开 |

- **严重度**：Score 的答案映射到规则的 `severity.map`（如 `[low, medium, high, critical]`）。
- **定位**：Choice 问题选行，只能选 diff 中真实存在的行；Jev 不确定时降级为单元级评论，并注明“位置不确定”。
- **文字**：`en` 与 `zh-CN` 文字来自规则模板。可选的 LLM 叙述器（`--llm`）可以改写，改写结果再由 Jev 校验（`v.addresses`、`v.unrelated`、`v.contradicts`），出错时退回模板。
- **PR 结论**：`pr.risk` 和 `pr.tests` 给出整个改动的风险和测试缺口分数，不新增发现，也不改变门禁。

Provider：`typesafe`（`@typesafe-ai/sdk` 0.6.0，模型 `jev-1.13.0`）、`http`、`mock`、`replay`，以及需要显式开启的 `llm-shim`。`llm-shim` 不是默认，输出标成 DEGRADED，判断不是 Jev。完整问题集见[技术方案](https://github.com/lpliu-art/kestrel/blob/main/docs/03-technical-design.md)。

### 配置

配置文件是 `.kestrel.yml`。用 `kestrel config init` 生成，用 `kestrel config validate` 校验。示例见 [`examples/.kestrel.yml`](https://github.com/lpliu-art/kestrel/blob/main/examples/.kestrel.yml)，JSON Schema 见 [`schemas/config.schema.json`](https://github.com/lpliu-art/kestrel/blob/main/schemas/config.schema.json)。

```yaml
version: 1
jev:
  provider: typesafe          # typesafe | http | mock | replay
  model: jev-1.13.0           # 固定版本才会启用响应缓存
profile: balanced             # chill | balanced | assertive
output:
  language: zh-CN             # zh-CN（默认）| en
  formats: [terminal]         # terminal | json | sarif | markdown
  showUncertain: collapsed    # hidden | collapsed | expanded
files:
  exclude: ["**/*.gen.ts", "**/migrations/**"]
plugins: []                   # 第三方插件只有列在这里才会加载
rulePacks: [".kestrel/rules/**/*.yml"]
rules:
  disable: ["core.todo.new-without-ticket"]
checks:                       # 自然语言团队规则，见下文
  - id: team.api.validate-body
    paths: ["src/api/**"]
    ask: "Request handlers must validate the body before use"
    expect: true
    severity: high
static:
  sarif: []                   # ESLint/Ruff/Semgrep/golangci-lint SARIF 的 glob
  filterMode: added           # added | diff_context
gate:
  failOn: high                # low | medium | high | critical
  minProbability: 0.8
llm:                          # 可选叙述器，默认关闭
  enabled: false
  protocol: openai            # openai | anthropic
  baseURL: https://api.openai.com/v1
  apiKeyEnv: KESTREL_LLM_API_KEY
privacy:
  redactSecrets: true
```

环境变量：`KESTREL_PROVIDER`、`KESTREL_MODEL`、`KESTREL_PROFILE`、`KESTREL_LANG`、`TYPESAFE_API_KEY` 和 `KESTREL_LLM_API_KEY`。叙述器、`--explore` 和 `llm-shim` 还接受 `llm.protocol`（`openai` 或 `anthropic`）、`llm.baseURL` 和 `llm.model`。OpenTelemetry 在设置 `--otel` 或 `OTEL_EXPORTER_OTLP_ENDPOINT` 时导出，不附带代码。

### 团队检查与静态告警

`.kestrel.yml` 里的 `checks` 会编译成 Noul 问题。`expect: true` 对应问题 “Does `hunk` violate this team rule: …?”，概率不取反。`rules show <id>` 能看到编译后的问题；如果提供了正反例，`rules test` 会跑它们。

```yaml
checks:
  - id: team.api.validate-body
    paths: ["src/api/**"]
    ask: "Request handlers must validate the body before use"
    expect: true
    severity: high
    examples:
      positive:
        - code: |
            db.insert(req.body)
      negative:
        - code: |
            const body = schema.parse(req.body)
```

`--sarif-in <glob>`（或 `static.sarif`）读入 ESLint、Ruff、golangci-lint、Semgrep 等工具的 SARIF。每条落在 diff 上的告警会问“是否真实”和“是否值得在这个 PR 里修”，`real × matters` 达到报告阈值才保留。统计写在报告的 `static` 字段里。`--untrusted` 不会执行静态工具，只读取已经生成的 SARIF。

### GitHub Action

仓库根目录的 `action.yml` 是 composite action：执行评审、把 Markdown 汇总写入 job summary、发 PR 评审评论（含粘性汇总），并可把 SARIF 上传到 Code Scanning。

```yaml
# .github/workflows/kestrel.yml
name: Kestrel
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
permissions:
  contents: read
  pull-requests: write
  security-events: write
jobs:
  kestrel:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: lpliu-art/kestrel@v0
        with:
          typesafe_api_key: ${{ secrets.TYPESAFE_API_KEY }}
          language: zh-CN     # 或 en
          fail_on: high       # 开启门禁
          sarif: "true"       # 上传 kestrel.sarif 到 Code Scanning
```

| 输入 | 默认值 | 说明 |
|---|---|---|
| `typesafe_api_key` | （无） | TypeSafe API key；不填则跳过，除非 `allow_mock` 为 `true` |
| `version` | `latest` | `kestrel-review` 的 npm 版本，或 `local` 表示运行当前检出的仓库 |
| `model` | `jev-1.13.0` | Jev 模型 |
| `profile` | `balanced` | `chill`、`balanced` 或 `assertive` |
| `language` | `en` | 评论语言：`en` 或 `zh-CN` |
| `fail_on` | `""` | 设为 `low`、`medium`、`high` 或 `critical` 时开启门禁 |
| `post` | `review` | `review`、`summary` 或 `none` |
| `sarif` | `"false"` | 上传 `kestrel.sarif` 到 Code Scanning |
| `untrusted` | `"true"` | 不加载第三方代码插件 |
| `allow_mock` | `"false"` | 没有 API key 时使用 mock Provider |

PR 可控的值都从 `env:` 传入。没有 `TYPESAFE_API_KEY` 且 `allow_mock` 不是 `true` 时，job 打出 warning 并跳过（退出码 0）。`GITHUB_TOKEN` 不能提交 `REQUEST_CHANGES` 时，`github post --event auto` 会改发 `COMMENT`。本仓库的 dogfood 工作流用 `version: local` 和 `allow_mock: true`，不依赖已发布的 npm 包。完整示例：[`examples/github-actions/kestrel.yml`](https://github.com/lpliu-art/kestrel/blob/main/examples/github-actions/kestrel.yml)。

### GitLab CI

发布 MR 讨论需要具有 API 权限的 `GITLAB_TOKEN`（或 `CI_JOB_TOKEN`）。下面的示例使用 mock，没有 Jev 密钥也能跑通流水线；真实评审时把 `TYPESAFE_API_KEY` 设为 CI/CD 变量，并去掉 `--provider mock`。

```yaml
kestrel:
  image: node:22
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  variables:
    GIT_DEPTH: "0"
  script:
    - npx -y kestrel-review@0.4.3 review --from "$CI_MERGE_REQUEST_DIFF_BASE_SHA" --provider mock --format json --out kestrel.json --incremental
    - npx -y kestrel-review@0.4.3 gitlab post --report kestrel.json --project "$CI_PROJECT_PATH" --mr "$CI_MERGE_REQUEST_IID"
```

模板：[`examples/gitlab-ci/kestrel.yml`](https://github.com/lpliu-art/kestrel/blob/main/examples/gitlab-ci/kestrel.yml)。

### 在编码 Agent 中使用

Kestrel 负责快速判断与定位，宿主 Agent（Claude Code、Codex、Cursor）负责写解释与修复。

```bash
npx skills add lpliu-art/kestrel --skill kestrel         # 通用 Agent Skill
/plugin marketplace add lpliu-art/kestrel                # Claude Code
/plugin install kestrel@kestrel                          # 然后使用 /kestrel:review 或 /kestrel:explain
```

Skill 文件是 [`skills/kestrel/SKILL.md`](https://github.com/lpliu-art/kestrel/blob/main/skills/kestrel/SKILL.md)：它运行 `kestrel review --format json --audience agent`，并要求 Agent 只报告 `report` 档的发现。通用、Codex 和 Cursor 插件清单在 [`plugins/kestrel/agent`](https://github.com/lpliu-art/kestrel/tree/main/plugins/kestrel/agent)。

<a id="zh-rules"></a>

### 编写规则与插件

规则是 YAML 数据：

| 组成 | 作用 |
|---|---|
| 触发器（`regex` / `treesitter` / `always` / `removed`） | 决定何时提问 |
| 主问题（Noul，英文、单一判断） | 判断是否违规 |
| 守卫问题 | 提供反证以降低误报 |
| 严重度（2–10 级 Score） | 评估问题严重程度 |
| 模板（`en`、`zh-CN`） | 负责输出文字（支持 `{{line}}`、`{{file}}`、`{{symbol}}`、`{{p}}`、`{{severity}}`、`{{snippet}}` 以及规则声明的 slot） |
| examples | 规则自带的单元测试，由 `kestrel rules test` 离线运行 |

规则示例见上方英文部分的 `py.security.shell-true`。项目规则放在 `.kestrel/rules/**/*.yml`，后加载的同 id 规则覆盖内置规则。用 `kestrel rules new <id>` 生成规则骨架，再运行 `kestrel rules lint` 和 `kestrel rules test`。

语言插件是一个 npm 包（`kestrel-plugin-<lang>`）或本地文件，默认导出用 `kestrel-review/plugin` 的 `definePlugin` 定义，声明语言和规则包，以及可选的上下文提供器与静态工具适配器。插件只有显式列在 `.kestrel.yml` 的 `plugins:` 下才会加载。参见[规则编写指南](https://github.com/lpliu-art/kestrel/blob/main/docs/rule-authoring.md)、[插件模板](https://github.com/lpliu-art/kestrel/tree/main/examples/plugin-starter)和 [`schemas/`](https://github.com/lpliu-art/kestrel/tree/main/schemas) 中的 JSON Schema。

### 评测与校准

`kestrel eval` 在标注数据集上打分：按规则和插件统计 precision / recall / F1 / 误报率，给出可靠性分箱与 ECE、chill / balanced / assertive 阈值建议，并比较启发式 `p_eff` 与逻辑回归融合。

```bash
kestrel eval eval/internal/dataset.json --provider mock --calibrate                              # 离线检查（不是 Jev 数字）
kestrel eval eval/internal/dataset.json --provider typesafe --calibrate --out calibration.json   # 真实 Jev
```

mock 数字描述的是确定性 mock Provider，不是 Jev；`--apply` 会拒绝 mock 运行。仓库的 `Calibrate` 工作流（`workflow_dispatch`）使用 `TYPESAFE_API_KEY` secret 做真实校准，并可开 PR 把 balanced 阈值写回内置规则包。详见[用真实 Jev 校准](https://github.com/lpliu-art/kestrel/blob/main/docs/07-calibrate.md)。

<a id="zh-binaries"></a>

### 单文件二进制

`node scripts/sea/build.mjs` 生成只有一个文件的 `dist/sea/kestrel`（Windows 为 `kestrel.exe`）。语法 wasm、内置规则 YAML 和 `package.json` 都打进 SEA 资源。二进制单独放在空目录里就能跑 `--version`、`doctor`、`rules`、`review` 和 `view`。查看器的 HTML/CSS/JS 编进程序，不另读文件。npm 包仍从磁盘读取 wasm 和规则 YAML。项目自己的 `.kestrel.yml`、`.kestrel/rules/` 和团队 checks 仍从磁盘加载，并覆盖同名内置规则。

发布：推送 `v*` tag 会运行 [`.github/workflows/release.yml`](https://github.com/lpliu-art/kestrel/blob/main/.github/workflows/release.yml)，把 `kestrel-review` 发布到 npm，并把 Linux、macOS、Windows 二进制和 `SHA256SUMS` 附到 GitHub Release；也可用 `workflow_dispatch` 重跑同一个 tag。npm 包名以 `package.json` 的 `name` 为准，当前是 `kestrel-review`。

### 隐私与安全

- 只向配置的 Jev Provider 发送脱敏后的 diff hunk 和有限上下文；私钥、AWS key、GitHub/Slack/OpenAI token、数据库连接串，以及赋给 `password`、`secret`、`token`、`api_key` 等变量的字符串，会在发送前替换为 `[REDACTED:<kind>]`。
- `--preview --show-payload` 不联网即可显示将要发送的全部内容。
- `--provider mock` 和 `--provider replay` 从不联网。
- 在 CI 和非交互式 shell 中缺少 `TYPESAFE_API_KEY` 会直接失败（退出码 3）。
- `--untrusted`（Action 默认）不加载第三方代码插件，也不执行静态工具。
- 请私下报告安全漏洞，见 [SECURITY.md](https://github.com/lpliu-art/kestrel/blob/main/SECURITY.md)。

### 这个版本有什么

- **内置规则**：7 个插件共 97 条。core、Python、Java、Go、Rust、C# 各 12 条；TypeScript/JavaScript 有 9 条核心规则，外加 React 8 条、Vue 8 条。每条规则都带正反例。
- **tree-sitter**（`web-tree-sitter` 0.25.10）提供封闭函数/类和 `treesitter` 触发器。语法 WASM 加载失败时自动退回启发式上下文和正则触发器。相邻小 hunk 只在同一个封闭函数内合并。
- **Provider**：`typesafe`（`@typesafe-ai/sdk` 0.6.0，模型 `jev-1.13.0`）、`http`、`mock`、`replay`，以及需显式开启的 `llm-shim`。测试和 CI 不需要密钥，也不访问网络。
- **输出**：终端、JSON、SARIF 2.1.0、Markdown。JSON 报告带有 `trace`，`explain` 用来显示问题、答案和概率。
- **`doctor`** 检查 Git、Node、API key、模型可达性（有 key 时 `GET /v1/models`）、缓存目录，以及每种语言的解析器。语法加载成功时打印 `parser: tree-sitter (<language>)`，失败时打印 `parser: regex-fallback (<language>)` 并以退出码 1 结束。
- **单二进制**，内嵌语法、规则包和查看器（见[单文件二进制](#zh-binaries)）。
- **GitHub Action**、PR 评论（指纹去重、粘性汇总）、GitLab MR 讨论和 SARIF 过滤。
- **可选 LLM 叙述器**（0.3.0 起）：OpenAI 兼容 `/chat/completions` 或 Anthropic `/v1/messages`，默认关闭，经 Jev 校验，出错时退回模板。
- **`eval` / 校准、`view`、`--explore`、OpenTelemetry**（0.4.0 起）。
- **Agent Skill**：`skills/kestrel/SKILL.md`，以及 Claude Code 命令 `review` / `explain`。
- **`kestrel auth`**：把 Jev API 密钥存到用户凭证文件；首次运行可交互询问一次。

真实 Jev cassette 需要 `TYPESAFE_API_KEY`，当前 CI 只用 mock 和 replay。详见 [CHANGELOG](https://github.com/lpliu-art/kestrel/blob/main/CHANGELOG.md) 和[实施计划](https://github.com/lpliu-art/kestrel/blob/main/docs/05-implementation-plan.md)。

### 文档

[项目总览](https://github.com/lpliu-art/kestrel/blob/main/docs/README.md) · [调研](https://github.com/lpliu-art/kestrel/blob/main/docs/01-research.md) · [概念](https://github.com/lpliu-art/kestrel/blob/main/docs/02-concept.md) · [技术方案](https://github.com/lpliu-art/kestrel/blob/main/docs/03-technical-design.md) · [架构图](https://github.com/lpliu-art/kestrel/blob/main/docs/04-architecture.md) · [实施计划](https://github.com/lpliu-art/kestrel/blob/main/docs/05-implementation-plan.md) · [目录结构](https://github.com/lpliu-art/kestrel/blob/main/docs/06-repo-layout.md) · [用真实 Jev 校准](https://github.com/lpliu-art/kestrel/blob/main/docs/07-calibrate.md) · [规则编写](https://github.com/lpliu-art/kestrel/blob/main/docs/rule-authoring.md) · [CHANGELOG](https://github.com/lpliu-art/kestrel/blob/main/CHANGELOG.md) · [贡献指南](https://github.com/lpliu-art/kestrel/blob/main/CONTRIBUTING.md)

### 致谢与声明

设计参考了 [alibaba/open-code-review](https://github.com/alibaba/open-code-review)、[PR-Agent](https://github.com/The-PR-Agent/pr-agent)、[reviewdog](https://github.com/reviewdog/reviewdog)、[Danger](https://github.com/danger/danger-js)、[Semgrep](https://github.com/semgrep/semgrep)、[SonarQube](https://github.com/SonarSource/sonarqube) 以及 CodeRabbit 的公开文档。“Jev” 和 “TypeSafe” 归各自所有者所有，Kestrel 与 TypeSafe AI 无隶属关系。

### 许可证

[Apache-2.0](https://github.com/lpliu-art/kestrel/blob/main/LICENSE)。
