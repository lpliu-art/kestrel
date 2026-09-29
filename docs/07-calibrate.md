# 用真实 Jev 密钥校准

mock 跑出来的 precision、recall、ECE 和阈值提案**不是** Jev 的数字。它们只描述确定性的 mock provider。默认画像阈值（balanced 0.75 / 0.55）不会被 mock 结果改写。`--apply` 在 mock 上会拒绝。

有 `TYPESAFE_API_KEY` 时，一条命令即可对内置标注集做真实校准：

```bash
export TYPESAFE_API_KEY=...
kestrel eval eval/internal/dataset.json --provider typesafe --calibrate --out calibration.json
```

这条命令会调用 Jev，并在 `calibration.json` 里写下：

- 按规则、按插件的 precision / recall / F1 / 假阳率
- 可靠性分箱和 ECE
- 三档画像的建议阈值（chill / balanced / assertive）
- 启发式 `p_eff = p × Π(1−g)^w` 与 logistic 融合的比较

报告第一行会写明这是 live Jev。只有这时 `--apply` 才会把提案标成已应用。把建议阈值抄进团队配置之前，先看模型版本是不是锁定的 `jev-x.y.z`。

## GitHub Actions

仓库里的 `.github/workflows/calibrate.yml` 只在手动触发时运行。密钥放在仓库 Actions secret `TYPESAFE_API_KEY` 里，不要写进命令行。workflow 缺这个 secret 时会立刻失败，并且不会打印它的值。

Actions → Calibrate → Run workflow：

| 输入 | 默认 | 作用 |
| --- | --- | --- |
| `dataset` | `eval/internal/dataset.json` | 标注集路径 |
| `plugin` | 空 | 只跑一个内置插件：`core`、`typescript`、`python`、`java`、`go`、`rust`、`csharp` |
| `max_requests` | `500` | 案例数超过它就拒绝启动；运行中达到这个请求数也停止 |
| `budget_tokens` | `2000000` | 输入 token 上限 |
| `open_pr` | 关 | 把 balanced 建议阈值写进内置规则包并开一个 PR。mock 报告不会写 |

跑完后，JSON 和 Markdown 报告在 artifact `calibration-report` 里，Markdown 也写进 job summary。

本地用 mock 检查同一条脚本（不访问网络）：

```bash
npm run build
node --experimental-strip-types scripts/calibrate.ts \
  --dataset eval/internal/dataset.json \
  --provider mock \
  --max-requests 500 \
  --budget-tokens 2000000 \
  --out-dir calibration
```

`--apply-thresholds` 在 mock 报告上会拒绝写规则。

离线对照（不会访问网络）：

```bash
kestrel eval eval/internal/dataset.json --provider mock --calibrate
```

输出以 `MOCK CALIBRATION` 开头。

AACR-Bench 是 Apache-2.0。上游 JSON 没有 diff，所以：

```bash
kestrel eval path/to/aacr-bench/dataset/positive_samples.json --provider mock
```

只打印语言和评论数量。带 hunk 的可评分样例是 `eval/aacr/sample.json`。
