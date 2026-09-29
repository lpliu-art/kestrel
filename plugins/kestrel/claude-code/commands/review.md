---
description: Review current changes with Kestrel (Jev System One) and fix high-confidence issues on request.
---
Run `kestrel review --format json --audience agent --out /tmp/kestrel.json $ARGUMENTS` (pass through --staged, --commit, --from/--to).
Read the file fully. Follow the Kestrel skill rules: only `report` band findings; explain each in context; you write the prose and fixes (Kestrel cannot).
Review files in `handoff.deepReview` yourself. Ask before editing code unless the user said "review and fix".
