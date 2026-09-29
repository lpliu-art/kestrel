# Kestrel 🦅 —— 快思考的代码评审

> **像红隼一样：悬停扫视整个 diff，只对确认的问题俯冲。**
> Kestrel Review（包名 `kestrel-review`，命令 `kestrel`）是一个开源、插件化、多语言的 AI 代码评审工具。判断来自 TypeSafe AI 的 System One 模型 **Jev**：它不生成文本，只对 typed 问题返回校准过的选择、分数和概率。评论文字来自规则模板。

[English](README.en.md) · [调研](docs/01-research.md) · [概念](docs/02-concept.md) · [技术方案](docs/03-technical-design.md) · [架构图](docs/04-architecture.md) · [实施计划](docs/05-implementation-plan.md) · [目录结构](docs/06-repo-layout.md)

> 状态：0.4.2（P3）。Kestrel 是社区项目，**与 TypeSafe AI 无隶属关系**。真实评审需要 `TYPESAFE_API_KEY`。没有密钥时请使用 `--provider mock`（结果不是 AI 判断）。mock 校准数字不是 Jev 的数字。

## 为什么是 Kestrel

大多数 AI 评审让模型“读完代码再写评论”：慢、贵、不稳定、行号会漂。Kestrel 把评审做成 **规则即问题**：

1. 确定性管线读取 git diff，按语言插件切出审查单元并做触发器匹配；
2. 每条规则编译成 Jev 问题（是否命中、反证守卫、严重度、行定位），一个单元一次并行作答；
3. 用概率阈值分档（report / uncertain / drop），评论锚在真实新增行上；
4. 中文和英文评论文字来自模板。可选的 LLM 叙述器默认关闭，只改写评论文字，不改变 Jev 的判断、严重度或哪些发现会被报告。

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

退出码：`0` 通过 · `1` 门禁失败 · `2` 用法或配置错误 · `3` Provider / 鉴权错误 · `4` 部分完成且带了 `--strict`（`github post` 在 API 失败且带 `--strict` 时也是 4）。

配置文件是 `.kestrel.yml`，环境变量是 `KESTREL_PROVIDER`、`KESTREL_MODEL`、`KESTREL_PROFILE`、`KESTREL_LANG`、`TYPESAFE_API_KEY` 和 `KESTREL_LLM_API_KEY`。叙述器、`--explore` 和 `llm-shim` 还接受 `llm.protocol`（`openai` 或 `anthropic`）、`llm.baseURL` 和 `llm.model`。`llm-shim` 不是默认，输出标成 DEGRADED，判断不是 Jev。OpenTelemetry 在设置 `--otel` 或 `OTEL_EXPORTER_OTLP_ENDPOINT` 时导出，不附带代码。用真实 Jev 校准见 [docs/07-calibrate.md](docs/07-calibrate.md)。示例见 `examples/.kestrel.yml`。

### 团队检查与静态告警

`.kestrel.yml` 里的 `checks` 会编译成 Noul。`expect: true` 对应问题 “Does `hunk` violate this team rule: …?”，概率不取反。`rules show <id>` 能看到编译后的问题；如果提供了正反例，`rules test` 会跑它们。

```yaml
checks:
  - id: team.api.validate-body
    paths: ["src/api/**"]
    ask: "Request handlers must validate the body before use"
    expect: true
    severity: high
```

`--sarif-in <glob>`（或 `static.sarif`）读入 ESLint、Ruff、golangci-lint、Semgrep 等工具的 SARIF。每条落在 diff 上的告警会问“是否真实”和“是否值得在这个 PR 里修”，`real × matters` 达到报告阈值才保留。统计写在报告的 `static` 字段里。`--untrusted` 不会执行静态工具，只读取已经生成的 SARIF。

### GitHub Action

仓库根目录的 `action.yml` 是 composite action。PR 可控的值都从 `env:` 传入。没有 `TYPESAFE_API_KEY` 且 `allow_mock` 不是 `true` 时，job 打出 warning 并跳过（退出码 0）。`GITHUB_TOKEN` 不能提交 `REQUEST_CHANGES` 时，`github post --event auto` 会改发 `COMMENT`。

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

本仓库的 dogfood 工作流用 `version: local` 和 `allow_mock: true`，不依赖已发布的 npm 包。

## 这个版本有什么

- 内置规则：每个 MVP 插件（core、TypeScript/JavaScript、Python、Java、Go）至少 12 条，含正反例。TypeScript 插件另有 React 与 Vue 规则。
- tree-sitter（`web-tree-sitter` 0.25.10）提供封闭函数/类和 `treesitter` 触发器。语法 WASM 加载失败时自动退回启发式上下文和正则触发器。相邻小 hunk 只在同一个封闭函数内合并。
- Provider：`typesafe`（`@typesafe-ai/sdk` 0.6.0，模型 `jev-1.13.0`）、`http`、`mock`、`replay`。测试和 CI 不需要密钥，也不访问网络。
- 输出：终端、JSON、SARIF 2.1.0、Markdown。JSON 报告带有 `trace`，`explain` 用来显示问题、答案和概率。
- `doctor` 检查 Git、Node、API key、模型可达性（有 key 时 `GET /v1/models`）、缓存目录，以及每种语言的解析器。语法加载成功时打印 `parser: tree-sitter (<language>)`，失败时打印 `parser: regex-fallback (<language>)` 并以退出码 1 结束。
- 单二进制：`node scripts/sea/build.mjs` 生成只有一个文件的 `dist/sea/kestrel`（Windows 为 `kestrel.exe`）。语法 wasm、内置规则 YAML 和 `package.json` 都打进 SEA 资源。二进制单独放在空目录里就能跑 `--version`、`doctor`、`rules`、`review` 和 `view`。查看器的 HTML/CSS/JS 编进程序，不另读文件。npm 包仍从磁盘读取 wasm 和规则 YAML。项目自己的 `.kestrel.yml`、`.kestrel/rules/` 和团队 checks 仍从磁盘加载，并覆盖同名内置规则。
- GitHub Action、PR 评论（指纹去重、粘性汇总）和 SARIF 过滤。
- Agent skill：`skills/kestrel/SKILL.md`，以及 Claude Code 命令 `review` / `explain`。

LLM 叙述器仍在后续版本。真实 Jev cassette 需要 `TYPESAFE_API_KEY`，当前 CI 只用 mock 和 replay。详见 [实施计划](docs/05-implementation-plan.md)。

## 许可证

Apache-2.0。
