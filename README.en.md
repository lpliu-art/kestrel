# Kestrel — fast code review

> **Like a kestrel: hover over the diff, strike only at confirmed problems.**
> Kestrel Review (npm package `kestrel-review`, command `kestrel`) is an open-source, plugin-based, multi-language code review tool. Judgments come from TypeSafe AI's System One model **Jev**. Jev does not write prose. It answers typed questions with calibrated choices, scores, and probabilities. Comment text comes from rule templates.

[中文](README.md) · [research](docs/01-research.md) · [concept](docs/02-concept.md) · [technical design](docs/03-technical-design.md) · [architecture](docs/04-architecture.md) · [implementation plan](docs/05-implementation-plan.md) · [layout](docs/06-repo-layout.md)

> Status: MVP 0.1.0. Kestrel is a community project and is **not affiliated with TypeSafe AI**. A real review needs `TYPESAFE_API_KEY`. Without a key, use `--provider mock`. Those results are not AI judgments.

## Why Kestrel

Kestrel treats review as **rules as questions**:

1. A deterministic pipeline reads the git diff, selects files, and matches rule triggers.
2. Each rule becomes Jev questions (hit, counter-evidence guard, severity, line location), asked together for one review unit.
3. Probabilities band the result into report, uncertain, or drop. Comments anchor to real added lines.
4. Chinese and English text comes from templates. An LLM narrator is not in this version.

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
kestrel rules test
kestrel rules lint
```

Exit codes: `0` pass, `1` gate failed, `2` usage or config error, `3` provider or auth error, `4` partial run with `--strict`.

Configuration is `.kestrel.yml`. Environment variables are `KESTREL_PROVIDER`, `KESTREL_MODEL`, `KESTREL_PROFILE`, `KESTREL_LANG`, and `TYPESAFE_API_KEY`. See `examples/.kestrel.yml`.

## In this version

- Builtin rules: core, TypeScript/JavaScript (including two React and two Vue regex rules), Python, Java, and Go.
- Providers: `typesafe` (`@typesafe-ai/sdk` 0.6.0, model `jev-1.13.0`), `http`, `mock`, and `replay`. Tests and CI need no key and no network.
- Outputs: terminal, JSON, SARIF 2.1.0, and Markdown.
- Agent skill: `skills/kestrel/SKILL.md` and the Claude Code command in `plugins/kestrel/claude-code/commands/review.md`.

The GitHub Action, pull-request comments, `explain`, tree-sitter, SARIF input filtering, natural-language `checks`, and the LLM narrator are later milestones. See the [implementation plan](docs/05-implementation-plan.md).

## License

Apache-2.0.
