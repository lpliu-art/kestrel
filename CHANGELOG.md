# Changelog

## 0.4.0

Phase P3. `kestrel eval` scores a labeled set and proposes profile thresholds. Mock output is marked as not from Jev and is not applied to the shipped thresholds. A live run is `kestrel eval eval/internal/dataset.json --provider typesafe --calibrate`. Logistic fusion is compared with the heuristic `p_eff`. Shipped judgments stay on the heuristic. `kestrel view` writes a static HTML session viewer. `--explore` keeps LLM suspects only after a Jev `x.support` check. `llm-shim` is an opt-in degraded provider, not Jev. OpenTelemetry export is optional and omits source text. A Node SEA build script and a three-OS workflow produce a binary. On Node 22 the entry is CommonJS, so web-tree-sitter's wasm init falls back to the heuristic and regex triggers; the binary still reviews.

Question compiler: explore adds an `x.support` question. Existing rule question text is unchanged. Enabling explore adds requests.

## 0.3.0

Phase P2. Optional LLM narrator (OpenAI-compatible `/chat/completions` and Anthropic `/v1/messages`, fetch only, off by default). It rewrites template comment text after a Jev check (`v.addresses`, `v.unrelated`, `v.contradicts`) and falls back to the template on any error. React and Vue rule packs, Rust and C# plugins, `kestrel scan`, `kestrel gitlab post`, incremental review, and a pull-request risk / test-gap conclusion.

Question compiler: narrator verification and pull-request questions are new requests. They do not rewrite existing rule questions. Enabling them adds requests and can change request counts; rule-level judgment text is unchanged.

## 0.2.0

Phase P1. tree-sitter context and triggers (heuristic and regex fallback when a grammar fails to load), GitHub composite Action, `github post` with fingerprint dedupe and a COMMENT fallback, SARIF input filtering, natural-language `checks`, and `explain` / `doctor`.

Question compiler: treesitter triggers and team checks add questions that were not sent before. That can shift judgment distributions for units that match them.

## 0.1.0

MVP: CLI review pipeline, mock and replay providers, TypeSafe SDK/HTTP providers, builtin rules for core, TypeScript/JavaScript (React and Vue regex packs), Python, Java, and Go, plus terminal, JSON, SARIF, and Markdown output.
