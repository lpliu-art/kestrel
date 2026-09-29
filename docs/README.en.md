# Kestrel 🦅 — fast-thinking code review

> **Like a kestrel: hover over the whole diff, strike only at confirmed problems.**
> Kestrel is an open-source AI code review tool (CLI + agent skill + GitHub Action) whose judgments come from TypeSafe AI's "System One" model **Jev**. Each changed hunk gets **calibrated probabilities** in a few hundred milliseconds instead of a long essay that may drift.

[中文](README.md) · Design docs (Chinese): [research](01-research.md) · [concept](02-concept.md) · [technical design](03-technical-design.md) · [architecture](04-architecture.md) · [implementation plan](05-implementation-plan.md) · [repo layout](06-repo-layout.md)

> ⚠️ Status: 0.4.0 (P3) is implemented in this repository. 0.4.1 loads tree-sitter inside the single-file binary. These docs remain the design spec. Kestrel is a community project and is **not affiliated with TypeSafe AI**. Real reviews need a TypeSafe API key; access is governed by TypeSafe's own policy. The LLM narrator is off by default and reads `KESTREL_LLM_API_KEY`. To calibrate with a real Jev key, see [07-calibrate.en.md](07-calibrate.en.md).

## Why Kestrel

Most AI reviewers ask an LLM to read the code and write comments. That is slow and costly, results vary between runs, line numbers drift, and it is hard to gate a merge on. Jev works differently: **it does not generate text**. It answers typed questions (yes/no probability, multiple choice, graded score) in one parallel pass. Each pass takes 70–500 ms, and you pay per input token (TypeSafe lists $0.042 per million).

Kestrel therefore treats code review as **Rules-as-Questions**:

1. **Find what to review.** A deterministic pipeline reads the git diff, splits it into review units using per-language plugins, and runs cheap triggers.
2. **Ask Jev.** Each rule becomes typed Jev questions: a main question, counter-evidence guards, and a severity score. Each unit is one request.
3. **Decide and locate.** Probability thresholds put each result into a band: report, uncertain, or drop. A Choice question picks the line, and it can only pick **lines that really exist in the diff**.
4. **Write the comment.** Comment text comes from **deterministic templates** in the rule catalog (en / zh-CN). For richer explanations and fixes there are two options:
   - the host agent (Claude Code / Codex / Cursor), or
   - an optional LLM narrator, whose output Jev checks again before it is shown.

## Features

- ⚡ **Fast and cheap.** A typical PR has about 40 units; the targets are p50 under 3 s and cost under $0.01. These are design estimates and still need measuring.
- 🎯 **Calibrated and gateable.** Every finding carries a probability, a severity and the model version. `--gate` blocks only on findings with severity ≥ high and p ≥ 0.8.
- 🧩 **One plugin per language.** First batch:
  - TypeScript/JavaScript, with React and Vue rule sub-packs
  - Python, Java and Go
  - a shared core pack
  - Rust and C# come later.
  
  Rules are YAML data and ship with their own positive and negative test examples.
- 🧾 **Many outputs.** Terminal, JSON (for agents), SARIF 2.1.0 (GitHub Code Scanning), Markdown, and GitHub PR inline comments with a sticky summary.
- 🤖 **Built for agents.** Install with `npx skills add lpliu-art/kestrel` or use `/kestrel:review` in Claude Code. The agent writes explanations and fixes; Kestrel does the fast judging and locating.
- 🧪 **Testable offline.** Neither CI nor tests need a Jev key:
  - `--provider mock` uses deterministic heuristics and is clearly labelled "not AI".
  - `replay` plays back recorded responses.
- 🔒 **Privacy first.**
  - Only redacted hunk windows and limited context are sent.
  - `--preview --show-payload` shows everything that would be sent, without making any network call.
  - CI runs with `--untrusted` by default.

## Quick start

```bash
# Requires Node.js >= 22 and Git >= 2.30
export TYPESAFE_API_KEY=ts-...           # needed for real reviews
npx kestrel-review review                # review uncommitted changes
npx kestrel-review review --staged       # staged changes only (pre-commit)
npx kestrel-review review --from main    # current branch vs main

# No key yet? Try the pipeline with mock (NOT an AI judgment)
npx kestrel-review review --provider mock

# After a global install the command is `kestrel`
npm i -g kestrel-review && kestrel --help
```

Sample output (mock-up):

```
$ kestrel review --from main --lang en
✔ 12 files changed · 9 reviewable · 3 skipped (lockfile, generated, test)
✔ 41 review units · 2 Jev passes (46 requests, 3 cached) · 1.4s · ~$0.008
✖ HIGH  src/api/user.ts:57  [ts.security.sql-string-concat] p=0.93
  SQL is built by concatenating a non-constant value at line 57; this may allow SQL injection.
  Fix: use a parameterized query, e.g. `db.query('... WHERE id = $1', [id])`.
Verdict: REQUEST_CHANGES (1 blocking: severity≥high & p≥0.80)
```

## Common commands

```bash
kestrel review --from main --format json --out kestrel.json    # structured result
kestrel review --format sarif --out kestrel.sarif               # for Code Scanning
kestrel review --gate --fail-on high                            # merge gate (exit 1 on failure)
kestrel review --preview --show-payload                         # no Jev call; show payload & estimated cost
kestrel rules list --lang python
kestrel rules show ts.security.sql-string-concat                # compiled Jev questions for a rule
kestrel rules test                                              # run all rule examples
kestrel explain <findingId> --report kestrel.json               # every question/answer behind a finding (P1)
kestrel explain pr --report kestrel.json                        # pull-request risk and test gap (P2)
kestrel scan <paths...>                                         # whole-file audit (P2)
kestrel review --llm                                            # optional narrator, off by default (P2)
kestrel review --incremental --from main                        # only commits since the last successful review (P2)
kestrel gitlab post --report kestrel.json --project group/app --mr 1
```

Exit codes:

| Code | Meaning |
|---|---|
| `0` | pass |
| `1` | gate failed |
| `2` | usage or config error |
| `3` | provider error |
| `4` | partial failure (with `--strict`) |

## In coding agents

```bash
npx skills add lpliu-art/kestrel --skill kestrel         # generic skill
/plugin marketplace add lpliu-art/kestrel                # Claude Code
/plugin install kestrel@kestrel                          # then /kestrel:review
```

## GitHub Action (P1)

```yaml
- uses: lpliu-art/kestrel@v0
  with:
    typesafe_api_key: ${{ secrets.TYPESAFE_API_KEY }}
    fail_on: high          # enable the gate
```

## Configuration (`.kestrel.yml`, excerpt)

```yaml
version: 1
jev: { provider: typesafe, model: jev-1.13.0 }   # pin the model to enable caching
profile: balanced                                # chill | balanced | assertive
output: { language: en }
rules:
  disable: ["core.todo.new-without-ticket"]
checks:                                          # team rules in one sentence (P1)
  - id: team.no-console-in-services
    paths: ["src/services/**"]
    ask: "The added service code logs with the shared logger instead of console.*."
    expect: true
    severity: medium
gate: { failOn: high, minProbability: 0.8 }
```

## Writing rules and plugins (summary)

A rule is YAML data with these parts:

| Part | Role |
|---|---|
| Trigger (regex / tree-sitter / always / removed) | decides when to ask |
| Main question (a Noul: in English, one judgment) | decides whether the rule is violated |
| Guard questions | supply counter-evidence to cut false positives |
| Severity (a Score with 2–10 levels) | grades how serious the problem is |
| Templates | produce the comment text |
| Examples | the rule's own unit tests |

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

A language plugin is an npm package (`kestrel-plugin-<lang>`) that exports a `KestrelPlugin`. It declares language definitions and rule packs, plus optional context providers and static-tool adapters. A plugin is loaded only if it is listed explicitly under `plugins:` in `.kestrel.yml`. See [technical design §5](03-technical-design.md).

## Roadmap

1. **MVP (0.1):** CLI, rule packs for 4 languages, mock/replay/typesafe providers, terminal/JSON/Markdown/SARIF output, merge gate, and the skill.
2. **P1:** tree-sitter, GitHub Action and PR comments, filtering of static-tool SARIF, team checks.
3. **P2:** LLM narrator, deeper React/Vue support, Rust/C#, GitLab.
4. **P3 (0.4.0):** evaluation and threshold calibration, guardrail comparison, session viewer, single binary, llm-shim, OpenTelemetry, and `--explore`.

See the [implementation plan](05-implementation-plan.md) for details.

## Credits and disclaimer

The design borrows ideas from:
- [alibaba/open-code-review](https://github.com/alibaba/open-code-review)
- [PR-Agent](https://github.com/The-PR-Agent/pr-agent)
- [reviewdog](https://github.com/reviewdog/reviewdog)
- [Danger](https://github.com/danger/danger-js)
- [Semgrep](https://github.com/semgrep/semgrep)
- [SonarQube](https://github.com/SonarSource/sonarqube)
- CodeRabbit's public docs

See the [research notes](01-research.md) for the full comparison. "Jev" and "TypeSafe" are names of their respective owners, and Kestrel is not affiliated with TypeSafe AI.

License: Apache-2.0.
