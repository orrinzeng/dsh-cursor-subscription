# dsh-cursor-subscription v0.6.4

0.6.3 的后续。0.6.3 让适配器在收到 `turn_ended` 时结束该步；这一版在此之上，
当 Cursor **已经流式输出回答、却没有结束该轮就沉默**时也保住这份回答，并把服务端
发来的帧记录下来，以便定位真正原因。

**0.6.3 还不够。** 同样的
`Cursor stream progress timeout: no content for 60000ms` 重试在 0.6.3 上复现了
（`claude-opus-5-high`，DSH 0.1.6-alpha.2，2026-09-18 18:33），说明服务端并不总是
在停止产出内容之前发 `turn_ended`。

## 变更

### 已输出的回答不再因服务端沉默而丢失

- **此前**：回答已经流式输出后服务端安静下来，进度看门狗
  （`STREAM_PROGRESS_TIMEOUT_MS`，60 秒）会以可重试的 `TIMEOUT` 中止该 run，DSH
  随即丢弃用户已经读到的回答并重跑该步。
- **现在**：检测到卡死时，如果本次 run 已经输出过可见文本、且没有待处理的 MCP
  工具调用，该步以干净的 `stop` 结束，回答保留。完全没有产出文本的卡死仍然报
  可重试的 `TIMEOUT`，真正的挂死依然会被如实上报。

### 卡死诊断信息

每次卡死都会把一份报告追加到 `~/.dsh/cursor-hang-trace.log`（并通过插件日志打一条
warning），内容包括：会话、模型、已输出文本长度、工具轮次、checkpoint 大小，以及
最近 120 个服务端帧及其时间戳（服务端心跳会合并计数）。适配器未解码的帧会按其
protobuf 字段号记录，因此被忽略的服务端消息会在 trace 里看得见，而不是无声丢弃。

这套埋点是临时的：下一个修复将基于它，服务端原因查清后会移除。

## 测试

73 个宿主侧测试通过（协议 44、面板文案契约 8、通道挂载 6、版本号 6、
native fetch 6、图片输入 3）。新增覆盖：先输出文本、之后只发心跳的 run 以 `stop`
结束，并写出包含文本与心跳帧的 trace；而原有「只有心跳」的卡死仍然以 `TIMEOUT`
失败。

## 安装 / 升级

```sh
dsh plugin --profile web add dsh-cursor-subscription@0.6.4
dsh plugin --profile web list dsh-cursor-subscription --depth 0
```

之后手动重启 DSH，确认两点：

1. **设置 → Cursor** 标题旁显示 `v0.6.4`；
2. 以前会被取消的 Cursor 回答现在会保留；若服务端仍然沉默，
   `~/.dsh/cursor-hang-trace.log` 里会有该次运行的帧序列。

## 兼容性与已知说明

- Cursor 的 Agent 协议仍是未公开接口且会变化。
