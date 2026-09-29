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
