# 04 · 架构图（Architecture）

> 本文所有图均以 Mermaid 源码给出（可在 GitHub 直接渲染），同时已用 `@mermaid-js/mermaid-cli` v11 + headless Chrome 预渲染为 PNG，位于 [`diagrams/`](diagrams/)（`.mmd` 源 + `.png`）。
> 图中术语与 [03-technical-design.md](03-technical-design.md) 一致：Review Unit（审查单元）、Rule-as-Question、Pass 1 / Pass 2、band（report / uncertain / drop）、verdict。

## 0. 一句话架构

**确定性管线负责“看哪里、问什么、怎么说”，Jev 只负责“是不是、有多严重、在哪一行”的判断。** 所有输出文本均来自规则目录的模板（或可选的 LLM 叙述器，且其输出须再经 Jev 校验）。

| 层 | 职责 | 是否调用 Jev |
|---|---|---|
| Intake（git / select / lang） | 取 diff、过滤文件、识别语言 | 否 |
| Plugin & Rules | 加载语言插件与规则包、跑触发器、编译问题 | 否 |
| Units & Security | 切审查单元、拼上下文、脱敏、注入探针 | 否 |
| Judge | Pass 1 筛查、Pass 2 定位、阈值分档、判决 | **是**（唯一出口：`JevProvider`） |
| Narrate（P2，可选） | LLM 写解释/修复建议 → Jev 校验 | LLM + Jev |
| Render / Report / GitHub | 模板渲染、多格式输出、PR 评论 | 否 |

---

## 1. 系统上下文（System Context）

三种入口（开发者终端、宿主编码 Agent 的 skill/命令、CI）共用同一个 CLI。外部依赖只有：本地 Git、TypeSafe Jev API（必需，除 mock/replay 模式）、可选 LLM、GitHub API / Code Scanning（仅 CI 场景）。

```mermaid
flowchart LR
    dev["👩‍💻 Developer<br/>(terminal / git hook)"]
    agent["🤖 Host coding agent<br/>Claude Code · Codex · Cursor<br/>(skill / slash command)"]
    ci["⚙️ CI runner<br/>GitHub Actions"]

    subgraph jd["Kestrel (npm package, Node ≥ 22)"]
        cli["kestrel CLI<br/>review · rules · explain · github post"]
    end

    git[("Local Git repo<br/>diff · merge-base · files")]
    jev["TypeSafe Jev API<br/>POST /v1/systemone<br/>jev-1.13.0"]
    llm["Optional LLM<br/>OpenAI / Anthropic compatible<br/>(narration only)"]
    gh["GitHub REST API<br/>PR reviews · comments"]
    scan["GitHub Code Scanning<br/>(SARIF upload)"]
    tools["Static tools output<br/>ESLint · Ruff · golangci-lint · Semgrep<br/>(SARIF files)"]

    dev -->|kestrel review| cli
    agent -->|"kestrel review --format json --audience agent"| cli
    ci -->|"composite action / npx kestrel-review"| cli
    cli -->|read diff & sources| git
    cli -->|"state + typed questions<br/>(redacted hunks)"| jev
    jev -->|"Choice / Score / Noul<br/>+ calibrated probabilities"| cli
    cli -.->|"flagged findings only<br/>(opt-in)"| llm
    cli -->|inline comments + sticky summary| gh
    cli -->|kestrel.sarif| scan
    tools -.->|"--sarif-in"| cli
    cli -->|"JSON findings → agent writes prose & fixes"| agent
```

![](diagrams/01-system-context.png)

要点：

- **Agent 场景下“写字的是宿主 Agent”**：`--format json --audience agent` 输出结构化发现（规则 id、行号、概率、模板消息、修复提示），由 Claude Code / Codex / Cursor 自身组织语言与修改代码——这恰好弥补 Jev 不生成文本的限制，而无需 Kestrel 自带 LLM。
- 发送给 Jev 的只有**脱敏后的 hunk 窗口 + 有限上下文**，不是整个仓库。
- LLM 虚线表示可选且默认关闭。

---

## 2. 组件图（Components）

```mermaid
flowchart TB
    subgraph CLI["cli/"]
        cmdReview["review"]
        cmdRules["rules list/show/check/test/lint"]
        cmdExplain["explain"]
        cmdGh["github post"]
        cmdDoctor["doctor · config · cache"]
    end

    subgraph Core["Deterministic core"]
        cfg["config/<br/>layered loader + zod schema"]
        gitm["git/<br/>DiffProvider + unified diff parser"]
        sel["select/<br/>6+ file gates · preview"]
        lang["lang/<br/>language detection"]
        units["units/<br/>hunk windows · context · state serializer"]
        sec["security/<br/>secret redaction · injection probe · untrusted mode"]
    end

    subgraph Plug["plugins/"]
        reg["Plugin registry + loader<br/>(explicit list, apiVersion check)"]
        pcore["core"]
        pts["typescript<br/>(+react, +vue packs)"]
        ppy["python"]
        pjava["java"]
        pgo["go"]
        p3["3rd-party<br/>kestrel-plugin-*"]
    end

    subgraph Rules["rules/"]
        rload["rule packs (YAML)<br/>layering & overrides"]
        trig["trigger engine<br/>regex · tree-sitter · always · removed · sarif"]
        comp["question compiler<br/>rule → Noul / Score / Choice"]
        tmpl["template renderer<br/>i18n zh-CN / en"]
    end

    subgraph Jev["jev/"]
        budget["BudgetGuard"]
        cache["Cache<br/>(pinned model only)"]
        limiter["RateLimiter<br/>RPM + tok/s"]
        prov{{"JevProvider"}}
        pTS["TypeSafeProvider<br/>(@typesafe-ai/sdk)"]
        pHttp["HttpProvider"]
        pMock["MockProvider"]
        pReplay["Replay / Recording"]
    end

    subgraph Judge["judge/"]
        pass1["Pass 1: screen"]
        pass2["Pass 2: locate & slots"]
        sfilter["static finding filter (P1)"]
        decide["bands · dedupe · risk · verdict"]
    end

    narr["narrate/ (P2)<br/>LLM narrator + Jev verification"]
    render["render/<br/>terminal · json · sarif · markdown · github"]
    report["report/<br/>schema · session log"]
    ghm["github/<br/>review poster · fingerprints"]

    cmdReview --> cfg --> gitm --> sel --> lang --> units
    lang --> reg
    reg --> pcore & pts & ppy & pjava & pgo & p3
    reg --> rload --> trig
    units --> sec
    units --> trig --> comp --> pass1
    pass1 --> budget --> cache --> limiter --> prov
    prov --> pTS & pHttp & pMock & pReplay
    pass1 --> pass2 --> decide
    sfilter --> decide
    decide --> narr --> render
    decide --> render
    tmpl --> render
    render --> report
    cmdGh --> ghm
    cmdRules --> rload
    cmdExplain --> report
```

![](diagrams/02-components.png)

模块依赖约束（实现时用 lint 规则或目录边界守护）：

1. `jev/` 不依赖任何业务模块；`judge/` 是唯一调用 `JevProvider` 的模块（`narrate/` 通过 `judge/` 暴露的校验函数间接调用）。
2. `plugins/` 只“声明”（语言、规则包、上下文/事实提供者），不做 I/O 以外的副作用；第三方插件仅从配置显式列出的包加载。
3. `render/` 是纯函数：`(Report, options) → string | object`，便于快照测试。
4. `rules/` 的问题编译器是纯函数：`(unit, rules) → JevRequest`，便于用固定 cassette 回放测试。

---

## 3. 审查管线时序（Review Pipeline Sequence）

```mermaid
sequenceDiagram
    autonumber
    actor U as User / Agent / CI
    participant C as CLI (review)
    participant G as git/ + select/
    participant P as plugins/ + rules/
    participant B as units/ + security/
    participant J as judge/
    participant X as jev/ (cache · limiter)
    participant T as TypeSafe Jev API
    participant R as render/

    U->>C: kestrel review --from main
    C->>G: diff(merge-base..HEAD)
    G-->>C: ChangedFile[] (+ skipped with reasons)
    C->>P: detect language, facts, applicable rule packs
    C->>B: build review units (hunk windows, enclosing ctx)
    B->>B: redact secrets, add injection probe
    B->>P: run triggers per unit
    P-->>J: units × triggered rules (+ deterministic anchors)
    par for each unit (concurrency 8)
        J->>X: Pass 1 request (dims + r.* + g.* + s.* + u.injection)
        alt cache hit (pinned model)
            X-->>J: cached answers
        else miss
            X->>T: POST /v1/systemone
            T-->>X: answers (noul / score / choice + confidence)
            X-->>J: answers + usage
        end
    end
    J->>J: p_eff = p × Π(1 − p_guard), bands by profile thresholds
    par only rules ≥ τ_uncertain without anchor
        J->>X: Pass 2 request (loc.* Choice over real line ids + none)
        X->>T: POST /v1/systemone
        T-->>X: chosen line + confidence
        X-->>J: answers
    end
    J->>J: dedupe · file risk · deep-review list · verdict (code-only gate)
    opt --llm enabled (P2)
        J->>J: narrate top-N via LLM, then verify with Jev (addresses / unrelated / contradicts)
    end
    J->>R: findings + verdict + stats
    R-->>U: terminal / JSON / SARIF / Markdown (exit 1 if gate fails)
```

![](diagrams/03-review-sequence.png)

阶段与 03 文档 S0–S11 的对应：①–② = S0–S2（配置、diff、过滤）；③ = S3（语言/插件分派）；④–⑥ = S4–S5（单元、上下文、安全）；⑦–⑧ = S6（触发）；⑨–⑬ = S7（Pass 1）；⑭ = S8（分档）；⑮–⑱ = S9（Pass 2）；⑲ = S10（去重、风险、判决）；⑳ = P2 叙述；㉑–㉒ = S11（渲染/输出）。

延迟预算（典型 PR：约 40 个单元，并发 8）：Pass 1 约 5 轮 × 70–500 ms ≈ 0.4–2.5 s，Pass 2 仅对少量无锚点规则，目标 **p50 < 3 s、成本 < $0.01**（不含 LLM；与 03 §14 一致，需实测验证）。

---

## 4. 插件模型（Class Diagram）

```mermaid
classDiagram
    direction LR
    class KestrelPlugin {
        +apiVersion: 1
        +id: string
        +name: string
        +version: string
        +languages: LanguageDefinition[]
        +rulePacks?: RulePackRef[]
        +context?: ContextProvider
        +facts?: FactsProvider
        +staticTools?: StaticToolAdapter[]
        +fileClasses?: FileClasses
        +setup?(ctx) void
    }
    class LanguageDefinition {
        +id: string
        +extensions: string[]
        +filenames?: string[]
        +shebangs?: string[]
        +sniff?(head) boolean
        +grammar?: GrammarRef
        +embedded?: EmbeddedExtractor
    }
    class ContextProvider {
        <<interface>>
        +build(input: ContextInput) UnitContext
    }
    class FactsProvider {
        <<interface>>
        +detect(repo) string[]
    }
    class StaticToolAdapter {
        <<interface>>
        +id: string
        +languages: string[]
        +detect(repo) boolean
        +run?(ctx) SarifLog
    }
    class RulePack {
        +pack: string
        +version: string
        +rules: Rule[]
    }
    class Rule {
        +id: string
        +title: I18nText
        +category: Category
        +dimension: Dimension
        +applies: Applies
        +trigger: Trigger
        +context: ContextNeed[]
        +question: NoulSpec
        +guards: GuardSpec[]
        +severity: SeveritySpec
        +thresholds?: Thresholds
        +locate: trigger|choose|unit
        +slots?: SlotSpec
        +message: I18nTemplate
        +fix?: FixSpec
        +mock?: MockHints
        +examples: Examples
    }
    class Trigger {
        +kind: regex|treesitter|always|removed|sarif
        +on: added|removed|both
        +pattern?: string
        +query?: string
    }
    class QuestionCompiler {
        +compilePass1(unit, rules) JevRequest
        +compilePass2(unit, fired) JevRequest
    }
    class JevProvider {
        <<interface>>
        +name: string
        +isAI: boolean
        +ask(req: JevRequest) JevResponse
    }
    class TypeSafeProvider
    class HttpProvider
    class MockProvider
    class ReplayProvider
    class Finding {
        +ruleId: string
        +severity: Severity
        +band: report|uncertain|drop
        +probability: number
        +pEff: number
        +location: Location
        +message: string
    }

    KestrelPlugin "1" o-- "1..*" LanguageDefinition
    KestrelPlugin "1" o-- "0..*" RulePack
    KestrelPlugin ..> ContextProvider
    KestrelPlugin ..> FactsProvider
    KestrelPlugin ..> StaticToolAdapter
    RulePack "1" *-- "1..*" Rule
    Rule *-- Trigger
    QuestionCompiler ..> Rule : compiles
    QuestionCompiler ..> JevProvider : sends via
    JevProvider <|.. TypeSafeProvider
    JevProvider <|.. HttpProvider
    JevProvider <|.. MockProvider
    JevProvider <|.. ReplayProvider
    Rule ..> Finding : produces (via judge)
```

![](diagrams/04-plugin-model.png)

说明：

- **一个语言 = 一个插件**（`KestrelPlugin`），可以声明多个 `LanguageDefinition`（如 typescript 插件同时声明 `typescript`、`tsx`、`javascript`（`.jsx` 归入 javascript），Vue SFC 通过 `embedded` 提取 `<script>` 块）。
- **规则是数据，不是代码**：`Rule` 由 YAML 描述，`QuestionCompiler` 把 `question`/`guards`/`severity` 编译成 Jev 的 Noul/Score/Choice；插件作者无需写 TS 就能扩展规则。
- `ContextProvider`/`FactsProvider`/`StaticToolAdapter` 是可选的代码扩展点（MVP 仅用启发式上下文；P1 起 tree-sitter）。
- `JevProvider` 四种实现使得测试与离线 CI 完全不依赖 Jev key。

---

## 5. 置信度分档与判决流程（Decision Flow）

```mermaid
flowchart TD
    A["Rule triggered on unit"] --> B["Pass 1 answers:<br/>p = r.rule (Noul)<br/>g_i = guards (Noul)<br/>s = severity (Score)"]
    B --> C["p_eff = p × Π (1 − g_i)^w_i"]
    C --> D{"p_eff ≥ τ_report?"}
    D -- yes --> E["band = report"]
    D -- no --> F{"p_eff ≥ τ_uncertain?"}
    F -- yes --> G["band = uncertain"]
    F -- no --> H["drop (kept in session log)"]
    E --> I{"deterministic anchor?"}
    G --> I
    I -- yes --> K["anchor = trigger line"]
    I -- no --> J["Pass 2: loc Choice over real line ids + none"]
    J --> L{"choice ≠ none and confidence ≥ 0.5?"}
    L -- yes --> K2["anchor = chosen line"]
    L -- no --> M["anchor = unit (first added line)<br/>'location uncertain'"]
    K --> N["severity = map(round(s.score))<br/>(score confidence < 0.4 → default)<br/>clamp(min,max)"]
    K2 --> N
    M --> N
    N --> O["render template (i18n) → Finding"]
    O --> P{"band = report and severity ≥ gate.failOn<br/>and p_eff ≥ gate.minProbability?"}
    P -- yes --> Q["blocking → verdict request_changes"]
    P -- no --> R["non-blocking → verdict comment/approve"]
```

![](diagrams/05-decision-flow.png)

- 阈值 `τ_report / τ_uncertain` 按 profile：chill 0.85/0.70、balanced 0.75/0.55、assertive 0.60/0.40（**初始值，需 P3 用标注集校准**）。
- `p_eff` 的乘法护栏公式是**启发式**，并非 Jev 官方语义；Noul 只返回“是”的概率（无 confidence 字段），分档直接基于该概率；`confidence` 仅用于 Choice（定位）与 Score（严重度）的可信度判断。
- 门禁只看 `band=report` 且严重度 ≥ `gate.failOn`（默认 high）且 `p_eff ≥ gate.minProbability`（默认 0.8）的发现；`uncertain` 永远不阻塞合并。

---

## 6. CI 集成流程（GitHub Action）

```mermaid
flowchart LR
    ev["pull_request event"] --> co["checkout (fetch-depth: 0)"]
    co --> key{"TYPESAFE_API_KEY<br/>available?"}
    key -- no --> skip["skip with warning<br/>(or mock if allow_mock)"]
    key -- yes --> rv["npx kestrel-review review --from origin/BASE<br/>--untrusted → json + sarif + markdown"]
    rv --> sum["job summary ← kestrel.md"]
    rv --> post["kestrel github post<br/>inline comments (new fingerprints only)<br/>+ sticky summary"]
    rv --> sarif["upload-sarif → Code Scanning"]
    rv --> gate{"gate failed?<br/>(exit 1)"}
    gate -- yes --> red["❌ check fails"]
    gate -- no --> green["✅ check passes"]
```

![](diagrams/06-ci-flow.png)

- fork PR 拿不到 secret 时默认**跳过并警告**，不静默降级到 mock（mock 结果无审查意义；`CI=true` 时未显式允许 mock 则退出码 3）。
- `--untrusted`（Action 默认开启）：不加载第三方代码插件、不运行静态工具，只允许内置插件与纯数据 YAML 规则包（见 03 §5.4 / §11）。

---

## 7. 部署形态

| 形态 | 载体 | 调用方式 |
|---|---|---|
| CLI | npm 包 `kestrel-review`（bin `kestrel` → `bin/kestrel.mjs`） | `npx kestrel-review review` / 全局安装 |
| Skill | `skills/kestrel/SKILL.md`（兼容 `npx skills add lpliu-art/kestrel`） | 宿主 Agent 读取 SKILL.md 后调用 CLI |
| 插件/命令 | `plugins/kestrel/claude-code/commands/review.md`、`.claude-plugin/marketplace.json`；Codex/Cursor 清单（P2，格式待按官方规范核实） | `/kestrel:review` |
| CI | 仓库根 `action.yml`（composite） | `uses: lpliu-art/kestrel@v1` |
| 单二进制（0.4.1） | Node SEA。语法 wasm 打进资源；`doctor` 显示 `parser: tree-sitter` 或 `parser: regex-fallback` | 无 Node 环境时使用。规则 YAML 在二进制旁的 `payload/` |

## 8. 渲染说明

PNG 由以下命令生成（可复现）：

```bash
npm i @mermaid-js/mermaid-cli@11
echo '{"executablePath":"/usr/bin/google-chrome","args":["--no-sandbox","--disable-gpu"]}' > pp.json
for f in diagrams/*.mmd; do npx mmdc -p pp.json -i "$f" -o "${f%.mmd}.png" -w 1800 -b white -s 2; done
```
