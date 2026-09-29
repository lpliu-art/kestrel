---
"kestrel-review": patch
---

The single-file binary embeds builtin rule YAML and package metadata, so it runs with no `payload/` directory beside it. Project rules and `.kestrel.yml` checks still load from disk.

Question compiler: no change. Existing rule questions are unchanged.
