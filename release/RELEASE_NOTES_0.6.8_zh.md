# dsh-cursor-subscription v0.6.8

需要调用工具的 Cursor 任务，可能刚说完“我这就去读取那个文件”就直接结束了，实际什么
也没做。原因是模型改向 Cursor 请求它自己的内置工具，而当前版本不认识这个请求；由于
没有任何东西去应答它，服务端一直在等一个永远不会到来的执行结果：60 秒后进度看门狗
触发，只有那句开场白留在了对话里。

## 原因

Cursor 的工具请求通过 `ExecServerMessage` 下发。当前版本能解码它认识的变体
（read、ls、grep、write、delete、shell、fetch、diagnostics 等），对每一个都回复
“请改用 DSH 工具”，而 MCP 调用（`mcp_args`）会被转成真正的 DSH 工具调用。

Cursor 会不打招呼地新增 exec 变体。这一轮它开始下发 args 字段为 **36** 的 exec——
消息里只有一个工作区名称，对应一个当前版本叫不出名字的工具。
`decodeExecServerMessage` 返回 `{ case: "unknown" }`，`rejectionFor()` 对它返回
`undefined`，于是适配器根本没有回包。服务端仍持有这个未完成的 exec，之后只发心跳，
直到进度看门狗（60 秒无内容）结束该步骤。卡死日志完整记录了这个形状：

```text
exec:requestContextArgs
interaction#27
exec:unknown
checkpoint(2719B)
heartbeat x6            <- 60 秒后：“Cursor stream progress timeout”
```

由于此前已经输出过文字，看门狗选择停止读取而不是抛出可重试错误（v0.6.5 保留已交付
答案的规则），所以这一轮就以模型的开场白结束，没有任何工具被执行。

## 修复

### 叫不出名字的 exec 也会被应答

`ExecClientMessage` 的结果变体编号与 `ExecServerMessage` 的 exec 变体编号完全一致，
因此无法命名的 exec 可以按它自己的字段号回复。现在 `rejectionFor()` 对未知 exec 返回：

- 回包字段 = 该 exec 自己的字段号；
- 负载 = 通用错误形状 `{ error = 2 { error = 1 } }`，内容与其他原生工具收到的
  理由相同（“Tool not available in this environment. Use the MCP tools provided
  instead.”）。

字段 19（`span_context`）是普通非 oneof 字段，因此永远不会被误当成 exec；只带 id 和
span context 的消息没有 exec 可答，保持不回包。适配器每次运行最多记一条警告，写明被
回绝的字段号；如果出现完全无法定位的 exec（唯一仍可能卡死的情况），再记一条警告。

### 卡死日志会写明字段号

`decodeExecServerMessage` 现在保留未知 exec 的字段号与消息的顶层字段列表，卡死日志
打印 `exec:unknown#36[1,19,36,55]`，不再是那个让人难以从日志定位问题的
`exec:unknown`。

## 验证

- **实测复现（修复前）：** 下面两个提问都会卡住且不产生任何工具调用，该步骤只留下
  开场白文字。

  | 提问 | 修复前 | 修复后 |
  | --- | --- | --- |
  | 读取并总结 `package.json` | 卡住，无工具调用 | 9.5 秒时发出 MCP `read` 调用 |
  | 读出 `README.md` 第一段 | 卡住，无工具调用 | 11.5 秒时发出 MCP `read` 调用 |

  用失败会话里的模型 `claude-opus-5-high` 结果相同：4.7 秒回绝未知 exec，11.5 秒
  发出 MCP `read` 调用。
- **对线上服务探测回包形状：** 不回包时任务卡死（仅 7 帧心跳）。按该 exec 自己的
  字段回包即可恢复——空负载、`{ success = 1 }`、`{ error = 2 { error = 1 } }`、
  `{ rejected = 3 }` 都能让任务继续，服务端随后上报 `toolCallCompleted`。改为在
  字段 11（`mcp_result`）回包则会卡死，这就是必须使用 exec 自身字段号的原因。
- **单元测试：** Host 侧 91 个测试全部通过（proto 58、client-locales 8、
  client-usage-table 4、inject-contract 6、version 6、native-fetch 6、
  image-input 3）。新增用例覆盖：未知 exec 保留字段 36 与顶层字段列表；回包使用该
  字段且能解出回绝理由；只带 id 与 span context 的消息不会按字段 19 回包；每个被
  直接回绝的 exec 都在自己的字段号上回包；适配器对未知 exec 只回包一次、记录警告，
  并继续流式输出直到 `turn_ended`。

## 安装或升级

```sh
dsh plugin --profile web add dsh-cursor-subscription@0.6.8
dsh plugin --profile web list dsh-cursor-subscription --depth 0
```

之后手动重启 DSH，确认 **设置 → Cursor** 显示 `v0.6.8`。

## 兼容性与已知事项

- 没有新增接口，也没有插件 API 变更：仍使用同一条运行流，`rejectionFor()` 签名不变。
  `TOOL_REJECT_REASON` 现改为导出，方便测试与嵌入方断言该理由字符串。
- 未知 exec 只会被回绝，不会被实现：模型会像对待当前版本已知的原生 Cursor 工具那样，
  被提示改用 DSH 工具。这类回绝不计入工具轮次上限，与既有原生工具的行为一致。
- 完全无法定位的 exec 仍然无法回包；这种情况现在会记录一条写明问题的警告，而不是静默
  失败。
- Cursor 的 Agent 协议没有公开文档且仍在增长；现在卡死日志会记录扩展解码器所需的
  字段号。
