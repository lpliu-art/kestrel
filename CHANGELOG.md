# Changelog

## 0.4.3

Fix the Calibrate workflow YAML, lint workflows with actionlint, and publish a moving `v0` major tag from the Release workflow so `lpliu-art/kestrel@v0` resolves. Replace the npm README with a bilingual page, expand package.json search metadata, and bump the GitLab CI example to the current version. `kestrel auth set|status|clear` stores a Jev API key in the user credentials file (`0600` on POSIX); the first interactive run can ask once with hidden input and remember a skip. `doctor` reports whether the key comes from the env or the file. `kestrel rules list | head` no longer crashes on EPIPE.

The macOS binary is now ad-hoc signed after the blob is injected. The 0.4.2 macOS binary was unsigned, so macOS killed it on launch (exit 137). The SEA workflow verifies the signature on macOS.

Question compiler: no change. Existing rule questions are unchanged.

## 0.4.2

The single-file binary embeds the builtin rule packs and `package.json`. It no longer reads a `payload/` directory next to the executable. User config, project rule packs, and team checks still load from disk and layer over the embedded builtins. The viewer page is compiled into the binary. The npm package still reads rule YAML from disk.

Pushing a `v*` tag publishes `kestrel-review` to npm and attaches the Linux, macOS, and Windows binaries to a GitHub Release. The calibration workflow runs `kestrel eval --provider typesafe --calibrate` with `TYPESAFE_API_KEY` and can open a pull request that writes the balanced thresholds into builtin rule packs. `kestrel eval` accepts `--plugin`, `--budget-tokens`, and `--max-requests`.

Question compiler: no change. Existing rule questions are unchanged.

## 0.4.1

The Node SEA binary embeds `tree-sitter.wasm` and the language grammars and reviews with syntax-level units. `kestrel doctor` prints `parser: tree-sitter (<language>)` when a grammar is loaded and `parser: regex-fallback (<language>)` when it is not. The npm package still loads grammars from `node_modules`.

Question compiler: no change. Existing rule questions are unchanged.

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
