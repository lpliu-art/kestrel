# AACR-Bench

[AACR-Bench](https://github.com/alibaba/aacr-bench) is Apache-2.0. Its `dataset/positive_samples.json` and `dataset/negative_samples.json` identify upstream pull requests. They do not embed diffs, so this repository does not vendor those files (about 1.6 MB of commit pointers, and the code lives in other projects).

`kestrel eval` accepts that JSON and prints a catalog (languages, comment counts) without inventing per-rule scores. `sample.json` is a small AACR-shaped file with hunks written here so the same loader can score a public-set path offline.

To catalog the real set:

```bash
git clone https://github.com/alibaba/aacr-bench.git
kestrel eval aacr-bench/dataset/positive_samples.json --provider mock
```
