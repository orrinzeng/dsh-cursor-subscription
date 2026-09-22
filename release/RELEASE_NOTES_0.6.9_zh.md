# dsh-cursor-subscription v0.6.9

一份文档，涵盖三个版本。registry 上最新是 `v0.6.6`；`v0.6.7` 与 `v0.6.8` 是和
本版本一起准备、并未单独发布的，因此从 `v0.6.6` 升级，一次重启即可拿到下面全部内容。

## v0.6.9 — 适配 DSH 0.1.7、压缩、真实用量

DSH 0.1.7-alpha.1 换掉了本插件所依赖的设置服务。`apply` 调用
`ctx.get("settings").installSection(...)` 时该方法已不存在，于是每次启动
`cursor-subscription` 这条 entry 都激活失败：

```text
cursor-subscription (dsh-cursor-subscription):
TypeError: ctx.get(...).installSection is not a function
```

同一批会话记录还暴露出 Cursor 链路上的另外两个缺陷：一次运行仍然背着 DSH 刚刚压缩掉的
历史，而适配器上报的 token 数字是占位值。

### 原因

三份契约各自发生了漂移。

**设置 API。** DSH 0.1.7 从插件自己的 profile entry 组合出设置页：entry id 就是
命名空间，只有标记了 `.volatile()` 的字段会出现在页面上，Loader 把这些字段以活引用
（`config.x.get()`）交付并在原地更新，`settings.configure({ auto }, fiber)` 只用来
声明页面策略。本版本当初依赖的注册接口 `installSection` 与 `settings.register` 都已
移除。没有 volatile 字段的 Config 根本不会产生设置分区；而 `.volatile()` 本身直到
`@deepseek-ai/schemastery` 3.18.3 才存在，本插件却把它声明为 peer，且范围仍允许
3.18.1。

**压缩。** DSH 释放上下文的方式，是把一段对话替换成摘要，并把该消息标记为
`source.kind = "compact-checkpoint"` 并带上这次压缩的 id。适配器只要手里有自己持久化
的 Cursor checkpoint 就优先复用它，而那份 checkpoint 记录的仍是压缩前的完整对话：在出
问题的会话里，DSH 已经把历史压到约 2.4k token，模型却继续背着约 20.4 万 token 的、
DSH 早已丢弃的历史在跑。于是这次运行一步又一步地重开同一份调查——22 步、每步一次搜索、
始终没有编辑任何文件——直到用户手动中断。

**用量。** `inputTokens` 被硬编码为 `0`，`outputTokens` 取的是最后一帧
`token_delta` 而不是各帧之和，于是一整段回答被上报成 1~3 个 token。

### 修复

**设置分区改按 DSH 0.1.7 的 API。** `Config` 各字段现在都带 `.volatile()`；
`readConfigField()` 同时接受活引用与普通值；`apply` 通过
`ctx.inject(["settings"], ...)` → `settings.configure({ auto: false }, ctx.fiber)`
声明页面策略——本插件自带 **设置 → Cursor** 面板，因此不生成自动表单。在没有
`configure` 的 DSH 版本（0.1.5 线）上，Cursor 供应商仍能加载，只是设置页保持为空，
而不是整条 entry 启动失败。

**`@deepseek-ai/schemastery` 改为运行时依赖。** 它从 `peerDependencies` 移到
`dependencies`（`^3.18.3`），与 DSH 自家插件的声明方式一致：安装时会自带带
`.volatile()` 的那个版本，陈旧的共享 `node_modules` 目录也不再能决定插件用哪个库解析
自身 Config。

**压缩会作废它使之失效的 checkpoint。** `compactionIdOf()` 从消息历史中读出压缩 id。
当它与持久化的 Cursor 对话所依据的 id 不一致时，适配器丢弃 checkpoint 及其 blobs，
并且不再跨这次压缩恢复 live bridge；下一次冷启动会按 DSH 保留下来的内容重建。

**用量上报真实 prompt 大小与完整输出。** Cursor 上报的 prompt 大小就在对话 checkpoint
里（`ConversationStateStructure.token_details.used_tokens`），现在由
`decodeCheckpointUsedTokens()` 解出；输出 token 改为累加各 `token_delta` 帧。

## v0.6.8 — 叫不出名字的工具请求也会被应答

需要调用工具的 Cursor 任务，可能刚说完“我这就去读取那个文件”就直接结束了，实际什么
也没做。原因是模型改向 Cursor 请求它自己的内置工具，而当前版本不认识这个请求；由于
没有任何东西去应答它，服务端一直在等一个永远不会到来的执行结果：60 秒后进度看门狗
触发，只有那句开场白留在了对话里。

**叫不出名字的 exec 也会被应答。** Cursor 的工具请求通过 `ExecServerMessage` 下发。
当前版本能解码它认识的变体（read、ls、grep、write、delete、shell、fetch、
diagnostics 等），对每一个都回复“请改用 DSH 工具”，而 MCP 调用（`mcp_args`）会被
转成真正的 DSH 工具调用。Cursor 会不打招呼地新增 exec 变体：这一轮它开始下发 args
字段为 **36** 的 exec——消息里只有一个工作区名称，对应一个当前版本叫不出名字的工具。
`decodeExecServerMessage` 返回 `{ case: "unknown" }`，`rejectionFor()` 对它返回
`undefined`，于是适配器根本没有回包。`ExecClientMessage` 的结果变体编号与
`ExecServerMessage` 的 exec 变体编号完全一致，因此无法命名的 exec 现在可以按它自己的
字段号回复：负载是通用错误形状 `{ error = 2 { error = 1 } }`，内容与其他原生工具收到
的理由相同（“Tool not available in this environment. Use the MCP tools provided
instead.”）。字段 19（`span_context`）是普通非 oneof 字段，永远不会被误当成 exec；
只带 id 和 span context 的消息没有 exec 可答，保持不回包。适配器每次运行最多记一条
警告，写明被回绝的字段号；如果出现完全无法定位的 exec（唯一仍可能卡死的情况），再记
一条警告。

**卡死日志会写明字段号。** `decodeExecServerMessage` 现在保留未知 exec 的字段号与消息
的顶层字段列表，卡死日志打印 `exec:unknown#36[1,19,36,55]`，不再是那个让人难以从日志
定位问题的 `exec:unknown`。

## v0.6.7 — 模型列表按名称排序

Cursor 的 `GetUsableModels` 按它自己的顺序返回（最新系列在前），插件此前直接沿用该
顺序，因此 DSH 的模型选择器和设置页的模型列表在实测账号下展示的是 Cursor 的原始
序列——231 条记录里 `Auto` 被压在别处、随后是 `Claude Fable`、`Claude Opus`……而且
这个顺序会随 Cursor 版本变化，列表会自己“重新洗牌”。

- `CursorAdapter.#discoverModels` 在缓存前就对投影出的列表（以及离线时的兜底列表）
  排序，因此所有读取同一份缓存的入口都拿到同一个顺序：DSH 选择器的 `listModels` 与
  设置页的 `listModelsForRpc` 不会再出现两者不一致。
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
- **未改动的部分：** 列出的模型与其元数据不变（id、名称、`inputModalities`、5 分钟
  缓存时长）。`resolveModel` 仍按 id 解析，升级前选中的模型继续可用。用量卡片的
  「包含用量」表格仍按消费额排序模型行（与 Cursor 官网一致）；只有可选择模型列表改为
  按名称排序。

## 验证

- **v0.6.9，API 迁移后的实机验证：** `dsh web` 启动后 entry 处于激活状态——环回通道对
  `POST /cursor-subscription/version` 返回 Connection 的 `401 unauthorized`，
  而这条路由只有在 `apply` 跑完并挂载之后才会存在。随后一次三步的 Cursor 运行上报
  `inputTokens` 17,613 / 17,544 / 18,558、`outputTokens` 390 / 237 / 5：prompt
  大小随对话增长，输出量与文本长度相符。
- **v0.6.9，压缩：** 出问题的会话里，压缩后的存活历史为 9,641 字符（约 2,410 token），
  而整个会话累计 815,800 字符（约 203,950 token，其中 55% 是工具输出）。
- **v0.6.9，真 cordis 启动探针：** 12/12 通过——面对 0.1.7 形状的设置服务时 entry 正常
  激活、页面策略绑定在插件自己的 fiber 上、`Config` 以活引用交付、提交的修改在下一次
  读取时可见、设置更新走 entry 命名空间写入，而 0.1.5 形状的设置服务下供应商仍能加载。
- **v0.6.8，实测复现：** 下面两个提问在修复前都会卡住且不产生任何工具调用，该步骤只
  留下开场白文字。

  | 提问 | 修复前 | 修复后 |
  | --- | --- | --- |
  | 读取并总结 `package.json` | 卡住，无工具调用 | 9.5 秒时发出 MCP `read` 调用 |
  | 读出 `README.md` 第一段 | 卡住，无工具调用 | 11.5 秒时发出 MCP `read` 调用 |

  用失败会话里的模型 `claude-opus-5-high` 结果相同：4.7 秒回绝未知 exec，11.5 秒
  发出 MCP `read` 调用。
- **v0.6.8，对线上服务探测回包形状：** 不回包时任务卡死（仅 7 帧心跳）。按该 exec
  自己的字段回包即可恢复——空负载、`{ success = 1 }`、`{ error = 2 { error = 1 } }`、
  `{ rejected = 3 }` 都能让任务继续，服务端随后上报 `toolCallCompleted`。改为在字段 11
  （`mcp_result`）回包则会卡死，这就是必须使用 exec 自身字段号的原因。
- **v0.6.7，实测：** 使用已存储的账号，适配器列出 231 个模型，按该排序器逐对比较
  **0 处逆序**；`listModels` 与 `listModelsForRpc({ force: true })` 返回的 id 顺序完全
  一致；对返回结果再次排序是空操作。列表首项为 `Auto`、`Claude Fable 5 1M (NO ZDR)`
  ……末项为 `Muse Spark 1.3 1M Minimal`。
- **单元测试：** Host 侧 96 个测试全部通过（`v0.6.6` 时为 88 个）。三个版本新增的用例：
  忽略大小写、数字按自然顺序排序，名称相同时回退到 id，不修改传入数组，适配器的选择器
  列表与 RPC 列表顺序一致，兜底列表按预期的名称顺序输出（0.6.7）；未知 exec 保留字段 36
  与顶层字段列表，回包使用该字段且能解出回绝理由，只带 id 与 span context 的消息不会按
  字段 19 回包，每个被直接回绝的 exec 都在自己的字段号上回包，适配器对未知 exec 只回包
  一次、记录警告并继续流式输出直到 `turn_ended`（0.6.8）；压缩前捕获的 checkpoint 不会
  被复用，单步 token 总量等于各帧之和，`resolveCursorSettings` 能读取活的 volatile
  引用（0.6.9）。

## 安装或升级

```sh
dsh plugin --profile web add dsh-cursor-subscription@0.6.9
dsh plugin --profile web list dsh-cursor-subscription --depth 0
```

之后手动重启 DSH，确认 **设置 → Cursor** 显示 `v0.6.9`。

从 `v0.6.6` 直接升级，还会一并获得 v0.6.7 节描述的按名称排序的模型列表；从 `v0.6.5` 或
更早版本升级，则还会获得 v0.6.6 说明中描述的、与官网一致的包含用量表格。

## 兼容性与已知事项

- 设置页需要设置服务带 `configure` 的 DSH 版本（0.1.7-alpha.1 及以后）。其余功能——
  登录、模型发现、对话、工具调用——在 0.1.5 线上同样可用。
- `@deepseek-ai/schemastery` 现在是运行时依赖：profile 安装会自带一份，陈旧的共享
  `node_modules` 目录不再能决定插件用哪个库解析自身 Config。
- Cursor 的原生工具仍会被逐个回绝：模型尝试一次就要付一次被拒的往返，这类回绝不计入
  工具轮次上限；叫不出名字的 exec 同样只回绝、不实现。完全无法定位的 exec 仍然无法
  回包；这种情况现在会记录一条写明问题的警告，而不是静默失败。
- 把“Cursor 原生工具不可用”提前写进系统提示的做法，在两个会话上实测都没有减少绕行
  （仍有 14/21 与 15/19 步包含它；平均每步 39.6s → 55.7s），因此没有随本版本发布。
- DSH 压缩过的长会话，仍可能让模型从头重做自己先前的调查。本版本保证的是：它重新调查的
  是压缩后的历史，而不是 DSH 已经丢弃的那一份。
- `sortModelsByName(models)` 是 v0.6.7 新增的导出；`CursorAdapter.listModels` 与
  `listModelsForRpc` 签名不变，但返回值现在一定是按名称排序的数组。模型 id 未改动，
  配置里固定的模型 id 仍可解析。Cursor 的 `GetUsableModels` 返回顺序没有公开文档，
  随时可能变化；选择器不再依赖它。
- Cursor 的 Agent 协议没有公开文档且仍在增长；卡死日志会记录扩展解码器所需的字段号。
