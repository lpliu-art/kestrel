# 编写规则

一条规则是一个 Jev 问题，不是一段生成的评论。`question.question` 用英文，只问一个判断。`true` / `false` 写清什么算命中。

`trigger.kind` 用 `regex`、`always` 或 `removed`。正则不要带 `g`。正反例放在 `examples` 里，用 `kestrel rules test` 在 mock 下验证。

消息模板支持 `{{line}}`、`{{file}}`、`{{symbol}}`、`{{p}}`、`{{severity}}`、`{{snippet}}`，以及规则声明的 slot。中英正文都要写。

项目规则放在 `.kestrel/rules/**/*.yml`，后加载的同 id 覆盖内置规则。
