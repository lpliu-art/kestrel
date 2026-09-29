# Kestrel plugin starter

A minimal plugin: one language claim and one YAML rule pack.

```bash
# from a project that depends on kestrel-review
# .kestrel.yml
plugins:
  - ./examples/plugin-starter/kestrel.plugin.ts
```

Rule ids have three segments (`starter.correctness.todo-now`). Each rule needs an English question, true and false criteria, and one positive and one negative example. `kestrel rules lint` and `kestrel rules test` run those examples offline with the mock provider.

`override: true` lets this starter replace the built-in TypeScript language claim. Drop it if you are adding a language Kestrel does not already ship.
