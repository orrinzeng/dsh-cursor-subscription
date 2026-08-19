# DSH Cursor Subscription

[English](README.md) | **简体中文**

在 DeepSeek Harness 中直接登录 Cursor 账户并使用 Cursor 订阅，不需要 API Key，
也不依赖 Cursor IDE 或 Cursor CLI。保留 DSH 原有的会话、工具和权限体系：
登录后在模型选择器中即可选择 Cursor 订阅模型，Agent 的工具调用走 DSH 本地的
工具集。

> ⚠️ 本插件接入的是 Cursor 未公开的 Agent 协议（`agent.v1.AgentService/Run`），
> 属于社区逆向工程成果，可能随 Cursor 服务端变化而失效。本项目与 Anysphere /
> Cursor 无隶属或背书关系，请遵守 Cursor 的服务条款。

## 能做什么

- 在 DSH 中直接使用 Cursor 订阅（浏览器 PKCE 登录，无 API Key）；
- 登录凭据保存在本机 DSH credential 存储中，自动刷新访问令牌；
- 通过 Cursor 的 `GetUsableModels` 动态发现当前账户可用的模型（失败时回退到内置列表）；
- 流式对话，支持思考过程（reasoning）与 DSH 工具调用；
- 设置页可查看登录状态与令牌有效期；
- 设置页可查询订阅用量（包含请求、计划使用百分比、按需消费、账单周期）并手动刷新；
- 设置页可查看当前账户可用的模型列表并手动刷新；
- 可在设置页调整单次任务工具轮次上限，以及 HTTP 重试次数、间隔和状态码。

## 安装

### 交给 Agent（推荐）

把 `AGENTS.md` 的链接发给 Agent 即可完成安装、更新、卸载与验收。

### 手动安装（已有 dsh 命令）

```sh
dsh plugin --profile web add dsh-cursor-subscription
dsh plugin --profile web list dsh-cursor-subscription --depth 0
dsh --profile web --dump-config
```

安装列表中应只有一个 `dsh-cursor-subscription`，配置中应只有一个
`cursor-subscription` 条目。

### 本地开发安装

在 profile 目录（如 `%USERPROFILE%\.dsh\profiles\web`）执行：

```sh
pnpm add file:D:/mcp/dsh-cursor-subscription
```

并把 `dsh-cursor-subscription` 加入 `package.json` 的
`dsh.profile.bundles` 列表，然后重启 DSH。

## 登录与使用

1. 打开 DSH 的 **设置 -> Cursor 订阅**；
2. 点击「浏览器登录」，浏览器会打开 Cursor 登录页；
3. 登录并授权后，设置页自动显示「已登录」；
4. 在模型选择器中选择 Cursor 模型（如 `composer-2`、`claude-4-sonnet`）。

需要调用工具时，Agent 会把 Cursor 侧的工具请求转成 DSH 本地工具执行，结果通过
对话历史回传给模型，全程不经过 Cursor 的文件系统工具。

「运行设置」卡片可以调整单次 Cursor 任务的最大工具轮次和 HTTP 重试策略。重试次数指
首次请求之外的额外尝试次数，默认 `0`（关闭）。Cursor 的流式 POST 协议无法证明失败请求
未被远端处理，因此启用重试可能重复模型工作或用量；仅当尚未产生任何输出且初始 HTTP
状态码匹配列表时才会重试。

## 更新与卸载

```sh
dsh plugin --profile web update dsh-cursor-subscription   # 更新
dsh plugin --profile web remove dsh-cursor-subscription   # 卸载
```

如果 DSH 正在运行，安装或更新后请手动重启。

## 常见问题

- **登录后仍提示未登录**：确认浏览器完成了整个授权流程（登录页跳转回完成页）；
  轮询最长等待约 2.5 分钟。
- **模型列表为空**：`GetUsableModels` 依赖账户类型，失败时插件会使用内置模型列表，
  仍可手动输入模型名。
- **请求报 401**：令牌过期且 refresh token 失效时，需要在设置页重新登录。
- **服务端协议变更**：Cursor 的 Agent 协议是未公开接口，若请求失败请检查插件更新。

## 边界与支持

- 图片生成、联网搜索等 Cursor 内置能力不在本插件范围内；
- 问题反馈请在仓库 Issues 中提交。

[MIT](LICENSE)
