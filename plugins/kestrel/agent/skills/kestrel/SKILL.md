---
name: kestrel
description: >
  Fast, calibrated code review of Git changes using the `kestrel` CLI (TypeSafe Jev System One model).
  Use when the user asks to review code, review staged/unstaged changes, a commit, or a branch against main,
  or asks "is this safe to merge". Returns line-anchored findings with probabilities; you (the agent) write
  explanations and fixes for the findings.
license: Apache-2.0
compatibility: >
  Requires Node.js >= 22 and the `kestrel` CLI (`npm i -g kestrel-review` or `npx -y kestrel-review`).
  Real reviews need TYPESAFE_API_KEY; without it, only `--provider mock` works and results are NOT AI judgments.
metadata: { homepage: "https://github.com/lpliu-art/kestrel", version: "0.3.0" }
---

# Kestrel review

## Step 1 — Run the review
Run exactly one of (do not pre-check installation; if `command not found`, use `npx -y kestrel-review` instead):
- Working copy: `kestrel review --format json --audience agent --out /tmp/kestrel.json`
- Staged only: add `--staged`
- Branch vs base: add `--from <base>` (e.g. `--from main`)
- Single commit: add `--commit <sha>`
Read `/tmp/kestrel.json` in full with a file-reading tool (never truncate with head/tail).

## Step 2 — Interpret
- `provider.isAI == false` → tell the user results are MOCK, not AI judgments, and suggest setting TYPESAFE_API_KEY.
- Use `findings` where `band == "report"`; mention `uncertain` only if the user asks for everything.
- Each finding has `location.path/startLine`, `severity`, `probability`, a template `message`, `why`, and `fix.hint`.
  Kestrel does NOT generate prose: YOU explain the issue in context and propose the concrete fix.
- `verdict.decision` is advisory; `approve` means "no blocking issues found", not "safe".
- `handoff.deepReview` lists risky files with no confident rule match: read those files yourself and review them carefully.
- `pullRequest.conclusion` is a Jev score for the whole change (risk and whether tests changed). It does not add a finding and does not change the gate.
- Do not pass `--llm` unless the user asked for narrated comments. The narrator only rewrites template text and is off by default.

## Step 3 — Report
Group by severity (critical, high, medium). For each: `path:line` [ruleId] — your explanation — suggested fix.
If nothing remains: "Kestrel: no blocking issues in N files (model <provider.model>)."

## Step 4 — Fix (only if the user asked to fix)
Fix critical/high items first; re-run Step 1 with the same target to confirm findings disappeared.

## Troubleshooting
- Exit code 3: provider/auth error → ask the user to set TYPESAFE_API_KEY; never invent keys.
- `kestrel explain <id> --report /tmp/kestrel.json` shows the Jev questions and probabilities behind a finding. `kestrel explain pr --report /tmp/kestrel.json` shows the pull-request conclusion.
- Whole-file audit: `kestrel scan <paths> --provider mock` when there is no git diff. Incremental review: `kestrel review --incremental --from <base>`.
