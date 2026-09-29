# 02 · 产品构思：Kestrel —— 用"快思考"做代码评审的判决

> 名称：**Kestrel**（红隼：悬停快速扫视、只对确认目标俯冲，见 §4）。CLI 命令 `kestrel`，npm 包 `kestrel-review`，仓库 `lpliu-art/kestrel`。
> 一句话：**把代码评审编译成成百上千个可校准的"是/否/选哪个/打几分"小判断，由 Jev 在一秒内全部答完，再由代码组织成确定性的评审结论与评论。**

---

## 1. 出发点：先想清楚约束

### 1.1 Jev 能做什么、不能做什么（设计的"物理定律"）

| Jev 的能力（来自官方文档） | 对评审的含义 |
|---|---|
| 给定 `state` 与多个 typed 问题，一次并行返回 Choice/Score/Noul + 校准概率 | 可以对**每个 hunk × 每条规则**问"是否违反"，一次请求问几十题 |
| 70–500ms，$0.042/MTok，输出免费 | 一次 PR 评审成本约为几分之一美分，可对**每次 push、每次保存**运行 |
| 校准：置信度高 ⇒ 准确率高 | 阈值有意义，可按规则/按动作设置不同阈值（报告 / 折叠 / 丢弃 / 阻塞） |
| Choice 最多 255 个选项 | 可以在 diff 的**真实行号**中选"证据行"——定位不会漂移 |
| 不会返回 schema 外的值 | 无 JSON 解析失败、无"幻觉的行号/文件名" |

| Jev 的限制 | 设计上的应对 |
|---|---|
| **不能生成任何文本/代码** | 评论正文来自规则目录中的**确定性模板**；可选 LLM 仅为"已被 Jev 判定"的少数条目写解释/修复建议 |
| 不会计数、算术、比较日期 | 计数、阈值组合、风险分数全部在代码里算 |
| 字面理解、怕多跳间接 | 每题只问一件事，直接点名 state 字段（如 `` `hunk.added` ``），判据与指令同向 |
| 无关上下文会降低准确率（context rot） | state 只放 hunk + 封闭函数 + 必要 import，不塞整文件 |
| state 中的对抗性内容会影响答案 | 代码注释中的"此处安全"之类说辞不算证据；增设"是否包含针对自动评审的话术"检测题；Jev 永远不能单独放行 |
| Noul 与 Choice 的阈值不可互换，结构不变量不保证 | 每个问题独立设阈值，不用 `p(x)+p(¬x)=1` 之类假设 |
| 英文效果最好 | 所有问题/判据用英文；输出模板多语言（中/英） |
| 上下文 64k / 32k | 按 hunk 切分请求；超长 hunk 切窗 |
| 闭源托管 API、限流会变化、别名会漂移 | 抽象 Provider；默认锁定 `jev-1.13.0`；内置限流器与缓存；提供 mock/replay 离线模式 |

### 1.2 用户想要什么
原始需求："调研 GitHub 上流行的代码评审工具（如阿里 open-code-review），借鉴其实现思路和经验，用 Jev 做一个开源评审工具（skill + CLI），多语言支持、每种语言一个插件，先支持主流前后端语言。"

拆解出的硬性目标：
- G1 **Jev 是核心**，不是装饰。
- G2 **Skill + CLI** 两种形态（本地 Agent 内调用、终端/CI 调用）。
- G3 **语言插件化**，首批 JS/TS、Python、Java、Go（+ React/Vue 特化，后续 Rust、C#）。
- G4 借鉴 OCR 等成熟工具的工程经验。
- G5 开源、可测试：**无 Jev Key 时也能跑（mock/离线）**。

---

## 2. 反复推演：三个候选构思

### 构思 A："OCR + Jev 预筛"（LLM Agent 为主，Jev 为辅）
- 做法：沿用 OCR 式 LLM Agent 评审，Jev 只用来挑选需要评审的文件、给 LLM 的评论做误报过滤。
- 优点：评论质量上限高（LLM 能写出自由推理）；工程路径成熟。
- 致命问题：
  1. **LLM 仍是必需品**，成本、耗时（分钟级）、位置漂移、提示词不稳定等 OCR 在解决的问题依旧存在；
  2. Jev 只是"省点钱的前置过滤器"，违背 G1；
  3. 离线/无 Key 模式几乎做不了（核心依赖 LLM）。
- 结论：❌ 这是"又一个 LLM 评审工具"，没有差异化。

### 构思 B："Jev 版 reviewdog"（只给静态分析结果做判官）
- 做法：运行 ESLint/Ruff/golangci-lint/Semgrep 等工具，Jev 只负责"这条告警在本次变更中是否真的重要"与严重度分级，过滤后贴到 PR。
- 优点：零幻觉、极快、极便宜；评论文本天然来自工具消息（确定性）。
- 问题：
  1. **召回上限 = 静态工具的能力**，语义类问题（逻辑写反、授权检查被删、错误被吞、竞态、兼容性破坏）完全无法发现；
  2. 用户价值更像"降噪器"，而不是"评审者"；
  3. 多语言插件只是 linter 适配层，G3 的价值被削弱。
- 结论：⚠️ 作为**一个阶段**很好（我们保留它：静态告警误报过滤），但不足以成为产品本身。

### 构思 C："规则即问题"（Rules-as-Questions）的 System One 评审器 ✅
- 做法：把评审知识（OCR 的原子化检查项、Semgrep 式规则、团队自然语言约定）**编译成 Jev 的 typed 问题**；由确定性代码决定"对哪个 hunk 问哪些题"，Jev 并行作答，代码按校准概率决策；评论由规则目录中的模板渲染；证据行由 Jev 在真实行号上 Choice 选出。LLM 完全可选、只做"润色与修复建议"，且其输出**再由 Jev 复核**。
- 优点：
  1. Jev 做的正是它最擅长的事：大量窄判断、校准概率、类型安全、便宜、快；
  2. 评论文本确定、可审计、可本地化；定位零漂移；
  3. 规则是数据（YAML），语言插件 = 规则包 + 解析/上下文提取器 + 静态工具适配器，G3 自然成立；
  4. 无 Key 时用 mock/replay Provider 跑完整流水线（输出明确标注"非 AI 判断"），满足 G5；
  5. 在 Skill 中，宿主 Agent（Claude Code/Codex/Cursor）天然就是那个"可选 LLM"——Kestrel 给出判断与位置，宿主 Agent 负责解释与修复（借鉴 OCR 委托模式）。
- 风险与缓解：
  - 召回受规则覆盖度限制 → 语义规则（trigger=always）+ 维度级风险题（correctness/security/…）兜底；"高风险但无规则命中"的 hunk 进入"需要人工/LLM 深审"清单，而不是沉默；
  - 模板评论可能显得"生硬" → 模板带插槽（符号名、行号、规则理由、修复提示），可选 LLM 润色；
  - 规则问题写不好会导致误判 → 规则自带正反例，`kestrel rules test` 用 mock 与真实 Jev 做回归与阈值校准。
- 结论：✅ **选定。**

### 为什么 C 胜出（评分）

| 维度（权重） | A: LLM+Jev预筛 | B: Jev 版 reviewdog | C: 规则即问题 |
|---|---|---|---|
| 符合 Jev 能力边界（0.25） | 2 | 5 | 5 |
| 发现问题的广度（0.20） | 5 | 2 | 4 |
| 可信度（定位/误报/可解释）（0.20） | 3 | 5 | 5 |
| 成本与速度（0.15） | 2 | 5 | 5 |
| 离线可测、开源友好（0.10） | 1 | 4 | 5 |
| 插件化自然程度（0.10） | 3 | 3 | 5 |
| **加权合计（满分 5）** | **2.75** | **4.05** | **4.80** |

> 评分为设计团队主观评估，用于记录取舍理由，不是实验数据。

### 第二轮推演：C 的内部取舍
1. **每题一请求 vs 一 hunk 一请求？** Jev 并行作答、加题几乎不加延迟，且官方 cookbook 称批量提问比逐个提问便宜 12.2 倍、快 10 倍（TypeSafe 自报）。→ **一个 hunk（或一个 hunk 窗口）一次请求，打包该 hunk 适用的全部规则题**（"推测式扇出"）。
2. **一个请求里放多个 hunk？** 会引入"hunks[3] 里是否…"的间接引用，Jev 怕多跳间接，且 context rot。→ **不放**，除非是同一函数内相邻的小 hunk（合并为一个窗口）。
3. **定位：让 Jev 选行 vs 用 trigger 节点？** 有确定性候选（regex/tree-sitter 捕获）时直接用；语义规则（无候选）用 Choice 在新增行 ID 上选，外加 `none` 选项；`none` 胜出或置信度低 → 该发现降级为"hunk 级"评论。
4. **严重度：规则写死 vs Jev 打分？** 两者结合：规则给出**严重度上限/下限**与级别语义，Jev 用 Score 在范围内定档（如"影响是否可被外部输入触发"）。
5. **合并闸门：Jev 拍板 vs 代码判定？** **代码判定**（Sonar 式条件），Jev 只提供概率输入。Jev 永远不能单独"批准"——`approve` 的语义是"未发现阻塞问题"，而非"代码安全"。
6. **LLM 放在哪？** 只在两个位置、且都可关闭：(a) 为已判定的发现写更自然的解释与修复建议；(b) 可选的"LLM 探索 → Jev 复核"模式（LLM 自由提出疑点，Jev 以 Noul 判断"该疑点是否被 hunk 直接支持"，把 PR-Agent 的 self-reflection 换成校准判官）。
7. **离线/mock 怎么做才不自欺？** mock Provider 基于规则的 trigger 与正反例启发式给出确定性概率，输出中 `provider: mock` 且终端/评论显式标注"MOCK 结果，仅用于测试"；replay Provider 回放录制的真实响应用于回归测试。

### 第三轮推演：和 Jev 真实能力的矛盾检查（自查清单）
| 可能的矛盾 | 检查结论 |
|---|---|
| "让 Jev 生成修复建议" | ❌ 不允许。修复建议只来自：规则模板里的 `fix.hint`、规则的确定性 autofix（tree-sitter 替换）、或可选 LLM。 |
| "让 Jev 总结 PR" | ❌ 不允许。PR 摘要由代码拼装（文件列表、风险分布、命中规则计数）+ 可选 LLM。 |
| "问 Jev 这个 PR 有几个问题" | ❌ 计数在代码中完成。 |
| "Jev 读整个仓库找调用点" | ❌ Jev 不检索。上下文由代码检索（tree-sitter、git grep）后放入 state。 |
| "用 Jev 的 Noul 阈值直接套到 Choice 上" | ❌ 每题独立阈值。 |
| "Jev 判定为安全即放行" | ❌ 放行只意味着"无阻塞发现"；并有 prompt-injection 检测题。 |
| "中文规则问题" | ⚠️ 问题一律英文；中文仅用于模板输出。 |
| "Jev 的 confidence 适用于 Noul" | ❌ Noul 没有 confidence 字段，概率本身即信念；Choice/Score 才有 confidence。 |

---

## 3. 最终构思

### 3.1 定位
**Kestrel 是一个"System One 代码评审器"**：像资深评审者的"第一眼直觉"——在 1–3 秒内扫完整个 diff，对每处改动给出"哪里可能有问题、多可能、多严重、证据在哪一行"，并给出合并判决建议；需要"慢思考"的地方，明确交给人或（可选的）LLM/宿主 Agent。

### 3.2 核心概念词汇
| 概念 | 含义 |
|---|---|
| **Review Unit（评审单元）** | 一个 hunk（或合并后的 hunk 窗口）+ 其上下文（封闭函数、import、文件元信息） |
| **Rule（规则）** | 一条原子检查：适用范围 + 触发器（trigger）+ 主问题（Noul）+ 反证守卫（guards）+ 严重度量表（Score）+ 模板 + 正反例 |
| **Dimension（风险维度）** | correctness / security / reliability / performance / compatibility / maintainability / test-gap 的维度级 Noul，用于分诊与兜底 |
| **Check（团队检查）** | 配置中用一句英文写的路径级约定，自动编译为 Noul 规则 |
| **Finding（发现）** | 通过阈值的规则命中：规则 id、概率、严重度、证据行、渲染后的评论 |
| **Band（置信带）** | report（发出）/ uncertain（折叠展示）/ drop（丢弃），按画像与规则阈值划分 |
| **Verdict（判决）** | approve（未发现阻塞问题）/ comment / request_changes，由闸门条件在代码中判定 |
| **Provider** | Jev 访问抽象：typesafe（官方 SDK）/ http（自定义网关）/ mock / replay |
| **Narrator（可选）** | OpenAI/Anthropic 兼容 LLM，仅为已判定发现写解释与修复，输出再由 Jev 复核 |

### 3.3 一次评审发生了什么（用户视角）
```
$ kestrel review --from main
✔ 12 files changed · 9 reviewable · 3 skipped (lockfile, generated, test)
✔ 41 review units · 2 Jev passes (46 requests, 3 cached) · 1.4s · ~$0.008
─────────────────────────────────────────────
✖ HIGH  src/api/user.ts:57  [ts.security.sql-string-concat] p=0.93
  SQL 语句通过字符串拼接构造，`req.query.id` 可能被注入。
  建议：改用参数化查询（如 `db.query('... WHERE id = $1', [id])`）。
⚠ MED   app/service.py:88   [py.reliability.broad-except-swallow] p=0.81
  `except Exception: pass` 吞掉了异常，失败将被静默忽略。
… 2 more (uncertain, collapsed: `--show-uncertain`)
─────────────────────────────────────────────
Verdict: REQUEST_CHANGES (1 blocking: severity≥high & p≥0.80)
Deep-review suggested: src/auth/session.ts (risk 0.88, no rule matched)
```

### 3.4 三种形态
1. **CLI**：`kestrel review/scan/rules/explain/doctor…`，终端 / JSON / SARIF / Markdown / GitHub PR Review 输出。
2. **Skill + Agent 插件**：Claude Code 斜杠命令 `/kestrel:review`、Codex/Cursor 插件、`npx skills add` 通用技能。技能流程：运行 `kestrel review --format json --audience agent` → 宿主 Agent 读取结构化发现 → 对 `report` 带内的发现写解释/按需修复；对"建议深审"清单做慢思考审查。
3. **CI**：GitHub Action（复合 Action），内联评论 + 粘性汇总 + 可选闸门（失败即红）+ SARIF 上传 Code Scanning。

### 3.5 差异化（与 OCR/PR-Agent/CodeRabbit 比）
| | 传统 LLM 评审 | Kestrel |
|---|---|---|
| 单次 PR 成本 | 美分~美元级 LLM token | 约 $0.001–0.01（按 Jev 公开价估算，见 03 文档） |
| 延迟 | 30 秒~数分钟 | 通常 1–3 秒（受限流与 hunk 数影响） |
| 行号定位 | 需外部重定位 | 在真实行号上 Choice，零漂移 |
| 输出稳定性 | 随提示词/采样波动 | 规则+模板确定；Jev 对相似输入输出相似（官方称 consistent） |
| 可解释性 | 自然语言理由 | 每个判断都有问题原文、概率、置信度、模型版本，可 `kestrel explain` |
| 离线测试 | 困难 | mock/replay Provider 全流程可测 |
| 深度推理 | 强 | 弱（System One）→ 显式移交人/LLM/宿主 Agent |

### 3.6 非目标（v1 不做）
- 不做自由文本的 PR 摘要/走查（可选 LLM 除外）。
- 不做跨仓库/全仓库语义索引。
- 不做 IDE 插件（Skill 覆盖 Agent 场景；IDE 留到后续）。
- 不承诺替代人工评审；不自动批准合并。

### 3.7 目标用户与场景
- **个人开发者**：提交前 `kestrel review --staged`，1 秒内拿到提示（可做 git pre-commit/pre-push hook）。
- **Agent 用户**：在 Claude Code/Codex/Cursor 中 `/kestrel:review`，让宿主 Agent 修复高置信问题。
- **团队/CI**：每次 push 评审，粘性汇总 + 内联评论；闸门阻塞高危问题；团队用 `checks:` 一句话沉淀约定。
- **平台/安全团队**：把 Semgrep/ESLint 等工具的告警交给 Jev 做误报过滤与严重度分级，降低告警疲劳。

### 3.8 成功指标（上线后度量）
- 精确率（人工标注 report 带内发现为真阳性的比例）≥ 70%（初期目标，参考 OCR"精确优先"取向）。
- 每 PR 中位耗时 ≤ 3 秒（≤ 50 个评审单元），每 PR 中位 Jev 成本 ≤ $0.01。
- 定位准确率（发现落在正确行 ±2 行）≥ 95%（Choice 在真实行上选择，理论上高）。
- 规则包正反例测试通过率 100%（mock），真实 Jev 回归漂移 ≤ 5%（锁定模型版本时）。

---

## 4. 命名

**最终名称：Kestrel（红隼）**，CLI 命令 `kestrel`，GitHub 仓库 `lpliu-art/kestrel`，npm 包 `kestrel-review`。

- 寓意：红隼以“悬停—俯冲”著称——在高空悬停快速扫视大片区域，只对确认的目标俯冲。这正对应 Kestrel 的工作方式：Jev 对每个 hunk 快速、并行地做风险筛查（悬停扫视），只对高置信的问题出手（俯冲/报告），不确定的保持沉默或标为 uncertain。也与“System One（快思考）”气质吻合。
- 名称不含 “Jev”，避免与 TypeSafe AI 的模型商标产生隶属误解（早期工作名 Jevdict 已弃用）。README 仍需声明“非 TypeSafe AI 官方项目”。

冲突检查（2026-09-29 实测）：

| 渠道 | 名称 | 结果 | 结论 |
|---|---|---|---|
| npm | `kestrel` | **已占用**：“Node.js client for Kestrel”，v0.0.1，最后修改 2022-06，月下载 17，无 `bin` | 不能用作包名 |
| npm | `kestrel-cli` | **已占用**：静态站点托管工具，bin 名为 `swoop`，月下载 229 | 不能用 |
| npm | `kestrel-review` | 404（可用） | ✅ **推荐主包名** |
| npm | `@lpliu-art/kestrel` | 404（可用；作用域需 npm 上存在 `lpliu-art` 用户/组织） | 备选；可作为别名包 |
| PyPI | `kestrel` | **已占用**：多模态推理引擎 v0.8.2 | 本项目不发 PyPI，无影响；如将来需要，用 `kestrel-review`（404，可用） |
| crates.io | `kestrel` | 已占用（精算建模库） | 无影响（不发 Rust crate） |
| GitHub | `lpliu-art/kestrel` | 404（未创建），`lpliu-art` 账号存在 | ✅ 可创建 |
| GitHub | 搜索 “kestrel review” | 9 个仓库，最高 3★（如一个名为 Kestrel 的 Discord 代码评审机器人 `yashay16s-oss/code-explainer`，3★） | 无显著冲突 |

决定与理由：

1. **npm 包名 `kestrel-review`，bin 名 `kestrel`**。`npx kestrel-review` 可直接运行（包只有一个 bin 时 npx 自动选择它）；全局安装后命令为 `kestrel`。现有 `kestrel`/`kestrel-cli` 两个包都不提供名为 `kestrel` 的 bin，故全局命令不冲突。不选作用域包作为主名，是因为 `npx @lpliu-art/kestrel` 较长、不利于传播；可额外发布 `@lpliu-art/kestrel` 作为占位/别名（可选）。
2. 插件 API 子路径导出：`kestrel-review/plugin`；第三方插件命名约定 `kestrel-plugin-<lang>` 或 `@scope/kestrel-plugin-<lang>`。
3. ⚠️ **已知歧义**：“Kestrel” 也是微软 ASP.NET Core 内置 Web 服务器的名字，在 .NET 圈知名度很高，会带来搜索噪声（尤其 C# 插件场景）。缓解：对外统一称 “Kestrel Review” / “kestrel-review”，仓库描述写明 “AI code review CLI”。若认为该歧义不可接受，备选名：**Hoverhawk**、**Snapverdict**、**Onesight**（均未做完整冲突检查 ⚠️）。
