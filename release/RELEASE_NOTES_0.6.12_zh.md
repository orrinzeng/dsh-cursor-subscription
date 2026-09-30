# dsh-cursor-subscription v0.6.12

DSH 0.2.0-rc.2 让本插件起不来了，但这次不是"某个 API 被删掉"那种故障：插件调用的一切都还在。这个版本加了**版本兼容闸门**，而本插件声明错了版本线。

## 0.2.0-rc.2 改了什么

在 profile 导入一个插件之前，DSH 现在会把该插件 `peerDependencies` 里所有 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` 的范围拿去和当前运行时版本比对：

```js
semver.satisfies(runtimeVersion, range, { includePrerelease: true })
```

只要有一个范围不满足，整个插件就被拒绝；而且被拒绝的插件是在**启动器自己那份组合结果里**被拒的——它根本不会被 import，也不会贡献任何条目。后半句正是症状令人费解的原因。profile 自己的 `cordis.patch.yml` 里带着一条针对 `cursor-subscription` 条目的配置覆盖，于是被拒的插件并不是报一句"不兼容"就停下，而是报：

```
dsh: [C:\Users\<user>\.dsh\profiles\web\cordis.patch.yml] patch: entry "cursor-subscription" not found
```

读起来像是 profile 坏了，而不是插件被拒。真正的信息在它上面一行：

```
dsh: warning: Plugin dsh-cursor-subscription@0.6.11 is incompatible with dsh 0.2.0-rc.2:
  peerDependencies {"@deepseek-ai/dsh-client-locale":"0.1.0-rc.6", ...}
```

这个检查有两个细节值得记住。`@deepseek-ai/cordis` 与 `react` 不属于 `@deepseek-ai/dsh-*`，永远不会被检查；而 `includePrerelease: true` 让预发布范围比裸 `semver.satisfies` 更宽松地匹配预发布运行时——Connection 那条旧范围 `>=0.1.0-rc.6 <0.2.0` 其实仍然满足 `0.2.0-rc.2`。真正不满足的是那十条精确钉死的声明。

## 本版本声明了什么

每个 DSH peer 现在声明的是本构建实测的版本线，而不是某一个预发布版本：

| Peer | 原值 | 现值 |
|---|---|---|
| `@deepseek-ai/dsh-client-connection` | `>=0.1.0-rc.6 <0.2.0` | `^0.2.0-rc.2` |
| `@deepseek-ai/dsh-client-locale`、`dsh-client-ui-primitives`、`dsh-client-ui-settings`、`dsh-client-ui-slots`、`dsh-client-ui-tool`、`dsh-credentials`、`dsh-settings`、`dsh-tools` | `0.1.0-rc.6` | `^0.2.0-rc.2` |
| `@deepseek-ai/dsh-llm` | `^0.1.2-rc.1` | `^0.2.0-rc.2` |
| `@deepseek-ai/dsh-client-runtime` | `0.1.0-rc.6` | **移除** |
| `@deepseek-ai/cordis` | `4.0.1` | `~4.0.4` |

`^0.2.0-rc.2` 是刻意覆盖整条 0.2.x 线，而不是钉死 `0.2.0-rc.2`。钉死的话，下一个 `0.2.0-rc.3` 会再次拒绝本插件——那正是本版本要终结的那种重复故障。

`@deepseek-ai/dsh-client-runtime` 在 0.2.0-rc 线里已经不存在：它最后发布的版本是 `0.1.1-rc.2`，没有 `0.2.0-rc.2` 能满足。把这条 peer 留下，光它自己就足以拒绝整个插件，无论另外十条写什么；因此它同时从 `peerDependencies` 和客户端 `dsh.client.inject` 列表里移除。它提供的 `slots` 服务现在来自平台种子表：所有一方客户端包都像本插件一样 `require("@deepseek-ai/dsh-client-ui-primitives")`，没有任何一个把它声明成 client external。

## 一处真实 API 变更：Connection 的路由选项

`@deepseek-ai/dsh-client-connection` 在这两条线之间少了一个参数。0.1.x 声明的是

```js
register(owner, channel, handler, options)   // options = { authority: "loopback" }
handle(channel, handler, options)
```

而 0.2.0-rc.2 声明的是

```js
register(owner, channel, handler)
handle(channel, handler)
```

这个 loopback 限定并不是被改了名字——它是被取消了。0.2.0-rc.2 用**一个服务级检查**（loopback 或已配置的可信权威，然后是浏览器鉴权）来守所有注册的通道，因此已经没有"按路由指定权威"这回事，第 4 个参数会被静默忽略，而不是被采纳。插件现在读取声明的形参个数，只对仍然公开该参数的构建传它，于是 0.1.x 线保住自己更窄的围栏，而不是看起来有、实际没有。

所以在 0.2.0-rc.2 上，账户通道由部署自身的策略来守。默认本地安装下，这仍是与过去相同的"仅 loopback"围栏，外加浏览器鉴权；而在配置了 `trustedHosts` 的部署上，这条通道现在和所有其他已注册通道一样遵循它。这是平台强加的放宽，不是本插件的选择——写出来，而不是藏起来。

## 验证

- **单元测试**：针对 0.2.0-rc.2 包线，104 个宿主侧测试全部通过。本版本新增的两个用例双向覆盖 Connection 签名：0.1.x 形状的注册表仍然收到 `{ authority: "loopback" }`；0.2.0-rc.2 形状（声明三个形参、无 options）既能被正确注册，也**不会**被塞进那个会被它忽略的参数——`register` 路径与 `rpc.handle` 回退路径都验了。
- **闸门本身**：以本清单和运行时 `0.2.0-rc.2` 调用 `@deepseek-ai/dsh-app-boot` 0.2.0-rc.2 的 `evaluatePluginCompatibility`，返回无任何不兼容 peer。同一个函数作用于 0.6.11 的清单时，报出的正是那十条精确钉死的声明，与启动日志一致。
- **组合结果**：`dsh --profile web --dump-config` 打印出了 `cursor-subscription` 条目，且 stderr 为空——既没有兼容性告警，也没有 `patch: entry ... not found`。该条目先是归属 bundle 层，然后归属 profile 补丁层，也就是此前失败的那套分层。
- **导入与 schema**：`dsh --profile web --dump-config-schema` 会 import 每一个组合进来的模块并收集本插件的 Config schema（含 `replayHistoryEachStep`），其条目没有任何诊断。该次运行里四条 `unrecognized Loader tree carrier` 错误属于 DSH 自己的 `preset-standard`、`preset-ptc`、`preset-minimal`、`preset-cordis` 条目。
- **在运行中的会话里完成挂载**：把插件装进一个在跑的 `web` profile 后，`POST /cursor-subscription/version` 返回 **401 unauthorized**，而一个不存在的路径返回 405——路由确实存在，并且被 Connection 的浏览器鉴权挡住，这正是 0.2.0-rc.2 的 `register` 路径在生效。承载它的 DSH 进程在插件安装时已经运行了十一分钟，全程没有被重启。

## 安装或升级

```sh
dsh plugin --profile web add dsh-cursor-subscription@0.6.12
dsh plugin --profile web list dsh-cursor-subscription --depth 0
dsh --profile web --dump-config
```

之后请手动重启 DSH，并确认 **设置 -> Cursor** 显示 `v0.6.12`。

## 兼容性与已知事项

- 本构建声明的是 0.2.0-rc 线，不再覆盖 DSH 0.1.x。若你仍在 0.1.x 的 DSH 上，请留在 0.6.11：0.6.12 会被 0.1.x 的组合结果拒绝，方式与 0.6.11 被 0.2.0-rc.2 拒绝完全一样。
- 若不想改版本、只想对某一对具体版本放行，可以授予豁免——`dsh plugin --profile web allow-version dsh-cursor-subscription@<版本> --dsh-version <DSH版本> --accept-risk`。豁免在两端都是精确的：插件升级与 DSH 升级都不会继承它。
- provider 的运行时行为、`Run` 协议、工具桥、设置项与客户端面板相对 v0.6.11 均无变化。本版本动的是声明和一处注册调用。
- 仓库的 `pnpm-workspace.yaml` 现在把 0.2.0-rc.2 相关包列入了 `minimumReleaseAgeExclude`，这样全新一次 `pnpm install` 能在它们仍处于 pnpm 24 小时发布年龄窗口内时解析到它们。
