# Kestrel 🦅 —— 快思考的代码评审

> **像红隼一样：悬停扫视整个 diff，只对确认的问题俯冲。**
> Kestrel Review（包名 `kestrel-review`，命令 `kestrel`）是一个开源、插件化、多语言的 AI 代码评审工具。判断来自 TypeSafe AI 的 System One 模型 **Jev**：它不生成文本，只对 typed 问题返回校准过的选择、分数和概率。评论文字来自规则模板。

[English](README.en.md) · [调研](docs/01-research.md) · [概念](docs/02-concept.md) · [技术方案](docs/03-technical-design.md) · [架构图](docs/04-architecture.md) · [实施计划](docs/05-implementation-plan.md) · [目录结构](docs/06-repo-layout.md)

> 状态：MVP 0.1.0。Kestrel 是社区项目，**与 TypeSafe AI 无隶属关系**。真实评审需要 `TYPESAFE_API_KEY`。没有密钥时请使用 `--provider mock`（结果不是 AI 判断）。

## 为什么是 Kestrel

大多数 AI 评审让模型“读完代码再写评论”：慢、贵、不稳定、行号会漂。Kestrel 把评审做成 **规则即问题**：

1. 确定性管线读取 git diff，按语言插件切出审查单元并做触发器匹配；
2. 每条规则编译成 Jev 问题（是否命中、反证守卫、严重度、行定位），一个单元一次并行作答；
3. 用概率阈值分档（report / uncertain / drop），评论锚在真实新增行上；
4. 中文和英文评论文字来自模板。可选的 LLM 叙述器不在本版本。

## 快速开始

需要 Node.js ≥ 22 与 Git。

```bash
npm ci
npm run build
node bin/kestrel.mjs review --provider mock
```

没有 API key 时，`--provider mock` 可以离线跑通终端、JSON、SARIF 和 Markdown。真实评审：

```bash
export TYPESAFE_API_KEY=ts-...
npx kestrel-review review --from main
```

示例输出（mock，对一段拼接 SQL 和 `console.log` 的改动）：

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

加上 `--gate` 时，存在 high 且 p ≥ 0.8 的发现会以退出码 1 结束。

## 常用命令

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

退出码：`0` 通过 · `1` 门禁失败 · `2` 用法或配置错误 · `3` Provider / 鉴权错误 · `4` 部分完成且带了 `--strict`。

配置文件是 `.kestrel.yml`，环境变量是 `KESTREL_PROVIDER`、`KESTREL_MODEL`、`KESTREL_PROFILE`、`KESTREL_LANG` 和 `TYPESAFE_API_KEY`。示例见 `examples/.kestrel.yml`。

## 这个版本有什么

- 内置规则：core、TypeScript/JavaScript（含 2 条 React 与 2 条 Vue 正则规则）、Python、Java、Go。
- Provider：`typesafe`（`@typesafe-ai/sdk` 0.6.0，模型 `jev-1.13.0`）、`http`、`mock`、`replay`。测试和 CI 不需要密钥，也不访问网络。
- 输出：终端、JSON、SARIF 2.1.0、Markdown。
- Agent skill：`skills/kestrel/SKILL.md`，以及 Claude Code 命令 `plugins/kestrel/claude-code/commands/review.md`。

GitHub Action、PR 行内评论、`explain`、tree-sitter、SARIF 输入过滤、自然语言 `checks` 和 LLM 叙述器留在后续版本。详见 [实施计划](docs/05-implementation-plan.md)。

## 许可证

Apache-2.0。
