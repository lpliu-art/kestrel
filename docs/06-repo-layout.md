# 06 · 建议仓库目录结构（Repo Layout）

> 单仓单包（npm 包名 `kestrel-review`，bin 命令 `kestrel`；GitHub `lpliu-art/kestrel`；同时导出 `kestrel-review/plugin` 供插件作者使用）。MVP 不拆 monorepo；第三方插件以独立 npm 包 `kestrel-plugin-<lang>` 发布。
> 标注：**[MVP]** 首个编码会话必须产出；[P1]/[P2]/[P3] 后续阶段。

```text
kestrel/                                 # github.com/lpliu-art/kestrel
├── bin/
│   └── kestrel.mjs                      [MVP] #!/usr/bin/env node → import('../dist/cli/index.js')
├── src/
│   ├── index.ts                         [MVP] 公共 API：review(), loadConfig(), types
│   ├── cli/                             [MVP]
│   │   ├── index.ts                     commander 程序与全局选项
│   │   ├── review.ts
│   │   ├── rules.ts                     list/show/check/test/lint/new
│   │   ├── plugins.ts
│   │   ├── config.ts                    init/print/validate
│   │   ├── cache.ts
│   │   ├── explain.ts                   [P1]
│   │   ├── doctor.ts                    [P1]
│   │   └── github.ts                    [P1] github post
│   ├── config/                          [MVP]
│   │   ├── schema.ts                    zod schema → schemas/config.schema.json
│   │   ├── load.ts                      CLI > env > .kestrel.yml > ~/.config/kestrel/config.yml > 默认
│   │   └── defaults.ts                  profiles、默认 exclude、价格
│   ├── git/                             [MVP]
│   │   ├── exec.ts                      git 子进程封装（超时、maxBuffer、错误分类）
│   │   ├── diff-provider.ts             workspace / staged / commit / range(merge-base)
│   │   └── unified-diff.ts              解析器：文件、hunk、行号映射、rename、binary 标记
│   ├── select/                          [MVP]
│   │   └── gates.ts                     binary/secret/user_exclude/user_include/unsupported/default_path/too_large
│   ├── lang/                            [MVP]
│   │   └── detect.ts                    扩展名/文件名/shebang/嗅探；Vue SFC 提取 [P2]
│   ├── plugins/                         [MVP]
│   │   ├── api.ts                       KestrelPlugin 等接口（对外 kestrel-review/plugin）
│   │   ├── loader.ts                    内置 + 配置显式列出的包；apiVersion 校验；--untrusted
│   │   ├── registry.ts
│   │   └── builtin/
│   │       ├── core/{index.ts,rules/*.yml}
│   │       ├── typescript/{index.ts,context.ts,rules/{core,react,vue}.yml}
│   │       ├── python/{index.ts,context.ts,rules/*.yml}
│   │       ├── java/{index.ts,context.ts,rules/*.yml}
│   │       ├── go/{index.ts,context.ts,rules/*.yml}
│   │       ├── rust/…                   [P2]
│   │       └── csharp/…                 [P2]
│   ├── rules/                           [MVP]
│   │   ├── schema.ts                    Rule / RulePack zod schema → schemas/rule.schema.json
│   │   ├── load.ts                      规则包加载、分层覆盖（builtin < plugin < project < checks）
│   │   ├── trigger.ts                   regex / always / removed；treesitter [P1]；sarif [P1]
│   │   ├── compile.ts                   Pass1 / Pass2 问题编译（纯函数）
│   │   ├── checks.ts                    自然语言团队检查 → 规则 [P1]
│   │   └── template.ts                  {{slot}} 插值、i18n
│   ├── units/                           [MVP]
│   │   ├── build.ts                     hunk 切窗（合并相邻、最大行数）
│   │   ├── context-heuristic.ts         缩进/括号启发式取封闭函数 [MVP]
│   │   ├── context-treesitter.ts        [P1]
│   │   └── state.ts                     L<n> + / D<n> - 行标签序列化
│   ├── security/                        [MVP]
│   │   ├── redact.ts                    密钥/令牌正则脱敏
│   │   └── injection.ts                 u.injection 探针题
│   ├── jev/                             [MVP]
│   │   ├── types.ts                     JevQuestion/JevAnswer/JevProvider
│   │   ├── typesafe.ts                  @typesafe-ai/sdk 包装
│   │   ├── http.ts
│   │   ├── mock.ts
│   │   ├── replay.ts / recording.ts
│   │   ├── budget.ts / cache.ts / rate-limit.ts
│   │   ├── tokens.ts                    ceil(utf8Bytes/3.5) 估算
│   │   ├── factory.ts                   按配置组装装饰器链
│   │   └── llm-shim.ts                  [P3]
│   ├── judge/                           [MVP]
│   │   ├── pass1.ts / pass2.ts
│   │   ├── decide.ts                    p_eff、分档、严重度映射
│   │   ├── dedupe.ts / risk.ts / verdict.ts
│   │   └── static-filter.ts             [P1]
│   ├── narrate/                         [P2]
│   │   ├── llm.ts                       OpenAI/Anthropic-compatible fetch
│   │   └── verify.ts                    Jev 复核
│   ├── render/                          [MVP]
│   │   ├── i18n/{zh-CN,en}.ts
│   │   ├── terminal.ts / json.ts / markdown.ts / sarif.ts
│   │   └── github.ts                    [P1]
│   ├── report/                          [MVP]
│   │   ├── model.ts                     Report/Finding 类型 + schemaVersion
│   │   └── session.ts                   .kestrel/sessions/*.jsonl
│   └── github/                          [P1]
│       ├── post.ts                      Octokit：review + 行内评论 + 粘性汇总
│       └── fingerprint.ts
│   ├── gitlab/                          [P2] MR discussions，指纹去重
│   ├── scan/                            [P2] 全文件虚拟 diff
│   ├── incremental/                     [P2] 上次 head 之后的提交
│   └── judge/pull-request.ts            [P2] PR 级风险与测试缺口
├── schemas/                             [MVP] 由 zod 生成并提交（CI 校验无漂移）
│   ├── config.schema.json
│   ├── rule.schema.json
│   └── report.schema.json
├── skills/
│   └── kestrel/SKILL.md                 [MVP] `npx skills add lpliu-art/kestrel` 入口
├── plugins/kestrel/
│   ├── claude-code/
│   │   ├── .claude-plugin/plugin.json   [MVP]
│   │   └── commands/review.md           [MVP] /kestrel:review
│   ├── .codex-plugin/plugin.json        [P2] ⚠️ 格式需按 Codex 官方规范核实
│   └── .cursor-plugin/plugin.json       [P2] ⚠️ 同上
├── .claude-plugin/marketplace.json      [MVP] 让仓库可作为 Claude Code 插件市场
├── action.yml                           [P1] composite GitHub Action
├── examples/
│   ├── github-actions/kestrel.yml       [P1]
│   ├── .kestrel.yml                     [MVP] 完整配置示例
│   └── plugin-starter/                  [P1] 第三方插件模板（kestrel-plugin-kotlin 示例）
├── test/
│   ├── unit/**/*.test.ts                [MVP]
│   ├── e2e/review.e2e.test.ts           [MVP] 临时 git 夹具仓库 + mock provider
│   ├── fixtures/
│   │   ├── diffs/*.diff                 [MVP] 解析器夹具（rename、binary、无换行、CRLF、空 hunk）
│   │   └── repos/<scenario>/            [MVP] 场景脚本：base 文件 + 变更
│   ├── cassettes/*.json                 [P1] 真实 Jev 录制（RecordingProvider 产出）
│   └── live/*.live.test.ts              [P1] 需 TYPESAFE_API_KEY，否则 skip
├── docs/                                本文档集（01–06）迁入；另含 rule-authoring.md、plugin-authoring.md
├── .github/workflows/
│   ├── ci.yml                           [MVP] lint + typecheck + test（Node 22/24 矩阵）
│   ├── dogfood.yml                      [P1] 用 kestrel 审查本仓库 PR
│   └── release.yml                      [P1] changesets / npm provenance
├── package.json                         [MVP] "name":"kestrel-review", "type":"module", "bin":{"kestrel":"bin/kestrel.mjs"}, "exports": {".", "./plugin"}, engines.node ">=22"
├── tsconfig.json                        [MVP] strict, NodeNext
├── tsup.config.ts                       [MVP]
├── vitest.config.ts                     [MVP]
├── biome.json                           [MVP]
├── .kestrel.yml                         [P1] 本仓库自身的 dogfood 配置
├── README.md / README.en.md             [MVP]
├── CONTRIBUTING.md / SECURITY.md        [MVP]
├── NOTICE                               [MVP] 声明与 TypeSafe AI 无隶属关系；致谢/借鉴项目
└── LICENSE                              [MVP] Apache-2.0（与 OCR 相同，含专利授权条款）
```

## 约定

- **ESM only**，Node ≥ 22；`dist/` 由 tsup 生成，不提交。
- 规则 YAML 随包发布：`package.json#files` 包含 `dist/`、`src/plugins/builtin/**/rules/*.yml`（或构建时拷贝到 `dist/`）、`schemas/`、`skills/`、`plugins/`。
- 规则 ID：`<prefix>.<category>.<kebab-name>`（prefix 为语言/子包短名：`core`/`ts`/`react`/`vue`/`py`/`java`/`go`），如 `py.security.shell-true`；ID 一经发布不可重命名（指纹、抑制注释依赖它），只能 `deprecated: true`。
- 抑制注释：`kestrel-ignore <ruleId> <reason>`（用该语言的注释语法，写在同一行或上一行），在 S5 触发阶段跳过对应候选（见 03 §3.5）。
