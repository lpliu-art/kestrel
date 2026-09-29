# Kestrel — fast code review

> **Like a kestrel: hover over the diff, strike only at confirmed problems.**
> Kestrel Review (npm package `kestrel-review`, command `kestrel`) is an open-source, plugin-based, multi-language code review tool. Judgments come from TypeSafe AI's System One model **Jev**. Jev does not write prose. It answers typed questions with calibrated choices, scores, and probabilities. Comment text comes from rule templates.

[中文](README.md) · [research](docs/01-research.md) · [concept](docs/02-concept.md) · [technical design](docs/03-technical-design.md) · [architecture](docs/04-architecture.md) · [implementation plan](docs/05-implementation-plan.md) · [layout](docs/06-repo-layout.md)

> Status: 0.4.0 (P3). Kestrel is a community project and is **not affiliated with TypeSafe AI**. A real review needs `TYPESAFE_API_KEY`. Without a key, use `--provider mock`. Those results are not AI judgments. Mock calibration numbers are not Jev numbers.

## Why Kestrel

Kestrel treats review as **rules as questions**:

1. A deterministic pipeline reads the git diff, selects files, and matches rule triggers.
2. Each rule becomes Jev questions (hit, counter-evidence guard, severity, line location), asked together for one review unit.
3. Probabilities band the result into report, uncertain, or drop. Comments anchor to real added lines.
4. Chinese and English text comes from templates. The optional LLM narrator is off by default. It rewrites comment text only. It does not change Jev's judgments, severities, or which findings are reported.

## Try it

Node.js 22 or newer, and Git.

```bash
npm ci
npm run build
node bin/kestrel.mjs review --provider mock
```

Mock mode produces terminal, JSON, SARIF, and Markdown output with no API key and no network. For a real review:

```bash
export TYPESAFE_API_KEY=ts-...
npx kestrel-review review --from main
```

Sample mock output for a change that concatenates SQL and calls `console.log`:

```
MOCK — 非 AI 判断，仅用于测试/演示
✔ 1 files changed · 1 reviewable · 0 skipped
✔ 1 review units · 1 requests (0 cached) · 108ms · ~$0.000075 · mock-1
✖ HIGH  src/user.ts:2  [ts.security.sql-string-concat] p=0.85
  第 2 行通过拼接非常量值构造 SQL，可能导致 SQL 注入。
  建议：改用参数化查询，例如 `db.query('... WHERE id = $1', [id])`。
✖ MEDIUM  src/user.ts:3  [core.debug.leftover] p=0.90
  第 3 行新增了看起来并非有意保留的调试输出。
  建议：删掉该调试调用，或改用项目统一的日志接口。
Verdict: REQUEST_CHANGES — 1 finding(s) with severity ≥ high and p ≥ 0.80
```

`--gate` exits 1 when a high finding has p ≥ 0.8.

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

Exit codes: `0` pass, `1` gate failed, `2` usage or config error, `3` provider or auth error, `4` partial run with `--strict` (also a failed `github post --strict` or `gitlab post --strict`).

Configuration is `.kestrel.yml`. Environment variables are `KESTREL_PROVIDER`, `KESTREL_MODEL`, `KESTREL_PROFILE`, `KESTREL_LANG`, `TYPESAFE_API_KEY`, and `KESTREL_LLM_API_KEY`. The narrator, `--explore`, and `llm-shim` also read `llm.protocol` (`openai` or `anthropic`), `llm.baseURL`, and `llm.model`. `llm-shim` is not the default. Its output is marked DEGRADED and is not a Jev judgment. OpenTelemetry exports when `--otel` or `OTEL_EXPORTER_OTLP_ENDPOINT` is set, and it does not attach source code. To calibrate with a real Jev key, see [docs/07-calibrate.en.md](docs/07-calibrate.en.md). See `examples/.kestrel.yml`.

### Team checks and static alerts

`checks` in `.kestrel.yml` compile to Noul questions. `expect: true` asks “Does `hunk` violate this team rule: …?” and does not invert the probability. `rules show <id>` prints the compiled question. Optional positive and negative examples run under `rules test`.

```yaml
checks:
  - id: team.api.validate-body
    paths: ["src/api/**"]
    ask: "Request handlers must validate the body before use"
    expect: true
    severity: high
```

`--sarif-in <glob>` (or `static.sarif`) reads SARIF from ESLint, Ruff, golangci-lint, Semgrep, and similar tools. Each alert on the diff is asked whether it is real and whether a careful reviewer would require a fix. Kestrel keeps it when `real × matters` reaches the report threshold. Counts are on `report.static`. `--untrusted` does not run static tools; it only reads SARIF you already have.

### GitHub Action

`action.yml` at the repository root is a composite action. Values that a pull request can influence are passed through `env:`. With no `TYPESAFE_API_KEY` and `allow_mock` not `true`, the job warns and skips (exit 0). If `GITHUB_TOKEN` cannot submit `REQUEST_CHANGES`, `github post --event auto` posts `COMMENT` instead.

```yaml
# examples/github-actions/kestrel.yml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
- uses: lpliu-art/kestrel@v0
  with:
    typesafe_api_key: ${{ secrets.TYPESAFE_API_KEY }}
    language: zh-CN
    fail_on: high
    sarif: "true"
```

This repository's dogfood workflow uses `version: local` and `allow_mock: true`, so it does not need a published npm package.

## In this version

- Builtin rules: each MVP plugin (core, TypeScript/JavaScript, Python, Java, Go) has at least 12 rules, each with positive and negative examples. The TypeScript plugin also ships React and Vue rules.
- tree-sitter (`web-tree-sitter` 0.25.10) supplies the enclosing function or class and `treesitter` triggers. If a grammar WASM fails to load, context falls back to the heuristic and triggers fall back to regex. Adjacent small hunks merge only inside the same enclosing function.
- Providers: `typesafe` (`@typesafe-ai/sdk` 0.6.0, model `jev-1.13.0`), `http`, `mock`, and `replay`. Tests and CI need no key and no network.
- Outputs: terminal, JSON, SARIF 2.1.0, and Markdown. JSON findings include a `trace`. `explain` prints the questions, answers, and probabilities.
- `doctor` checks Git, Node, the API key, model reachability (`GET /v1/models` when a key is set), and the cache directory.
- GitHub Action, pull-request comments (fingerprint dedupe, sticky summary), and SARIF filtering.
- Agent skill: `skills/kestrel/SKILL.md`, plus Claude Code `review` and `explain` commands.

The LLM narrator is still a later milestone. Live Jev cassettes need `TYPESAFE_API_KEY`; CI uses mock and replay. See the [implementation plan](docs/05-implementation-plan.md).

## License

Apache-2.0.
