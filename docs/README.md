# Kestrel 🦅 —— 快思考的代码评审

> **像红隼一样：悬停扫视整个 diff，只对确认的问题俯冲。**
> Kestrel 是一个开源 AI 代码评审工具（CLI + Agent Skill + GitHub Action），核心判断由 TypeSafe AI 的 “System One” 模型 **Jev** 完成：每个改动块在几百毫秒内得到**校准过的概率**，而不是一段可能跑偏的长文。

[English](README.en.md) · [调研](01-research.md) · [概念](02-concept.md) · [技术方案](03-technical-design.md) · [架构图](04-architecture.md) · [实施计划](05-implementation-plan.md) · [目录结构](06-repo-layout.md)

> ⚠️ 状态：0.4.0（P3）已在仓库中实现。0.4.1 让单二进制加载 tree-sitter，0.4.2 把内置规则也打进同一个文件。本目录仍是设计说明。Kestrel 是社区项目，**与 TypeSafe AI 无隶属关系**。Jev 需要 TypeSafe API Key（访问政策以官方为准）。LLM 叙述器默认关闭，密钥是 `KESTREL_LLM_API_KEY`。用真实 Jev 校准见 [07-calibrate.md](07-calibrate.md)。发布 npm 包和三个平台二进制见仓库的 Release 工作流。

## 为什么是 Kestrel

大多数 AI 评审工具让 LLM“读完代码写评论”：慢、贵、结果不稳定、行号会漂移、难以设门禁。Jev 走的是另一条路——**它不生成文本**，只回答带类型的问题（是/否概率、多选、打分），一次并行作答、70–500 ms、按输入 token 计费（官方公布 $0.042 / 百万 token）。

Kestrel 据此把代码评审重新设计为 **“规则即问题（Rules-as-Questions）”**：

1. 确定性管线读取 git diff，按语言插件切出审查单元、跑触发器；
2. 把每条规则编译成 Jev 的 typed 问题（主问题 + 反证守卫 + 严重度打分），一个单元一个请求；
3. 用概率阈值分档（report / uncertain / drop），在**真实存在的行号**上用 Choice 定位；
4. 评论文字来自规则目录的**确定性模板**（中/英）；需要更自然的解释时，交给宿主 Agent（Claude Code/Codex/Cursor）或可选 LLM 叙述器（其输出再由 Jev 复核）。

## 特性

- ⚡ **快且便宜**：典型 PR 约 40 个单元，目标 p50 < 3 s、成本 < $0.01（设计估算，待实测）。
- 🎯 **可校准、可门禁**：每条发现都带概率、严重度与模型版本；`--gate` 仅在“高严重度且 p ≥ 0.8”时阻塞合并。
- 🧩 **每种语言一个插件**：TypeScript/JavaScript（含 React、Vue 规则子包）、Python、Java、Go、Rust、C# + 通用 core。规则是 YAML 数据，自带正反例测试。
- 🧾 **多种输出**：终端、JSON（给 Agent）、SARIF 2.1.0（GitHub Code Scanning）、Markdown、GitHub PR 行内评论 + 粘性汇总。
- 🤖 **Agent 原生**：`npx skills add lpliu-art/kestrel`、Claude Code `/kestrel:review`；Agent 负责写解释与修复，Kestrel 负责快速判断与定位。
- 🧪 **离线可测**：`--provider mock`（确定性启发式，显著标注“非 AI”）与 `replay`（录制回放），CI 与测试无需 Jev Key。
- 🔒 **隐私优先**：只发送脱敏后的 hunk 窗口与有限上下文；`--preview --show-payload` 可离线查看将发送的全部内容；CI 默认 `--untrusted`。

## 快速开始

```bash
# 需要 Node.js ≥ 22 与 Git ≥ 2.30
export TYPESAFE_API_KEY=ts-...           # 真实评审需要
npx kestrel-review review                # 审查工作区未提交改动
npx kestrel-review review --staged       # 只审暂存区（适合 pre-commit）
npx kestrel-review review --from main    # 审查当前分支相对 main 的改动

# 没有 Key？先用 mock 体验流程（结果不是 AI 判断）
npx kestrel-review review --provider mock

# 全局安装后命令为 kestrel
npm i -g kestrel-review && kestrel --help
```

示例输出（设计稿）：

```
$ kestrel review --from main
✔ 12 files changed · 9 reviewable · 3 skipped (lockfile, generated, test)
✔ 41 review units · 2 Jev passes (46 requests, 3 cached) · 1.4s · ~$0.008
✖ HIGH  src/api/user.ts:57  [ts.security.sql-string-concat] p=0.93
  第 57 行通过拼接非常量值构造 SQL，可能导致 SQL 注入。
  建议：改用参数化查询，例如 `db.query('... WHERE id = $1', [id])`。
Verdict: REQUEST_CHANGES (1 blocking: severity≥high & p≥0.80)
```

## 常用命令

```bash
kestrel review --from main --format json --out kestrel.json    # 结构化结果
kestrel review --format sarif --out kestrel.sarif               # 上传 Code Scanning
kestrel review --gate --fail-on high                            # 作为合并门禁（失败退出码 1）
kestrel review --preview --show-payload                         # 不调用 Jev，查看将发送的内容与预计成本
kestrel rules list --lang python                                # 查看规则
kestrel rules show ts.security.sql-string-concat                # 查看规则编译后的 Jev 问题
kestrel rules test                                              # 运行所有规则正反例
kestrel explain <findingId> --report kestrel.json               # 查看一条发现背后的全部问答与概率（P1）
kestrel explain pr --report kestrel.json                        # PR 级风险与测试缺口（P2）
kestrel scan <paths...>                                         # 全文件审计（P2）
kestrel review --llm                                            # 可选叙述器，默认关闭（P2）
kestrel review --incremental --from main                        # 只审上次成功评审之后的提交（P2）
kestrel gitlab post --report kestrel.json --project group/app --mr 1
```

退出码：`0` 通过 · `1` 门禁失败 · `2` 用法/配置错误 · `3` Provider 错误 · `4` 部分失败（`--strict`）。

## 在 Agent 中使用

```bash
npx skills add lpliu-art/kestrel --skill kestrel         # 通用 Skill
/plugin marketplace add lpliu-art/kestrel                # Claude Code
/plugin install kestrel@kestrel                          # 然后使用 /kestrel:review
```

## GitHub Action（P1）

```yaml
- uses: lpliu-art/kestrel@v0
  with:
    typesafe_api_key: ${{ secrets.TYPESAFE_API_KEY }}
    language: zh-CN
    fail_on: high          # 开启门禁
```

## 配置（`.kestrel.yml` 节选）

```yaml
version: 1
jev: { provider: typesafe, model: jev-1.13.0 }   # 锁定模型版本以启用缓存
profile: balanced                                # chill | balanced | assertive
output: { language: zh-CN }
rules:
  disable: ["core.todo.new-without-ticket"]
checks:                                          # 团队规则：一句话即一条可校准检查（P1）
  - id: team.no-console-in-services
    paths: ["src/services/**"]
    ask: "The added service code logs with the shared logger instead of console.*."
    expect: true                                 # 编译为“是否违反该团队规则”的 Noul
    severity: medium
gate: { failOn: high, minProbability: 0.8 }
```

## 编写规则 / 插件（摘要）

规则是 YAML 数据：**触发器**（regex / tree-sitter / always / removed）决定何时提问，**主问题**（Noul，英文、单一判断）判断是否违规，**守卫**问题提供反证以降低误报，**严重度**用 2–10 级 Score，**模板**负责输出文字，**examples** 是规则自带的单元测试。

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
    zh-CN: { body: "第 {{line}} 行以 shell=True 执行拼接的命令，可能导致命令注入。" }
    en:    { body: "Line {{line}} runs a concatenated command with shell=True; this may allow command injection." }
  examples:
    positive: [{ code: "subprocess.run('ls ' + path, shell=True)" }]
    negative: [{ code: "subprocess.run(['ls', path])" }]
```

新语言插件是一个导出 `KestrelPlugin` 的 npm 包（`kestrel-plugin-<lang>`），声明语言定义、规则包，可选上下文提供者与静态工具适配器；只有在 `.kestrel.yml` 的 `plugins:` 中显式列出才会加载。详见 [技术方案 §5](03-technical-design.md)。

## 路线图

MVP（0.1）：CLI + 4 语言规则包 + mock/replay/typesafe provider + 终端/JSON/Markdown/SARIF + 门禁 + Skill → P1：tree-sitter、GitHub Action 与 PR 评论、静态工具 SARIF 过滤、团队 checks → P2（0.3.0，已交付）：LLM 叙述器、React/Vue 深度、Rust/C#、GitLab、scan、增量评审、PR 级判断 → P3（0.4.0–0.4.3，已交付）：评测与阈值校准、护栏公式比较、会话查看器、单二进制、llm-shim、OpenTelemetry、`--explore`、`kestrel auth`。详见 [实施计划](05-implementation-plan.md)。

## 致谢与声明

设计借鉴了 [alibaba/open-code-review](https://github.com/alibaba/open-code-review)、[PR-Agent](https://github.com/The-PR-Agent/pr-agent)、[reviewdog](https://github.com/reviewdog/reviewdog)、[Danger](https://github.com/danger/danger-js)、[Semgrep](https://github.com/semgrep/semgrep)、[SonarQube](https://github.com/SonarSource/sonarqube)、CodeRabbit 公开文档等项目的思路（见 [调研](01-research.md)）。“Jev”“TypeSafe”为其各自权利人的名称；Kestrel 与 TypeSafe AI 无隶属关系。许可证：Apache-2.0。
