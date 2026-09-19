# dsh-cursor-subscription v0.6.5

"经常超时"已修复。原因**不是网络**：0.6.4 加入的 trace 显示连接一直健康，是适配器
在等一个 Cursor 并不总会发的 checkpoint。

## 根因

一个工具调用步的结尾长这样（10 份 trace、10 份都一样，时间跨度 2026-09-18 16:38Z
到 2026-09-19 14:46Z，模型 `claude-opus-5-high`）：

```
… tokenDelta × n | toolCallStarted | checkpoint(NB) | exec:mcpArgs | heartbeat ×6-7
```

每份报告还带着 `textChars=0 toolCallPending=true`、`lastFrame=1-9s ago`、
`lastContent=63-74s ago`。

- `lastFrame=1-9s` 说明服务端仍在每 ~5 秒发心跳，HTTP/2 连接与网络都没问题。
- checkpoint 是在 `mcpArgs` **之前**到的。适配器假设的恰好相反 —— 它的读循环只在
  `mcpArgs` **之后**收到 checkpoint 时才结束工具调用步 —— 于是一直等着一个永远
  不会来的帧。60 秒后进度看门狗以可重试的 `TIMEOUT` 中止该 run，DSH 便丢弃这一步
  并重跑，直到重试次数用尽。

这也解释了为什么超时看起来很随机：它取决于服务端碰巧先发 checkpoint 还是先发工具调用。

## 修复

### 工具调用步不再等待一个不会到来的 checkpoint

- `mcpArgs` 之后的等待现在由 `TOOL_CALL_SETTLE_MS`（500 毫秒）封顶。实测同一次
  突发里的兄弟调用相隔约 100 毫秒、收尾的 checkpoint 在最后一次调用后约 300 毫秒
  到达，因此并行调用仍留在同一步里；而那种永远不发 checkpoint 的形态则会按时收尾，
  不再挂住。
- 为了能提前停止等待，`ConnectFrameReader` 新增 `pause()` / `resume()`：暂停的
  reader 保留已缓冲的帧、不再阻塞，并在下一个 DSH 步继续同一个 Run 时重新接收帧。
  用 `finish()` 结束 reader 会让续跑的步立刻看到 EOF，所以不能那样做。
- 如果卡死发生在该步**已经产出可见内容**（回答文本或工具调用）之后，现在会停止读取
  而不是抛出可重试错误，DSH 因此不会再丢弃用户已经看到的东西。完全没有产出的卡死
  仍然报 `TIMEOUT`。

0.6.4 的卡死 trace 保留：它只在真的卡死时写入，正是它把猜测变成了确诊。

## 验证

- **真实链路**：并行工具调用路径仍然在一步里发出两个调用（`blocks=2`、
  `finish: tool-calls`、checkpoint 在 +287 毫秒到达，落在 settle 窗口内），没有
  额外延迟。
- **单元测试**：74 个宿主侧测试通过（协议 45、面板文案契约 8、通道挂载 6、
  版本号 6、native fetch 6、图片输入 3）。新增用例回放了 trace 里的形态 ——
  checkpoint、`mcpArgs`、之后只有心跳 —— 断言该步返回 `tool-calls`、run 保持可续跑，
  并且续跑时只发送一条 MCP 结果。去掉 settle 定时器后，同样的用例会走 5 秒的看门狗
  路径。

## 安装 / 升级

```sh
dsh plugin --profile web add dsh-cursor-subscription@0.6.5
dsh plugin --profile web list dsh-cursor-subscription --depth 0
```

之后手动重启 DSH，确认 **设置 → Cursor** 显示 `v0.6.5`。

## 兼容性与已知说明

- 卡死报告仍写入 `~/.dsh/cursor-hang-trace.log`；可以随时删除，下次卡死会重新创建。
- Cursor 的 Agent 协议仍是未公开接口且会变化。
