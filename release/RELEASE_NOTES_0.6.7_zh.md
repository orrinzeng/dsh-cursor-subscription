# dsh-cursor-subscription v0.6.7

模型列表现在按名称排序。Cursor 的 `GetUsableModels` 按它自己的顺序返回（最新系列
在前），插件此前直接沿用该顺序，因此 DSH 的模型选择器和设置页的模型列表在实测账号
下展示的是 Cursor 的原始序列——231 条记录里 `Auto` 被压在别处、随后是
`Claude Fable`、`Claude Opus`……而且这个顺序会随 Cursor 版本变化，列表会自己
“重新洗牌”。

## 修复

- `CursorAdapter.#discoverModels` 在缓存前就对投影出的列表（以及离线时的兜底列表）
  排序，因此所有读取同一份缓存的入口都拿到同一个顺序：DSH 选择器的
  `listModels` 与设置页的 `listModelsForRpc` 不会再出现两者不一致。
- 名称比较使用 `Intl.Collator("en", { numeric: true, sensitivity: "base" })`，
  名称相同时用 id 作为次级排序键：
  - 排序区域固定为 `"en"` 而非宿主机区域，保证同一版本在任何语言环境下顺序一致，
    选择器不再随读者的语言变化；
  - `numeric` 让同系列保持自然顺序——`Composer 1.5` 在 `Composer 2` 之前，
    `GPT-5` → `GPT-5.1` → `GPT-10`，而不是按文本逐字符比较数字；
  - `sensitivity: "base"` 使排序忽略大小写，`auto` / `Auto`、`GPT-4o` /
    `gpt-4o` 这类相邻项不会被拆开；
  - 显示名相同（Cursor 确实会返回多个同名变体）时按 id 排序，列表因此稳定，不再
    取决于接口返回顺序。
- 新增导出 `sortModelsByName(models)`，供适配器之外的调用方使用；它返回副本，
  持有缓存列表的调用方不会被就地打乱。
- 原本按系列手写的兜底模型列表，现在走同一套排序。

## 未改动的部分

- 列出的模型与其元数据不变：id、名称、`inputModalities`、5 分钟缓存时长都与
  之前一致。
- `resolveModel` 仍按 id 解析，升级前选中的模型继续可用。
- 用量卡片的「包含用量」表格仍按消费额排序模型行（与 Cursor 官网一致）；只有
  可选择模型列表改为按名称排序。

## 验证

- **实测：** 使用已存储的账号，适配器列出 231 个模型，按该排序器逐对比较
  **0 处逆序**；`listModels` 与 `listModelsForRpc({ force: true })` 返回的 id 顺序
  完全一致；对返回结果再次排序是空操作。列表首项为 `Auto`、`Claude Fable 5 1M
  (NO ZDR)`……末项为 `Muse Spark 1.3 1M Minimal`。
- **单元测试：** Host 侧 88 个测试全部通过（proto 55、client-locales 8、
  client-usage-table 4、inject-contract 6、version 6、native-fetch 6、
  image-input 3）。新增用例覆盖：忽略大小写、数字按自然顺序排序；名称相同时
  回退到 id；不修改传入数组；适配器的选择器列表与 RPC 列表顺序一致；兜底列表
  按预期的名称顺序输出。

## 安装或升级

```sh
dsh plugin --profile web add dsh-cursor-subscription@0.6.7
dsh plugin --profile web list dsh-cursor-subscription --depth 0
```

之后手动重启 DSH，确认 **设置 → Cursor** 显示 `v0.6.7`。

从 v0.6.5 或更早版本升级时，也会一并获得 v0.6.6 说明中描述的、与官网一致的
包含用量表格。

## 兼容性与已知事项

- 新增导出 `sortModelsByName(models)`；`CursorAdapter.listModels` 与
  `listModelsForRpc` 签名不变，但返回值现在一定是按名称排序的数组。
- 模型 id 未改动；如果你在配置里固定了某个模型 id，仍然可以解析。
- Cursor 的 `GetUsableModels` 返回顺序没有公开文档，随时可能变化；选择器不再
  依赖它。
