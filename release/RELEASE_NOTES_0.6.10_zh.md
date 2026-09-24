# dsh-cursor-subscription v0.6.10

Cursor 任务有两件事一直藏着：跑的时候它在做什么，以及工具被拒之后该怎么办。每一步只显示一句
话加一张工具卡，于是一整轮看起来像同一个请求被反复提交；而沙箱拒绝只回一句干巴巴的错误，模型
因此认定"本地工具不可用"，而不是向用户申请权限。

## 每一步背后做的事现在看得见了

reasoning 是适配器唯一可以承载"非正文内容"的通道。一个 Cursor 步骤的大部分墙钟时间都花在协议
往返上，而这些往返从未进入对话记录：模型先试的原生工具、随后拉取的 DSH 工具清单、以及在这两
件事之前结束的思考。这些以前全都不可见；现在由下面四条增量上报，统一带 `[cursor] ` 前缀，并且
占用**独立的 reasoning 块（索引 3）**——模型自己的思考仍在索引 1，保持原样。

| 时机 | 对话里显示的内容 |
| --- | --- |
| 模型结束思考 | `[cursor] thinking finished after 4.2s` |
| 原生 Cursor 工具被回绝 | `[cursor] native grep call declined; using the DSH tools instead` |
| 拉取到工具清单 | `[cursor] loaded the DSH tool schemas (27 tools)` |
| 即将发起 DSH 工具调用 | `[cursor] calling the DSH tool grep` |

`thinking_completed`（`InteractionUpdate` 字段 5）一直带着思考时长，但此前被当作未知更新整条
忽略；现在解出来了。另外三条对应的事件适配器本来就在处理，只是从来没有体现在对话里。

## 沙箱拒绝会带上"怎么申请权限"

所有 provider 拿到的规则是一样的：沙箱拒绝某个调用后，用 `sandbox_permissions` 加一句
justification 重试**同一个调用**，DSH 就会弹出审批。但只有 `pwsh` 的描述写明了这条规则——
`write`、`edit`、`read` 的描述分别只有 42、59、56 个字符，完全没提；拼装出的系统提示里也
一个字都没有。而拒绝结果本身也不带补救办法，Cursor 那一轮实际收到的只是：

```text
Error: SetNamedSecurityInfoW failed (Win32 5): grantWrite(D:\myworks\mkgame_front)
```

不记得工具描述里那条规则的模型，会把这句话读成"这个工具在这里不能用"，从此不再使用它——这正是
某一轮里出现 `本地工具不可用`、然后退化成只做检索的原因。并不是模型不会申请：同一个版本在另一个
会话里被观察到连续申请 8 次，先提 `workspace-write`（被上面那个 ACL 授权失败挡回），再提
`danger-full-access`，随后全部执行成功。

现在 `withSandboxHint()` 会把这条规则附加到拒绝结果上，覆盖结果回传给模型的**两条路径**——
live bridge 的 `mcp_result` 与冷启动的历史重放。两类拒绝的措辞不同，因为它们要的答案不同。
策略拒绝沿用"从最窄的更高模式开始"：

```text
[cursor] The DSH sandbox refused this call, and that is recoverable: retry this
exact call once with sandbox_permissions set to the narrowest wider mode that
suffices (workspace-write, or danger-full-access when that is not enough) plus a
one-sentence justification. DSH then asks the user to approve it. If the retry is
refused as well, stop and report it instead of trying another mode.
```

ACL 失败则直接说明更窄的模式不可能成功——正因为先报了最窄模式，一次拒绝才变成了重试循环，
某个会话里有一轮就那样重复申请了 101 次 `workspace-write`（也就是它当时已经在用的模式）：

```text
[cursor] The DSH sandbox cannot start in this workspace — its own ACL grant fails
(`SetNamedSecurityInfoW`) — so no narrower mode can succeed. Retry this exact call
once with sandbox_permissions="danger-full-access" and a one-sentence
justification; DSH then asks the user to approve it. Do not retry it in a
narrower mode, and if the retry is refused, stop and report the refusal instead
of trying again.
```

读者这边也有一行：`[cursor] the sandbox refused a tool call; told the model how to
ask for approval`。

## 重放会保留每次请求的内容

冷启动——进程重启、桥断、或压缩之后的重建——会把 DSH 历史重放成文本，而工具请求过去只重放成
`[Previous tool request: todo_write]` 一个名字。对计划来说，请求**就是**它的参数，于是模型回来
时手里没有自己刚写的那张表，只能重新推导一张；同一个缺口也藏起了它已经跑过的检索，这就是同一
个调用被重复发起的来源之一。现在每条重放的请求都保留参数（上限 600 字符）：计划完整保留，整文件
`write` 则被截断。

这个改动针对的抖动，取自真实会话：15 次 `todo_write`，没有一次与上一次逐字相同；某一轮连续三步
重写同一份三项计划，而第一项始终停在 `in_progress`，其中一次还变成了英文。计划抖动主要是"卡住"
的症状：计划工具每次调用都整表替换、结果只回计数不回显清单，于是任何改动都是重打一遍；一个推进
不下去的 agent，就会去改它唯一还能控制的东西。

## 验证

- **单元测试：** Host 侧 100 项全部通过。新增用例覆盖：四条进度行按序到达、都保留 `[cursor] `
  前缀、模型自己的思考仍在独立块上、真实工具调用照旧进入 agent 循环；`thinking_completed`
  能解出 Cursor 上报的时长；以及一次交回三个结果（ACL 失败、策略拒绝、普通结果）时，两个拒绝
  各**只被答复一次**、ACL 失败改写 `danger-full-access` 并禁止更窄模式重试、策略拒绝保留
  "最窄优先"、两者都不允许无界重试，且每次拒绝都发出给读者的那一行。
- **重放用例：** 冷启动的 action 文本里保留 `todo_write` 请求及其清单、保留答复它的结果，并且
  对正文 5,000 字符的 `write` 只做截断、不重放全文。
- **回读 Cursor 实际收到的内容（取自真实会话）：** `pwsh` 描述 3,156 字符且写明提权规则；
  `write`、`edit`、`read` 分别为 42、59、56 字符，只字未提；拼装的系统提示 7,816 字符，
  没有出现 sandbox 或 approval 字样。
- **回读当下一次拒绝的实际形状（同一会话）：** 结果里只有上面那句 ACL 错误——也就是现在会
  被补上提示的那段文本。
- **本版本终结的那个循环（取自 `D:` 工作区的会话）：** 同一份记录里 101 次 ACL 失败、49 次
  提权申请，其中一轮把 80 次工具调用耗在同一个 `workspace-write` 重试上，直到用户中断。

## 安装或升级

```sh
dsh plugin --profile web add dsh-cursor-subscription@0.6.10
dsh plugin --profile web list dsh-cursor-subscription --depth 0
```

之后手动重启 DSH，确认 **设置 → Cursor** 显示 `v0.6.10`。

## 兼容性与已知事项

- 进度行属于对话内容：冷启动重放时会出现，DSH 的压缩摘要里也会出现。模型自己的思考未受影响
  ——两类 reasoning 分处不同块索引。
- 提权规则只会附加到真正的沙箱拒绝（`[sandbox: … denied]` 或 `SetNamedSecurityInfoW` 的
  ACL 失败）上，且文本里已含 `sandbox_permissions` 时不再追加；普通工具报错原样保留。
- Cursor 的原生工具仍是"回绝而非执行"；区别是对话里现在会写明这件事，以及下一步该怎么做。
- 在 `D:` 工作区，`workspace-write` 沙箱无法完成自身所需的 ACL 授权
  （`SetNamedSecurityInfoW failed (Win32 5)`），这也是提示里写明"更窄模式不够时用
  `danger-full-access`"的原因。
- 没有新增接口，也没有设置变更：运行流、Config schema 与 RPC 面与 v0.6.9 完全一致。
