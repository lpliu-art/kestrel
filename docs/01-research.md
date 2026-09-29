# 01 · 调研报告：GitHub 上主流代码评审工具

> 调研日期：2026-09-29（Asia/Shanghai）。Star 数为当日通过 GitHub 只读 API 读取的数值，仅作量级参考。
> 调研方式：仅使用 Web 搜索/抓取与 GitHub 只读接口，**未 clone 任何仓库**。
> 标注约定：✅ 已在所列来源中核实；⚠️ 未核实/推断/来源之间存在矛盾。

---

## 0. 结论速览（TL;DR）

1. **确定性工程 + 模型各司其职** 是当前最成功的架构范式（alibaba/open-code-review 的核心卖点）。模型只做"难以用规则表达的判断"，文件选择、规则匹配、行号定位、过滤全部交给代码。
2. **"位置漂移"与"误报"是 AI 评审的两大信任杀手。** OCR 用独立的定位模块 + 反思过滤模块、PR-Agent 用 self-reflection 打分、Claude Code Security Review 用 false-positive filter，都在治理这两点。
3. **规则 = 按路径/语言匹配的"检查单"**（OCR `rule.json` + 每语言 `rule_docs/*.md`、CodeRabbit `path_instructions`、Kodus "Kody Rules"、Semgrep YAML 规则）。规则可版本化、可测试、可分层覆盖。
4. **输出与集成标准化**：JSON 信封 + SARIF 2.1.0 + GitHub PR Review API 内联评论 + 粘性汇总评论；reviewdog 的 `filter-mode`（只报新增行）是"只评审新代码"的成熟做法；SonarQube 的 Quality Gate（"新代码零新问题"）是成熟的"合并闸门"模型。
5. **分发**：npm 全局安装 + Agent Skill（`npx skills add`）+ Claude Code / Codex / Cursor 插件清单 + GitHub Action，是 2026 年 AI 评审工具的"标配四件套"（OCR 全部具备）。
6. **Jev 的出现改变了成本结构**：已经有人用 Jev 做评审原型（devagrawal09/jev-review，639★），验证了"Noul 风险矩阵 → Choice 定位 → Score 严重度"的分阶段思路可行，但它**没有**插件体系、静态分析集成、CI、SARIF、技能打包——这正是 Kestrel 的机会。

---

## 1. 对比总表

| 工具 | Star | 主语言 | 许可证 | 形态 | 模型角色 | 规则模型 | 输出/集成 | 最值得借鉴 |
|---|---|---|---|---|---|---|---|---|
| [alibaba/open-code-review](https://github.com/alibaba/open-code-review) (OCR) | 42,321 ✅ | Go | Apache-2.0 | CLI + Skill + 多 Agent 插件 + Action + IDE | LLM Agent（工具调用），确定性流水线约束 | 4 层规则链（`--rule` > 项目 > 全局 > 内置），按 glob 匹配每文件规则文本 | text/JSON/SARIF、GitHub/GitLab/Gerrit…、会话查看器 | 确定性×Agent 混合；6 道文件过滤闸门；外部定位与反思模块；委托模式；插件打包 |
| [The-PR-Agent/pr-agent](https://github.com/The-PR-Agent/pr-agent)（原 qodo-ai/pr-agent） | 13,179 ✅ | Python | MIT | CLI/Action/Webhook/Docker | 单次 LLM 调用/工具 | TOML 配置 + JSON 化提示词 | PR 评论 `/review` `/describe` `/improve` | PR 压缩策略；非对称动态上下文；self-reflection 打分重排 |
| [CodeRabbit](https://docs.coderabbit.ai)（SaaS，闭源） | — | — | 商业 | GitHub App / IDE / CLI | 多阶段 LLM + 50+ 第三方工具 | `.coderabbit.yaml`：`path_filters`、`path_instructions`、ast-grep 规则、自定义检查 | PR 评论、一键修复 | 路径级指令；工具沙箱运行；Chill/Assertive 两档画像；默认忽略清单 |
| [reviewdog/reviewdog](https://github.com/reviewdog/reviewdog) | 9,629 ✅ | Go | MIT | CLI + Action | 无 AI | 任意 linter 输出（errorformat / rdjson / SARIF / checkstyle / diff） | GitHub PR review/check/annotations、GitLab、Gerrit、Bitbucket、Gitea | `filter-mode`：added / diff_context / file / nofilter；统一诊断格式 RDFormat |
| [danger/danger-js](https://github.com/danger/danger-js) | 5,511 ✅ | TypeScript | MIT | CI 中运行 dangerfile | 无 AI | 用代码写团队约定（`warn/fail/message`） | PR 评论 | "把 review 礼仪形式化"；插件系统 |
| [semgrep/semgrep](https://github.com/semgrep/semgrep) | 16,787 ✅ | C/OCaml | LGPL-2.1 | CLI | 无 AI（社区版） | YAML 规则：`id/message/severity/languages/pattern*/metadata/fix/paths` | JSON/SARIF | 规则即数据、可测试（`ruleid:`/`ok:` 注释）、元变量插值进消息 |
| [SonarSource/sonarqube](https://github.com/SonarSource/sonarqube) | 11,035 ✅ | Java | LGPL-3.0 | 服务端 | 无 AI（核心） | 按语言 Quality Profile + 规则 | Quality Gate 通过/失败 | "Clean as You Code"：闸门只看新代码 |
| [anthropics/claude-code-security-review](https://github.com/anthropics/claude-code-security-review) | 6,278 ✅ | Python | MIT | GitHub Action | LLM | 可定制安全审查提示 + 误报过滤指令 | PR 评论 | 独立的 false-positive filtering 阶段 |
| [anc95/ChatGPT-CodeReview](https://github.com/anc95/ChatGPT-CodeReview) | 4,467 ✅ | JavaScript | ISC | Probot App/Action | LLM 逐文件 | 提示词 | PR 评论 | 部署简单；也是"纯提示词评审"噪声问题的反例 ⚠️(基于通用认知) |
| [kodustech/kodus-ai](https://github.com/kodustech/kodus-ai) | 1,423 ✅ | TypeScript | AGPLv3 ✅(README 徽章) | 可自托管平台 | LLM（BYOK） | "Kody Rules"：自然语言规则，按组织/仓库/路径作用域 | PR 评论、成本追踪 | 自然语言规则 + 作用域；BYOK 零加价 |
| [villesau/ai-codereviewer](https://github.com/villesau/ai-codereviewer) | 1,041 ✅ | TypeScript | MIT | GitHub Action | LLM | 提示词 | PR 评论 | 最小可用 Action 形态 |
| [devagrawal09/jev-review](https://github.com/devagrawal09/jev-review) | 639 ✅ | TypeScript | MIT | 脚本 + 本地看板 | **Jev**（分阶段判断） | 代码内置维度/机制词表 | JSON + 本地看板 | 已验证 Jev 评审的问题设计：结构化 instructions、hunk 候选 Choice + noMatch |

> Star 来源：GitHub Search API（2026-09-29 抓取）。`qodo-ai/pr-agent` 在搜索中未出现，PR-Agent 当前仓库为 `The-PR-Agent/pr-agent`，其 README 称其为 Qodo 捐赠给社区的遗留项目、"不是 Qodo 免费版" ✅（[README](https://github.com/The-PR-Agent/pr-agent)）。

---

## 2. alibaba/open-code-review 深度拆解

来源：仓库 [README](https://github.com/alibaba/open-code-review)、[架构文档](https://github.com/alibaba/open-code-review/blob/main/pages/src/content/docs/en/architecture.md)、[规则文档](https://github.com/alibaba/open-code-review/blob/main/pages/src/content/docs/en/review-rules.md)、[CI 文档](https://github.com/alibaba/open-code-review/blob/main/pages/src/content/docs/en/integrations/ci.md)、[委托模式](https://github.com/alibaba/open-code-review/blob/main/pages/src/content/docs/en/integrations/delegate.md)、[Agent Skill](https://github.com/alibaba/open-code-review/blob/main/pages/src/content/docs/en/integrations/agent-skill.md)、[CLI 参考](https://github.com/alibaba/open-code-review/blob/main/pages/src/content/docs/en/cli-reference.md)、[会话查看器](https://github.com/alibaba/open-code-review/blob/main/pages/src/content/docs/en/viewer.md)。官网文档 open-codereview.ai/docs 与仓库 `pages/src/content/docs/` 同源。

### 2.1 基本信息 ✅
- Go 实现，Apache-2.0，42k★，2026-05 创建；npm 包 `@alibaba-group/open-code-review`（按平台拆分的二进制子包 `npm/darwin-arm64` 等），命令 `ocr`。
- 自述在阿里内部服务数万开发者两年；提供 AACR-Bench 基准（50 仓库、200 PR、10 种语言、1,505 条人工标注问题），称相同模型下 Precision/F1 高于通用 Agent，token 约 1/9，**Recall 更低是刻意取舍**（精确优先）。

### 2.2 架构：确定性工程 × Agent 混合 ✅
README 直指通用 Agent 做评审的三大痛点：**覆盖不全**（大改动时"偷懒"跳文件）、**位置漂移**（行号对不上）、**质量不稳**（提示词微调导致波动）。根因是"纯语言驱动缺少硬约束"。

流水线（`internal/agent/`）：
```
bootstrap → diff provider → filter & rules → semantic grouping → subtask dispatch(plan? → main loop × rounds) → output writer(行号解析 + 反思过滤)
```
- **Diff Provider**（`internal/diff/git.go`）：三种模式 Workspace（staged+unstaged+untracked）/ Commit（`git show`）/ Range（`merge-base(a,b)..b`）；上下文行固定 3；未跟踪文件视为全量新增。要求 Git ≥ 2.41。
- **六道文件过滤闸门**（`selection.go`）：binary → secret_exclude（内置密钥路径，不可被 include 覆盖）→ user_exclude → user_include（旁路后续闸门）→ unsupported_ext（扩展名白名单）→ default_path（测试文件、依赖/构建目录）。之后再按 `deleted`、`too_large`（diff 超过 max_tokens 80%）剔除。`--preview` 不花 token 即可看过滤结果。
- **语义分组**：一次 LLM 调用只看文件元数据（路径、状态、增删行数），把相关文件分到一组（≤10 文件/组），失败则回退一文件一组——"尽力优化，绝不成为正确性闸门"。
- **每组子 Agent**：并发默认 8；可选 Plan 阶段（单文件改动 ≥50 行或多文件合计 ≥100 行时触发），Main 循环为工具调用循环（最多 100 轮、连续 3 轮无效即停）；`--effort low/medium/high` 对应 1/2/3 轮评审，后续轮注入已确认结论提高召回。
- **记忆压缩**：60% 阈值异步压缩、80% 同步压缩，冻结区/压缩区/活跃区三段式。
- **评论后处理**：① 用 `existing_code` 滑窗匹配 diff 得到精确 `start_line/end_line`（失败则为 0 = 未锚定）；② 可选 `RE_LOCATION_TASK` 让模型重新锚定；③ `REVIEW_FILTER_TASK` 反思过滤"可证伪的错误评论"；④ 二次行号解析；⑤ 渲染。
- **Token 预算守卫**：请求前 80% 阈值 fail-fast；`--max-tokens-budget` 全局上限，超预算时部分结果照常发布。
- **持久化**：`~/.opencodereview/sessions/<repo>/<id>.jsonl` 追加式事件日志，支持 `--resume`。

### 2.3 规则引擎与各语言规则集 ✅
- 四层优先级：`--rule` > `<repo>/.opencodereview/rule.json` > `~/.opencodereview/rule.json` > 内置 `system_rules.json`；**首个匹配的 glob 胜出**；`merge_system_rule: true` 可与内置规则合并。
- 规则文件：`include`（旁路默认排除，不是白名单）、`exclude`、`rules: [{path, rule, merge_system_rule}]`，glob 用 doublestar，大小写不敏感。
- 内置规则文本位于 `internal/config/rules/rule_docs/*.md`，覆盖 60+ 文件类型（go/java/python/ts_js_tsx_jsx/rust/kotlin/cpp/php/…，以及 `pom.xml`、`package.json`、GitHub workflow、MyBatis mapper XML、Terraform、Solidity 等）。`.m` 文件还做内容嗅探区分 MATLAB/Objective-C。
- 规则文本风格（以 `go.md` 为例）：开头明确 **"Favor precision over recall"**、要求"非局部结论先用工具取证"、"不重复 go vet / staticcheck / 编译器能确定的问题"；正文是按主题分组的**原子检查项**（错误处理、nil/接口、context/goroutine、锁与 channel、资源生命周期、数值边界、安全边界、测试范围）。**这种原子化检查项天然适合改写为 Jev 的 Noul 问题。**
- `ocr rules check <path>` 展示哪一层、哪个 pattern 胜出——可解释性好。

### 2.4 行级评论映射 ✅
评论不信任模型给的行号，而是用模型复述的 `existing_code` 在 diff 中滑窗匹配 → 失败再让模型重定位 → 仍失败则 `start_line=0` 作为"未锚定"信号，由 CI 脚本折叠进汇总评论。
**对 Kestrel 的启示**：Jev 不能输出文本，但可以**在真实行号集合上做 Choice**（最多 255 个选项），因此定位天然"不会漂移"——候选集就是 diff 中真实存在的行。

### 2.5 Skill / 插件打包 ✅
- `skills/open-code-review/SKILL.md`（frontmatter：name/description/license/compatibility/metadata），通过 `npx skills add alibaba/open-code-review --skill open-code-review` 安装；另有 `open-code-review-delegate` 技能。
- Claude Code：仓库根 `.claude-plugin/marketplace.json` 指向 `plugins/open-code-review/claude-code`，其中 `.claude-plugin/plugin.json` 声明 `"commands": "./commands"`，`commands/review.md` 为斜杠命令（三步：运行 `ocr review --audience agent` → 按 High/Medium/Low 过滤 → 自动修复）。安装：`/plugin marketplace add alibaba/open-code-review` + `/plugin install open-code-review@open-code-review`。
- Codex：`plugins/open-code-review/.codex-plugin/plugin.json`（`skills: "./skills/"`、`interface.displayName/defaultPrompt/capabilities` 等），`codex plugin marketplace add alibaba/open-code-review`；根目录另有 `.agents/plugins/marketplace.json`。
- Cursor：`plugins/open-code-review/.cursor-plugin/plugin.json`（`skills: "../skills/"`），复制到 `~/.cursor/plugins/local/`。
- 还支持 Kimi Code（`.kimi-plugin/plugin.json`）、OpenCode（TS 插件）、QCA Forward。
- ⚠️ 各 Agent 插件清单的**官方规范**本次未逐一核实，Kestrel 设计中直接沿用 OCR 已验证可用的目录布局。

### 2.6 委托模式（Delegation Mode）✅
`ocr delegate preview`（列出可评审文件与 ref 元数据）+ `ocr delegate rule <paths>`（按规则内容分组返回规则），**OCR 不调用任何 LLM**，由宿主 Agent（Claude Code/Codex/Cursor 的订阅额度）完成评审。
**对 Kestrel 的启示**：宿主 Agent 本身就是"可选 LLM"——Kestrel 负责快速、可校准的判断与定位，宿主 Agent 负责写解释与修复，无需额外 LLM Key。

### 2.7 CI 集成 ✅
- GitHub Action（`action.yml` 复合 Action，`uses: alibaba/open-code-review@main`）：`pull_request_target` + `/open-code-review` 评论触发；range 模式 `--format json --audience agent`；解析 JSON 用 PR Review API 批量内联评论，无行号的折叠进汇总；批量失败回退逐条。输入项包括 `sticky_summary`、`incremental`（IoU 重叠阈值去重）、`route_severity_below`、`checkpoint_range`（跨 push 只评审增量）等。
- 文档强调：PR 可控值通过 `env:` 传入而非 `${{ }}` 直接插值（防 shell 注入）；range 模式需要 `fetch-depth: 0`。
- GitLab CI、Gerrit、Bitbucket、GitFlic、Codeup 均有示例脚本。SARIF 可上传 Code Scanning。

### 2.8 配置、会话查看器、其他 ✅
- 配置：`ocr config provider/model` 交互式；支持 Anthropic / OpenAI Chat / OpenAI Responses / Bedrock；环境变量与 rc 文件分层；`ocr llm test` 连通性测试。
- JSON 信封：`status/llm/summary/comments[]/warnings/session_id/resume`；评论字段 `path/content/start_line/end_line/existing_code/suggestion_code/thinking`，Skill 中另提到 `severity`（critical/high/medium/low）与 `category`。
- 会话查看器 `ocr viewer`：内嵌 HTTP 服务读 JSONL，默认 `localhost:5483`，有 DNS rebinding 防护（Host 白名单），可标记评论为已修复/忽略。
- OpenTelemetry 遥测，**不附带提示词/响应内容**。

### 2.9 优缺点
- 优点：工程化程度极高；精确优先；可解释（preview、rules check）；分发与集成最完整。
- 局限：每次评审仍需大量 LLM token（虽然已是通用 Agent 的 1/9）与分钟级耗时（示例 `1m12s`）；召回偏低是取舍；质量依赖所选 LLM。

---

## 3. 其他工具要点

### 3.1 PR-Agent（The-PR-Agent/pr-agent）✅
- 工具即命令：`/describe`、`/review`、`/improve`、`/ask`，**每个工具一次 LLM 调用**（README 称约 30 秒）。支持 GitHub/GitLab/Bitbucket/Azure DevOps/Gitea，经 LiteLLM 支持大量模型。
- **PR 压缩策略**（[docs](https://github.com/The-PR-Agent/pr-agent/blob/main/docs/docs/core-abilities/compression_strategy.md)）：按仓库主语言排序文件；大 PR 时优先新增而非删除（删除文件合并成列表，删掉纯删除 hunk）；用 tiktoken 计 token 按预算装填，剩余文件只列名。
- **动态上下文**（[docs](https://github.com/The-PR-Agent/pr-agent/blob/main/docs/docs/core-abilities/dynamic_context.md)）：非对称上下文（前多后少），按封闭函数/类动态扩展，避免"大海捞针"。
- **Self-reflection**（[docs](https://github.com/The-PR-Agent/pr-agent/blob/main/docs/docs/core-abilities/self_reflection.md)）：第二次调用让模型给每条建议打 0–10 分并重排，0 分剔除，可设阈值。——**这恰好是 Jev 的强项（Score + 校准概率），而且便宜两个数量级。**
- 缺点：单次调用 + 自评分仍依赖 LLM 生成与解析；自评分未校准。

### 3.2 CodeRabbit（SaaS）✅
- `.coderabbit.yaml`：`reviews.path_filters`（`!` 排除，排除优先）、`reviews.path_instructions`（按 glob 给出自然语言审查指令）、ast-grep 规则、Code Guidelines（自动读取 `AGENTS.md`、`.cursorrules`）、Custom checks（通过/失败条件）（[docs](https://docs.coderabbit.ai/guides/review-instructions)）。
- 集成 50+ 第三方工具（ESLint、Ruff 等）在沙箱运行，按仓库文件类型自动启用；存在工具配置文件则原样使用（[docs](https://docs.coderabbit.ai/tools/)）。
- 画像 `chill` / `assertive` 控制严格程度。
- 详尽的**默认忽略路径清单**（lock 文件、生成代码、二进制、压缩包、媒体、hash 命名的构建产物等）。
- 缺点：闭源、SaaS，代码需上传。

### 3.3 reviewdog ✅
- 不做分析，只做"把任意 linter 结果贴到 PR 上"：输入支持 errorformat、RDFormat（rdjson/rdjsonl）、diff、checkstyle、SARIF（[README](https://github.com/reviewdog/reviewdog)）。
- `-filter-mode`：`added`（默认，仅新增/修改行）、`diff_context`、`file`、`nofilter`；GitHub Review API 不支持 diff 外评论，自动回退到 Check annotation。
- 启示：**只对新增行负责**是降低噪声的关键；统一诊断格式让"静态工具 → 评审"解耦。

### 3.4 Danger JS ✅
- "Formalize your Pull Request etiquette"：在 CI 中执行 dangerfile，用代码表达团队约定（如强制 CHANGELOG、PR 描述带工单链接、特定文件变更时警告）。
- 启示：**PR 级别的元规则**（描述是否匹配、是否缺测试、是否改了敏感文件）是很好的补充——其中"描述是否匹配变更"这类语义判断可以交给 Jev Noul。

### 3.5 Semgrep 规则模型 ✅
- YAML 规则必填 `id/message/severity/languages/pattern*`，可选 `fix/metadata/paths/options/min-version`；严重度现为 `LOW/MEDIUM/HIGH/CRITICAL`（兼容旧 `INFO/WARNING/ERROR`）；消息中可插值元变量（如 `$X`）（[docs](https://semgrep.dev/docs/writing-rules/rule-syntax)）。
- 规则测试：在示例代码里用 `# ruleid:` / `# ok:` 注释标注期望。
- 启示：**规则即数据 + 规则自带正反例测试 + 消息模板插值** → Kestrel 规则 YAML 直接借鉴。

### 3.6 SonarQube ✅
- Quality Gate 由若干条件组成，"Sonar way" 四个条件：无新问题、新 Security Hotspot 全部复核、新代码覆盖率 ≥80%、新代码重复率 ≤3%（[docs](https://docs.sonarsource.com/sonarqube-server/2026.2/quality-standards-administration/managing-quality-gates/introduction-to-quality-gates)）。
- 启示：**合并闸门应只看新代码、由可配置条件在代码中判定**，而不是让模型"拍板"。

### 3.7 Claude Code Security Review ✅
- GitHub Action，diff-aware（只看变更文件），**独立的误报过滤阶段**（`findings_filter.py`），可提供自定义 false-positive filtering 指令（[README](https://github.com/anthropics/claude-code-security-review)）。
- 启示：误报过滤是独立阶段 —— 在 Kestrel 中用 Jev 的"反证守卫"（guard Nouls）实现，便宜且可校准。

### 3.8 Kodus（kodus-ai）✅
- 自托管、模型无关（BYOK，零加价）；"Kody Rules" 用自然语言写规则，作用于组织/仓库/路径；成本追踪面板（[README](https://github.com/kodustech/kodus-ai)）。许可证 AGPLv3（README 徽章）。
- 启示：**自然语言规则 → 编译为 Jev Noul** 在 Kestrel 中极其自然（团队写一句话即可成为一条可校准的检查）。

### 3.9 devagrawal09/jev-review（Jev 评审先例）✅
- 分阶段：Noul 风险矩阵（correctness/security/reliability/compatibility/testGap）→ Choice+Score 文件画像 → Choice 证据 hunk 选择（带 `noMatch`）→ Choice 机制分类 → Score 严重度 → 条件路由；阈值在代码里（如 `SCREEN_THRESHOLD=0.7`、`BLOCKING_SEVERITY=2`、`MIN_LOCATION_CONFIDENCE=0.55`）（[README](https://github.com/devagrawal09/jev-review)、[judgments.ts](https://github.com/devagrawal09/jev-review/blob/main/src/review/judgments.ts)、[config.ts](https://github.com/devagrawal09/jev-review/blob/main/src/domain/config.ts)）。
- 问题写法：`instructions` 使用对象 `{question, inspect: "file.patch", focus, ignore}`，`criteria.true/false` 带 `what/examples/not_for`——与 TypeSafe 文档"结构化 instructions"建议一致。
- 自述局限："尚未集成编译器诊断、静态分析、仓库索引或生成式解释；发现只是评审提示，不是缺陷证明"；仅支持 JS/TS 文件模式。

---

## 4. Jev（TypeSafe System One）事实核查

| 事实 | 状态 | 来源 |
|---|---|---|
| 2026-09-15 发布，TypeSafe 首个 System One 模型；不生成文本 | ✅ | [发布博客](https://typesafe.ai/blog/introducing-system-one-models-and-jev)、[jev-explained](https://systemonemodels.org/guides/jev-explained/) |
| 输入 `state`（字符串/对象/数组，纯文本）+ 命名的 typed `questions`；三种题型 Choice / Score / Noul | ✅ | [API 参考](https://docs.typesafe.ai/api.md) |
| Choice 返回 `choice/probabilities/confidence`，最多 255 个选项 | ✅ | API 参考 |
| Score 返回 `score/legend/probabilities/confidence`，2–10 级（API 接受 ≤10） | ✅ | API 参考 |
| Noul 返回 `noul`（0–1 为"是"的概率），无单独 confidence | ✅ | API 参考 |
| 所有问题一次请求并行、相互隔离地评估；加题几乎不增加延迟 | ✅ | [文档首页](https://docs.typesafe.ai/) |
| 延迟 70–500ms；输入 $0.042/MTok，输出免费 | ✅ | 发布博客、[Models](https://docs.typesafe.ai/models.md) |
| 端点 `POST https://api.typesafe.ai/v1/systemone`，`Authorization: Bearer`；错误码 401/422/429/529 | ✅ | API 参考 |
| 模型 `jev-1.13.0`；别名 `jev-latest`、`jev-preview` 目前都指向它；调好阈值后应锁定版本号 | ✅ | Models |
| 限流 250,000 tok/s、1,200 req/min，且"会随时动态调整" | ✅ | Models |
| 上下文：每请求 64k（state+全部问题）；state+最长单题 32k | ✅ | Models |
| 英文效果最好，其他语言（含中日韩）可用但较弱 | ✅ | Models |
| 不用客户数据训练；ZDR 仅面向企业客户 | ✅ | Models |
| SDK：`typesafe-sdk`（Python ≥3.10）、`@typesafe-ai/sdk`（Node ≥20，v0.6.0）；读 `TYPESAFE_API_KEY`，另支持 `TYPESAFE_BASE_URL`、`TYPESAFE_DEFAULT_MODEL`、`TYPESAFE_LOG_LEVEL`，可注入自定义 `fetch` | ✅ | [JS SDK](https://docs.typesafe.ai/sdk/javascript.md)、[types.ts@v0.6.0](https://github.com/typesafe-ai/typesafe-sdk-js/blob/v0.6.0/src/types.ts) |
| JS SDK 的 `debug` 日志级别会打印请求体（凭证头会脱敏，body 不会） | ✅ | types.ts 注释 |
| Jaggedness（jev-1.13 已知弱点）：字面理解、数学/计数、日期比较、多跳间接、无关上下文导致准确率下降（context rot）、对抗性内容、指令与判据矛盾、结构不变量不保证（Noul 与 Choice 阈值不可互换）、不能生成 | ✅ | [jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md) |
| 访问方式：dev.to（9/17）称候补名单；systemonemodels.org（9/22 更新）称 9/20 已取消候补 | ⚠️ 来源矛盾 | [dev.to](https://dev.to/valyuai/how-to-use-jev-a-practical-guide-to-typesafes-system-one-model-g5e)、jev-explained |
| PyPI 上的 `jev` 包（v0.3.0）是**第三方**装饰器库（`@jev.fn`），不是官方 SDK；官方 Python SDK 为 `typesafe-sdk` | ✅ | [pypi.org/project/jev](https://pypi.org/project/jev/) |
| Choice 的 confidence 公式：文档交互组件中为 `(n·p_max − 1)/(n − 1)` | ⚠️ 取自文档页的演示组件源码，非正式规范 | [Confidence](https://docs.typesafe.ai/confidence.md) |
| 自报评测：workflow evals 67.8%，与 GPT-5.6 Terra 持平；参考答案是两款前沿模型均值，非 ground truth，自测未复现 | ✅（仅代表 TypeSafe 自报） | 发布博客、dev.to |

---

## 5. 值得借鉴的经验（映射到 Kestrel）

| # | 经验 | 来自 | Kestrel 中的落地 |
|---|---|---|---|
| L1 | 确定性工程负责"不能出错"的步骤 | OCR | 文件选择、规则匹配、候选行、阈值、闸门、计数全部在代码中 |
| L2 | 精确优先，召回其次 | OCR、go.md | 默认 `balanced` 画像阈值偏高；低置信结果折叠而非发出 |
| L3 | 六道过滤闸门 + 密钥路径保护 + `--preview` | OCR | 原样借鉴（加上 CodeRabbit 默认忽略清单） |
| L4 | 分层规则 + 首个匹配胜出 + `rules check` | OCR | 规则包分层：CLI > 项目 > 全局 > 插件内置；`kestrel rules check` |
| L5 | 原子化检查项 | OCR rule_docs | 每条检查项 = 一个 Noul（+ 反证守卫 + 严重度 Score） |
| L6 | 位置不信任模型，外部定位 | OCR | 用 Choice 在真实新增行上选证据行 → 零漂移 |
| L7 | 反思/自评分过滤 | OCR、PR-Agent、CCSR | guard Nouls + 严重度 Score，校准概率直接做阈值 |
| L8 | 压缩与动态上下文 | PR-Agent | 只送 hunk + 封闭函数（tree-sitter）+ 必要 import，控制 context rot |
| L9 | 只评审新增行 | reviewdog、Sonar | 默认 `filter: added`；闸门只看新代码 |
| L10 | 静态工具结果统一接入 | reviewdog、CodeRabbit | 读取 SARIF → Jev 做误报过滤与严重度分级 |
| L11 | 路径级自然语言指令 | CodeRabbit、Kodus | `checks:` 配置：一句话 → 编译成 Noul |
| L12 | 规则自带正反例测试 | Semgrep | 规则 YAML 的 `examples.positive/negative`；`kestrel rules test` |
| L13 | 闸门由条件判定 | SonarQube | `gate:` 配置在代码中判定 approve/comment/request_changes |
| L14 | 委托模式 | OCR | Skill 中由宿主 Agent 负责写解释/修复，Kestrel 只给判断与定位 |
| L15 | 分发四件套 | OCR | npm + Skill + Claude/Codex/Cursor 插件 + GitHub Action |
| L16 | CI 安全细节 | OCR | env 传参、fetch-depth 0、`pull_request_target` 下不执行 PR 代码 |
| L17 | 可观察、可解释 | OCR viewer、jev-review | JSON 中保留每个问题的概率/置信度/模型版本；`kestrel explain` |
| L18 | Jev 问题写法 | TypeSafe 文档、jev-review | 英文、结构化 instructions（question/inspect/focus/ignore），criteria 与指令一致，提供 `none/other` 选项 |
