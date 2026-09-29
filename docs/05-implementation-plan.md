# 05 · 实施计划（Implementation Plan）

> 目标读者：在 `lpliu-art/kestrel` 仓库中负责实现的编码 Agent / 工程师。
> 依据：[03-technical-design.md](03-technical-design.md)（下称“设计”）与 [06-repo-layout.md](06-repo-layout.md)。**设计与本计划冲突时以设计为准，并回写修订本计划。**
> 阶段：**M0/MVP（一个编码会话可完成）→ P1（CI 与 PR 集成）→ P2（叙述器与生态扩展）→ P3（评测校准与形态）**。

---

## 0. 全局约束（所有阶段适用）

1. **无 Jev Key 也必须能构建、测试、演示**：所有测试默认 `provider=mock` 或 `replay`；真实 Jev 测试放在 `test/live/`，缺少 `TYPESAFE_API_KEY` 时自动 skip。
2. **Jev 只回答问题，不生成文本**：任何面向用户的句子都来自规则模板（`message`/`fix`）或 P2 的 LLM 叙述器（必须经 Jev 复核）。代码评审时如果看到“让 Jev 写说明”的实现，即为缺陷。
3. **确定性优先**：同一输入 + 同一锁定模型版本（或 mock）→ 输出字节级一致（排序稳定、时间戳仅出现在 `run` 元数据中，快照测试时注入固定时钟）。
4. **公共契约先行**：`src/plugins/api.ts`、`src/jev/types.ts`、`src/report/model.ts` 与三个 JSON Schema 是对外契约，改动须同步 `schemaVersion`/`apiVersion` 与 CHANGELOG。
5. 代码风格：TypeScript strict、ESM、Node ≥ 22、biome；不引入设计 §1.2 之外的运行时依赖（需要时先在 PR 中说明）。
6. 包名 `kestrel-review`，bin `kestrel`，插件子路径 `kestrel-review/plugin`；配置文件 `.kestrel.yml`；工作目录 `.kestrel/`（cache、sessions）。

---

## 1. M0 / MVP —— “一次会话可交付的可用 CLI”

**范围一句话**：在本地 Git 仓库上运行 `kestrel review`，对 TS/JS、Python、Java、Go 的变更，用 Jev（或 mock/replay）按规则问答，输出终端 / JSON / Markdown / SARIF，支持 `--gate` 退出码；附带 Skill 与 Claude Code 命令。

**明确不在 MVP 内**：tree-sitter、GitHub PR 评论与 Action、SARIF 输入过滤、自然语言 `checks`、LLM 叙述器、`explain`/`doctor`、scan 模式、React/Vue 深度规则（MVP 仅各 2 条 regex 规则）。

### 1.1 任务分解（建议按顺序实现；括号内为预估规模）

| # | 任务 | 产出 | 设计章节 |
|---|---|---|---|
| T1 | 脚手架（S） | `package.json`（name/bin/exports/engines/files）、tsconfig、tsup、vitest、biome、`bin/kestrel.mjs`、`.github/workflows/ci.yml`（Node 22/24） | §1、06 |
| T2 | 配置（S） | `config/schema.ts`（zod）+ 分层加载 + profiles 默认值 + `kestrel config init/print/validate`；导出 `schemas/config.schema.json` | §6 |
| T3 | Git 接入与 diff 解析（M） | `git/exec.ts`、`diff-provider.ts`（workspace/staged/commit/range）、`unified-diff.ts`（rename、binary、`\ No newline`、CRLF、新增/删除文件、行号映射） | §3.1 |
| T4 | 文件闸门 + 语言识别（S） | `select/gates.ts`（7 道闸门，带跳过原因）、`lang/detect.ts`（扩展名/文件名/shebang）、`--preview` 列表输出 | §3.2–3.3 |
| T5 | 插件 API 与加载（S） | `plugins/api.ts`（`KestrelPlugin` 等接口，`apiVersion: 1`）、`loader.ts`（内置 + 配置显式列出、`--untrusted`）、`registry.ts`；`kestrel plugins list/info` | §5.1、§5.4 |
| T6 | 规则 schema 与加载（M） | `rules/schema.ts`、`load.ts`（分层覆盖、disable、严重度覆盖）、`kestrel rules list/show/check/lint/new`；导出 `schemas/rule.schema.json` | §5.2 |
| T7 | 内置规则包（M） | core ≥ 5 条、typescript ≥ 8 条（含 react 2、vue 2）、python ≥ 6、java ≥ 6、go ≥ 6；每条含 `examples.positive/negative`（各 ≥ 1）与 `mock` 提示；zh-CN / en 模板 | §5.5 |
| T8 | 审查单元与 state（M） | `units/build.ts`（切窗、合并、上限）、`context-heuristic.ts`（缩进/括号取封闭函数）、`state.ts`（`L<n> +` / `D<n> -` 行标签） | §3.4、§3.6 |
| T9 | 安全（S） | `security/redact.ts`（常见 token/私钥/连接串正则）、`injection.ts`（`u.injection` 题）；`--show-payload` | §11 |
| T10 | 触发与问题编译（M） | `rules/trigger.ts`（regex/always/removed + 抑制注释）、`compile.ts`（Pass 1：`d.*`、`u.priority`、`u.injection`、`r.*`、`g.*`、`s.*`；Pass 2：`loc.*`、`slot.*`；上下文长度校验与拆批） | §3.5、§3.7、§4.3 |
| T11 | Jev Provider 层（M） | `jev/types.ts`、`typesafe.ts`（SDK，强制 logLevel ≤ info）、`http.ts`、`mock.ts`（§4.4 语义）、`replay.ts`、`recording.ts`、`budget.ts`、`cache.ts`（仅锁定模型）、`rate-limit.ts`、`tokens.ts`、`factory.ts` | §4 |
| T12 | 判定（M） | `judge/pass1.ts`、`pass2.ts`、`decide.ts`（`p_eff`、分档、严重度映射）、`dedupe.ts`、`risk.ts`（文件风险 + 深审清单）、`verdict.ts`（门禁） | §3.8 |
| T13 | 渲染与报告（M） | `render/terminal.ts`、`json.ts`、`markdown.ts`、`sarif.ts`（SARIF 2.1.0）、i18n；`report/model.ts`、`session.ts`；导出 `schemas/report.schema.json` | §8 |
| T14 | `review` 命令编排（S） | 串起 S0–S11；并发、进度（`--audience human`）、错误分类与退出码 0/1/2/3/4；mock 回退规则（交互式提示 vs `CI=true` 退出 3） | §3、§7、§13 |
| T15 | `rules test`（S） | 用 mock 跑全部规则正反例（positive→report、negative→drop）；`--live --record` 预留参数（无 key 时报清晰错误） | §7 |
| T16 | Skill 与 Claude Code 插件（S） | `skills/kestrel/SKILL.md`、`plugins/kestrel/claude-code/{.claude-plugin/plugin.json,commands/review.md}`、`.claude-plugin/marketplace.json`（按设计 §9 草案） | §9 |
| T17 | 文档（S） | README.md / README.en.md、`docs/rule-authoring.md`、CONTRIBUTING、SECURITY、NOTICE、LICENSE（Apache-2.0）、`examples/.kestrel.yml` | — |

依赖顺序：T1 → T2 → T3 → T4 → T5/T6 → T7 → T8/T9 → T10 → T11 → T12 → T13 → T14 → T15 → T16/T17。T11 可与 T6–T10 并行（只依赖 `jev/types.ts`）。

### 1.2 MVP 规则清单（最小集，ID 取自设计 §5.5）

| 插件 | MVP 规则 |
|---|---|
| core | `core.secrets.hardcoded`、`core.debug.leftover`、`core.todo.new-without-ticket`、`core.meta.reviewer-directed-text`（由 `u.injection` 生成）、`core.deps.install-script` |
| typescript | `ts.security.sql-string-concat`、`ts.security.command-injection`、`ts.security.dynamic-code`、`ts.security.xss-html-sink`、`ts.correctness.floating-promise`、`ts.correctness.async-foreach`、`ts.reliability.swallowed-error`、`ts.types.unsafe-escape`；react：`react.hooks.conditional-call`、`react.list.index-key`；vue：`vue.security.v-html`、`vue.reactivity.lost` |
| python | `py.security.sql-format`、`py.security.shell-true`、`py.security.unsafe-deserialization`、`py.security.path-traversal`、`py.correctness.mutable-default-arg`、`py.reliability.broad-except-swallow`、`py.async.blocking-in-async` |
| java | `java.security.sql-concat`、`java.security.deserialization`、`java.exception.swallowed`、`java.resource.no-try-with-resources`、`java.concurrency.unsafe-shared-state`、`java.spring.transactional-self-invocation` |
| go | `go.errors.ignored`、`go.http.body-not-closed`、`go.defer.in-loop`、`go.context.cancel-not-called`、`go.sql.rows-err-unchecked`、`go.security.math-rand-secret` |

> Vue 在 MVP 中只按 `.vue` 文件整体作为 typescript/javascript 文本处理（regex 触发），SFC `<script>` 精确提取放 P2。

### 1.3 MVP 验收标准（全部满足才算完成）

| # | 验收项 | 验证方式 |
|---|---|---|
| A1 | `npm ci && npm run build && npm test` 在 Node 22 通过；`npm run lint`、`tsc --noEmit` 无错误 | CI |
| A2 | `node bin/kestrel.mjs review --provider mock` 在夹具仓库中输出终端报告，含 ≥ 1 条 report 带发现，且带醒目 “MOCK — 非 AI 判断” 标注 | e2e |
| A3 | `--staged`、`--commit <sha>`、`--from main` 三种目标均能正确取到 diff（与 `git diff` 行号一致） | e2e |
| A4 | `--format json` 输出通过 `schemas/report.schema.json` 校验；`--format sarif` 通过 SARIF 2.1.0 官方 schema 校验 | 单测（ajv） |
| A5 | 每条发现的行号都指向 diff 中真实存在的**新增行**（或标记为 unit 级 “location uncertain”） | e2e 断言 |
| A6 | `--gate` 有 high 发现时退出码 1，否则 0；配置错误退出 2；`--provider typesafe` 无 key 时退出 3 且提示清晰 | e2e |
| A7 | `kestrel rules test` 对全部内置规则的正反例在 mock 下 100% 通过；`kestrel rules lint` 无错误 | CI |
| A8 | `--preview --show-payload` 不发网络请求，打印脱敏后的 state 与问题、预计 token 与成本；夹具中的假 AWS key 被替换为 `[REDACTED:aws-key]` | e2e（断言无 fetch 调用） |
| A9 | 同一输入运行两次（mock），JSON 报告除 `run.startedAt/durationMs` 外字节一致 | e2e |
| A10 | Replay：用手写 cassette 驱动 `--provider replay`，Pass 1 + Pass 2 路径被覆盖，结果与 cassette 预期一致 | 单测 |
| A11 | 缓存：锁定模型时第二次运行 `cachedRequests == requests`；使用 `jev-latest` 时不缓存并打印警告 | 单测 |
| A12 | 预算：`--budget-tokens 1` 时不崩溃，未完成单元标记 `skipped: budget`，退出码 0（或 `--strict` 下 4） | 单测 |
| A13 | 性能（mock）：100 个单元的夹具在 2 s 内完成（排除 git 调用） | bench 测试（软指标，记录不阻塞） |
| A14 | `skills/kestrel/SKILL.md` frontmatter 合法（name/description），Claude 命令文件存在且引用 `kestrel review --format json --audience agent` | 单测（解析 frontmatter） |
| A15 | 若有 `TYPESAFE_API_KEY`：`test/live/smoke.live.test.ts` 对 1 个单元调用真实 Jev 成功，响应含 `model` 与 `usage`；无 key 时 skip | live（可选） |

### 1.4 MVP 测试策略

| 层 | 内容 | 工具 |
|---|---|---|
| 单元测试 | diff 解析器（`test/fixtures/diffs/*.diff`：rename、binary、无尾换行、CRLF、多 hunk、仅删除）；闸门；语言识别；规则 schema；触发器与抑制注释；问题编译（快照）；`p_eff`/分档/严重度映射/门禁（表驱动）；token 估算；限流（假时钟）；缓存键稳定性；脱敏正则；各渲染器（快照） | vitest |
| 规则测试 | 每条规则的 `examples` 在 mock 下断言 positive→report / negative→drop（`kestrel rules test` 与 vitest 共享实现） | vitest + CLI |
| Provider 契约测试 | 同一组 `JevRequest` 对 mock / replay / http（用 `undici` MockAgent 或自定义 fetch 桩）断言响应形状符合 `JevResponse`；http 的 401/422/429/529 映射到错误类别与重试 | vitest |
| e2e | `test/e2e/review.e2e.test.ts`：在 `os.tmpdir()` 用 `git init` 创建夹具仓库（base 提交 + 场景变更，覆盖 4 种语言），以子进程运行 `bin/kestrel.mjs`，断言退出码、JSON 报告、行号 | vitest + execa |
| Schema 校验 | report/rule/config schema 由 zod 生成且与提交版本一致（防漂移）；SARIF 用官方 `sarif-schema-2.1.0.json`（测试时从夹具目录读取，已随仓库提交） | ajv |
| Live（可选） | 缺 key 自动 skip；只跑 1–3 个请求控制成本；支持 `--record` 生成 cassette | vitest |

### 1.5 建议的会话内执行节奏（供编码 Agent 参考）

1. T1–T4 完成后先提交一次（“能拿到 diff 并列出文件/单元”，`--preview` 可用）。
2. T5–T10 完成后第二次提交（“规则触发 + 问题编译快照测试通过”）。
3. T11–T14 完成后第三次提交（“mock 端到端可跑、门禁可用”）。
4. T15–T17 收尾、跑满 A1–A14，更新 README 中的真实输出示例（mock）。

### 1.6 MVP 风险与对策

| 风险 | 对策 |
|---|---|
| 无 Jev 访问权（等候名单/来源冲突） | 全链路 mock/replay；Provider 层与 SDK 解耦（`http.ts` 直连） |
| SDK 版本与文档不一致 | `TypeSafeProvider` 只用 `systemOne()` 最小接口；契约测试覆盖；出问题时切 `--provider http` |
| diff 解析边界情况 | 以 `git diff --no-ext-diff --no-color -M -U3` 固定格式；夹具覆盖；解析失败的文件降级为“跳过并记录原因”而非崩溃 |
| 会话时间不够 | 可裁剪项（按优先级从低到高裁）：vue/react 规则 → Markdown 渲染 → cache → recording；不可裁：mock、JSON、门禁、e2e |

---

## 2. P1 —— CI 与 PR 集成、结构化上下文

| # | 任务 | 验收标准 |
|---|---|---|
| P1-1 | tree-sitter 上下文（`web-tree-sitter` + TS/TSX/JS/Python/Java/Go 语法 wasm）：封闭函数/类、导入、签名；`treesitter` 触发器 | 语法 wasm 与 web-tree-sitter ABI 兼容性验证通过（⚠️ 先做 spike）；启发式与 AST 上下文在夹具上对比，AST 版封闭函数识别准确率 ≥ 95%；加载失败自动降级启发式 |
| P1-2 | `action.yml`（composite）+ `examples/github-actions/kestrel.yml` | 在测试仓库 PR 上跑通：job summary、SARIF 上传、门禁；fork PR 无 secret 时跳过并警告；所有 PR 可控值经 `env:` 传入（actionlint + zizmor 检查通过） |
| P1-3 | `kestrel github post`：行内评论（仅新增行）、粘性汇总、指纹去重、`--summary-only`、`--event` | 重复运行不产生重复评论；diff 外的行号降级为汇总；API 失败不影响退出码（除非 `--strict`）。⚠️ 验证 Actions 的 `GITHUB_TOKEN` 能否提交 REQUEST_CHANGES，不能则降级 COMMENT |
| P1-4 | SARIF 输入（`--sarif-in`）+ 静态告警过滤（设计 §3.9） | ESLint/Ruff/golangci-lint/Semgrep 样例 SARIF 可导入；每条告警得到 keep/drop 与概率；过滤统计出现在报告中 |
| P1-5 | 自然语言 `checks` → 规则编译 | `.kestrel.yml` 中一句话检查可被 `rules show` 显示为编译后的 Noul；正反例（用户可选提供）可被 `rules test` 执行 |
| P1-6 | `kestrel explain`、`kestrel doctor` | explain 显示发现的全部问题/答案/概率/模型版本；doctor 检查 Git/Node/key/模型可达性（`GET /v1/models`）/缓存目录 |
| P1-7 | 真实 Jev 回归夹具：用 `--record` 为每个内置规则录制 cassette；`rules test --live` 输出概率分布 | cassette 入库；CI 用 replay 跑；漂移报告（同模型版本下 band 变化 ≤ 5%） |
| P1-8 | 规则扩充：每个 MVP 插件 ≥ 12 条；发布 `examples/plugin-starter` | `rules lint` 通过；每条有正反例 |
| P1-9 | 发布流程：changesets、npm provenance、`release.yml`；dogfood 工作流 | `npx kestrel-review@latest` 可用；本仓库 PR 自动被 Kestrel 审查 |

测试补充：GitHub API 用 `nock`/MSW 桩；Action 用 `act` 本地冒烟（可选）+ 测试仓库真实运行；tree-sitter 夹具快照。

---

## 3. P2 —— 叙述器、语言与生态扩展

> 状态：0.3.0 已在本仓库实现。计划里 Rust/C# 的下限是各 ≥ 8 条规则；实现按与既有插件相同的标准写了各 12 条。GitLab「在测试项目跑通」没有可用的测试项目，由注入的 fetch 覆盖。Codex/Cursor 清单已按公开文档核对字段并放进仓库，没有提交到公共插件目录。

| # | 任务 | 验收标准 |
|---|---|---|
| P2-1 | LLM 叙述器（OpenAI-compatible `/chat/completions`、Anthropic `/v1/messages`，仅 `fetch`）+ Jev 复核（addresses / unrelated / contradicts 三问，不通过则回退模板） | 默认关闭；开启后仅对 top-N report 带发现调用；复核失败率与回退在报告中可见；无 LLM key 时行为与 MVP 完全一致 |
| P2-2 | React/Vue 深度：Vue SFC `<script>`/`<template>` 提取、hooks 规则、框架 facts 检测 | 各 ≥ 8 条规则；SFC 行号映射正确 |
| P2-3 | Rust、C# 插件 | 各 ≥ 8 条规则 + 正反例 |
| P2-4 | GitLab MR 输出（Notes API）与 GitLab CI 模板 | 在测试项目跑通 |
| P2-5 | `kestrel scan <paths>`（全文件审计：虚拟“全新增”单元） | 大文件分块、预算保护生效 |
| P2-6 | Codex / Cursor 插件清单 | ⚠️ 先对照官方规范核实字段，再发布 |
| P2-7 | 增量评审（PR 同步时只审新 commit，结合缓存与指纹） | 第二次推送仅新 hunk 产生请求 |
| P2-8 | PR 级判断（整体风险、测试缺口 `tests_changed`） | 汇总中出现 PR 级结论且可 explain |

---

## 4. P3 —— 评测、校准与形态

| # | 任务 | 验收标准 |
|---|---|---|
| P3-1 | `kestrel eval <dataset>`：precision/recall/F1、按规则的可靠性曲线（calibration plot）、阈值搜索 | 在内部标注集 + 公开集（如 AACR-Bench，⚠️ 先确认许可证）上输出报告；profiles 阈值按结果更新并记录 |
| P3-2 | 护栏公式校准（验证/替换 `p_eff = p × Π(1−g)^w` 启发式，可选 logistic 融合） | 相比启发式 F1 不下降，ECE 改善 |
| P3-3 | 会话查看器（本地静态 HTML，读取 `.kestrel/sessions/*.jsonl`） | 可按单元查看 state、问题、答案、耗时 |
| P3-4 | 单二进制（Node SEA 或 bun compile） | ⚠️ 先 spike 验证 web-tree-sitter wasm 打包；三平台产物可运行 |
| P3-5 | `LlmShimProvider`（无 Jev 权限时的降级模式） | 输出明确标注降级；不作为默认 |
| P3-6 | OpenTelemetry 导出（请求数、token、延迟、band 分布） | 可接入 OTLP collector |

---

## 5. 跨阶段质量门槛

- 覆盖率：`src/judge`、`src/rules`、`src/git` ≥ 90% 行覆盖；整体 ≥ 80%。
- 每个新规则必须带正反例与 mock 提示；PR 模板中勾选 “规则问题为英文、单一判断、不含计数/日期推理”（对应 Jev 的已知弱点）。
- 每次修改问题编译器（会改变发送给 Jev 的文本）都必须更新快照并重新录制受影响的 cassette，CHANGELOG 注明“可能影响判断分布”。
- 安全：依赖审计（`npm audit --omit=dev`）、Action 用 zizmor/actionlint；SECURITY.md 提供私下披露渠道。

## 6. 里程碑与交付物总览

| 里程碑 | 交付物 | 发布版本 |
|---|---|---|
| M0 / MVP | CLI（review/rules/plugins/config/cache）、4 语言 + core 规则包、mock/replay/typesafe/http provider、终端/JSON/Markdown/SARIF、门禁、Skill + Claude 命令 | `0.1.0` |
| P1 | tree-sitter、GitHub Action + PR 评论、SARIF 过滤、checks、explain/doctor、cassette 回归 | `0.2.x` |
| P2 | LLM 叙述器、React/Vue 深度、Rust/C#、GitLab、scan、Codex/Cursor、增量 | `0.3.x` |
| P3 | eval/校准、会话查看器、单二进制、llm-shim、OTel | `0.4.x → 1.0` |
