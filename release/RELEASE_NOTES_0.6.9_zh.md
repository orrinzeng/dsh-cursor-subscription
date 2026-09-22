# dsh-cursor-subscription v0.6.9

DSH 0.1.7-alpha.1 换掉了本插件所依赖的设置服务。`apply` 调用
`ctx.get("settings").installSection(...)` 时该方法已不存在，于是每次启动
`cursor-subscription` 这条 entry 都激活失败：

```text
cursor-subscription (dsh-cursor-subscription):
TypeError: ctx.get(...).installSection is not a function
```

同一批会话记录还暴露出 Cursor 链路上的另外两个缺陷：一次运行仍然背着 DSH 刚刚压缩掉的
历史，而适配器上报的 token 数字是占位值。

## 原因

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

## 修复

### 设置分区改按 DSH 0.1.7 的 API

`Config` 各字段现在都带 `.volatile()`；`readConfigField()` 同时接受活引用与普通值；
`apply` 通过 `ctx.inject(["settings"], ...)` →
`settings.configure({ auto: false }, ctx.fiber)` 声明页面策略——本插件自带
**设置 → Cursor** 面板，因此不生成自动表单。在没有 `configure` 的 DSH 版本（0.1.5
线）上，Cursor 供应商仍能加载，只是设置页保持为空，而不是整条 entry 启动失败。

`@deepseek-ai/schemastery` 从 `peerDependencies` 移到 `dependencies`（`^3.18.3`），
与 DSH 自家插件的声明方式一致，安装时会自带带 `.volatile()` 的那个版本。

### 压缩会作废它使之失效的 checkpoint

`compactionIdOf()` 从消息历史中读出压缩 id。当它与持久化的 Cursor 对话所依据的 id
不一致时，适配器丢弃 checkpoint 及其 blobs，并且不再跨这次压缩恢复 live bridge；下一次
冷启动会按 DSH 保留下来的内容重建。

### 用量上报真实 prompt 大小与完整输出

Cursor 上报的 prompt 大小就在对话 checkpoint 里
（`ConversationStateStructure.token_details.used_tokens`），现在由
`decodeCheckpointUsedTokens()` 解出；输出 token 改为累加各 `token_delta` 帧。

## 验证

- **API 迁移后的实机验证：** `dsh web` 启动后 entry 处于激活状态——环回通道对
  `POST /cursor-subscription/version` 返回 Connection 的 `401 unauthorized`，
  而这条路由只有在 `apply` 跑完并挂载之后才会存在。随后一次三步的 Cursor 运行上报
  `inputTokens` 17,613 / 17,544 / 18,558、`outputTokens` 390 / 237 / 5：prompt
  大小随对话增长，输出量与文本长度相符。
- **压缩：** 出问题的会话里，压缩后的存活历史为 9,641 字符（约 2,410 token），而整个
  会话累计 815,800 字符（约 203,950 token，其中 55% 是工具输出）。
- **真 cordis 启动探针：** 12/12 通过——面对 0.1.7 形状的设置服务时 entry 正常激活、
  页面策略绑定在插件自己的 fiber 上、`Config` 以活引用交付、提交的修改在下一次读取时
  可见、设置更新走 entry 命名空间写入，而 0.1.5 形状的设置服务下供应商仍能加载。
- **单元测试：** 96 项主机侧测试全部通过。新增用例：压缩前捕获的 checkpoint 不会被
  复用、单步 token 总量等于各帧之和、`resolveCursorSettings` 能读取活的 volatile 引用。

## 安装或升级

```sh
dsh plugin --profile web add dsh-cursor-subscription@0.6.9
dsh plugin --profile web list dsh-cursor-subscription --depth 0
```

之后手动重启 DSH，确认 **设置 → Cursor** 显示 `v0.6.9`。

## 兼容性与已知事项

- 设置页需要设置服务带 `configure` 的 DSH 版本（0.1.7-alpha.1 及以后）。其余功能——
  登录、模型发现、对话、工具调用——在 0.1.5 线上同样可用。
- `@deepseek-ai/schemastery` 现在是运行时依赖：profile 安装会自带一份，陈旧的共享
  `node_modules` 目录不再能决定插件用哪个库解析自身 Config。
- Cursor 的原生工具仍会被逐个回绝，模型尝试一次就要付一次被拒的往返。把这条事实提前写进
  系统提示的做法，在两个会话上实测都没有减少它（仍有 14/21 与 15/19 步包含这次绕行；
  平均每步 39.6s → 55.7s），因此没有随本版本发布。
- DSH 压缩过的长会话，仍可能让模型从头重做自己先前的调查。本版本保证的是：它重新调查的
  是压缩后的历史，而不是 DSH 已经丢弃的那一份。
