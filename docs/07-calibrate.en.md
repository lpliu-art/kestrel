# Calibrate with a real Jev key

Precision, recall, ECE, and threshold proposals from a mock run are **not** Jev numbers. They describe the deterministic mock provider. The shipped profile thresholds (balanced 0.75 / 0.55) stay as designed. `--apply` refuses a mock run.

With `TYPESAFE_API_KEY` set, one command calibrates the built-in labeled set on live Jev:

```bash
export TYPESAFE_API_KEY=...
kestrel eval eval/internal/dataset.json --provider typesafe --calibrate --out calibration.json
```

That command calls Jev and writes `calibration.json` with:

- precision / recall / F1 / false-positive rate per rule and per plugin
- reliability bins and ECE
- proposed chill / balanced / assertive thresholds
- a comparison of the heuristic `p_eff = p × Π(1−g)^w` with logistic fusion

The first line says the run is live Jev. `--apply` marks the proposal applied only in that case. Copy a proposed threshold into team config only after you check that the model is a pinned `jev-x.y.z`.

## GitHub Actions

`.github/workflows/calibrate.yml` is `workflow_dispatch` only. Put the key in the repository Actions secret `TYPESAFE_API_KEY`. Do not pass it on the command line. If that secret is missing, the workflow fails immediately and does not print the value.

Actions → Calibrate → Run workflow:

| Input | Default | Role |
| --- | --- | --- |
| `dataset` | `eval/internal/dataset.json` | Labeled dataset path |
| `plugin` | empty | One builtin plugin: `core`, `typescript`, `python`, `java`, `go`, `rust`, `csharp` |
| `max_requests` | `500` | Refuse to start when the case count is higher; stop the run when this many Jev requests have been sent |
| `budget_tokens` | `2000000` | Input-token cap |
| `open_pr` | off | Write the balanced proposal into builtin rule packs and open a pull request. A mock report is not written |

The JSON and Markdown report is the `calibration-report` artifact. The Markdown is also appended to the job summary.

Check the same script locally in mock mode (no network):

```bash
npm run build
node --experimental-strip-types scripts/calibrate.ts \
  --dataset eval/internal/dataset.json \
  --provider mock \
  --max-requests 500 \
  --budget-tokens 2000000 \
  --out-dir calibration
```

`--apply-thresholds` refuses to edit rule packs when the report is mock.

Offline counterpart (no network):

```bash
kestrel eval eval/internal/dataset.json --provider mock --calibrate
```

The output starts with `MOCK CALIBRATION`.

AACR-Bench is Apache-2.0. The upstream JSON has no diffs, so:

```bash
kestrel eval path/to/aacr-bench/dataset/positive_samples.json --provider mock
```

prints language and comment counts only. `eval/aacr/sample.json` is a small scored sample with hunks written in this repo.
