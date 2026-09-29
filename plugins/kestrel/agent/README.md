# Kestrel agent plugin

Manifest fields were checked against public docs before these files were added:

- Portable package: [Package your plugin](https://developers.openai.com/plugins/build/plugins) (root `plugin.json`, `$schema` `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`). Skills are discovered from `skills/`. The closed manifest does not list them.
- Codex compatibility overlay: the same guide's `@plugin-creator` scaffold (`.codex-plugin/plugin.json` with `name`, `version`, `description`, and `skills`).
- Cursor plugin: [Cursor plugins reference](https://cursor.com/docs/reference/plugins) (`.cursor-plugin/plugin.json`; required `name`; optional `description`, `version`, `license`, `keywords`, `skills`).

These files are the in-repo package. They are not submitted to the public ChatGPT/Codex plugin directory.
