# dsh-cursor-subscription v0.6.1

Cursor 设置面板现在支持十二种语言、在标题旁标出**正在服务你的构建版本**，并修复了 DSH
0.1.5-rc.1 上的启动失败。

**如果你遇到下面这个启动错误，本次升级是必须的：**
`dsh: plugin tree failed to load: failed to apply loader entry cursor-subscription (dsh-cursor-subscription): cannot get property "webServer" without inject`
——这正是本版本修复的问题。

## 安装前必读：pnpm 的 24 小时发布年龄门限

pnpm 11 及以后内置了 24 小时的 `minimumReleaseAge` 供应链防护：形如 `^0.5.0`
的版本范围**永远不会选中最近 24 小时内发布的版本**。所以在刚发布完之后执行
`dsh plugin --profile web add dsh-cursor-subscription`，解析到的是「发布超过 24 小时的
最新版本」——以本包近期的发布节奏，就会退化成最早的已发布版本，而不是你刚发布的那一个。
解决方式二选一：安装时显式指定版本，或在 profile 的 `pnpm-workspace.yaml`
里按包名豁免：

```yaml
minimumReleaseAgeExclude:
  - dsh-cursor-subscription
```

按包名豁免只对这个包放行，其他依赖仍受该防护约束。完整的安装与验收流程见
[AGENTS.md](AGENTS.md)。

## 修复

### DSH 0.1.5-rc.1 启动失败 —— `cannot get property "webServer" without inject`

- **影响范围**：凡是把账户通道挂在 `connection.rpc.handle` 上的 0.5.x 版本，遇到
  Connection 插件不再自行声明 `webServer` 的 DSH（0.1.5-rc.1）时，整棵插件树加载
  失败，DSH 完全无法启动。
- **根因**：`HostConnectionService.register` 会读取 `owner.webServer`，而
  `rpc.handle` 把 `owner` 绑定到**读取** Connection 服务的那个 Context 上，该
  Context 的 `webServer` 是**沿着提供方插件自己的作用域**解析的。
  `@deepseek-ai/dsh-client-connection` 0.1.5-rc.1 只声明了 `credentials`，它自己的
  `/api` 也是用嵌套的 `webServer` Context 挂载的，于是这次读取对任何外部插件都会抛错。
  把 `webServer` 加进本插件自己的 `inject` 也无济于事——失败的读取根本不发生在本
  插件的 Context 上。
- **修法**：改用 Connection 内部使用的同一个注册方法，并显式传入一个**声明了
  `webServer` 的 owner Context**；对自行声明 `webServer` 的 Connection 版本仍保留
  公开的 `rpc.handle` 作为回退。通道路径、请求信封、Host/Origin 信任栅栏与浏览器
  鉴权全部不变，因此浏览器侧一行都不用改。

## 新增

### 面板支持十二种语言

此前面板只有简体中文与英文，现在新增繁体中文、日语、韩语、西班牙语、法语、德语、
意大利语、巴西葡萄牙语、俄语和阿拉伯语。

| 语言 | 显示名 | 回退到 |
| --- | --- | --- |
| `zh-Hant` | 繁體中文 | `zh` |
| `ja` | 日本語 | `en` |
| `ko` | 한국어 | `en` |
| `es` | Español | `en` |
| `fr` | Français | `en` |
| `de` | Deutsch | `en` |
| `it` | Italiano | `en` |
| `pt-BR` | Português (Brasil) | `en` |
| `ru` | Русский | `en` |
| `ar` | العربية | `en` |

- 新增语言会注册进 DSH 的共享语言目录，出现在 **设置 → 通用 → 语言**
  中；面板之外的其他界面回退到英文。
- **阿拉伯语自动镜像**：布局方向、进度条与行对齐翻转，数字输入框和模型名保持
  从左到右。标记与样式规则都限定在本面板内，不影响 DSH 其余界面。
- 语言包只在支持该能力的 DSH locale runtime（`addLanguage`）上生效；在更旧的
  runtime 上面板安静地停留在中/英文，不会报错。

### 面板标题旁的版本号

标题旁现在会显示当前安装构建的版本（例如 `v0.6.1`）。这个数字由宿主从自己的
`package.json` 读出、经现有账户通道返回，因此**不会**被复制进浏览器包里，也就
不可能和发布版本不一致。读取失败时只是不显示徽标，绝不会把面板变成错误状态。

## 其他变更

- **文案改由测试守住**：12 份词典会逐一校验键集、`{占位符}` 与花括号配平；面板还会
  校验「读到的键都已定义」与「已定义的键都被读到」。正是这项检查发现 4 个从未被任何
  组件读取的陈旧词条（`usageError`、`spendUsed`、`planPercent`、`modelsEmpty`），
  它们被直接删除，而不是再翻译十份。
- **刷新 lockfile**：`pnpm-lock.yaml` 里 `@deepseek-ai/dsh-client-connection` 仍记着
  放宽前的 `0.1.0-rc.6`，而 `package.json` 声明的是 `>=0.1.0-rc.6 <0.2.0`，
  `--frozen-lockfile` 会直接拒绝；现在 14 个 peer specifier 与清单完全一致。
- **文档**：两份 README 与 [AGENTS.md](AGENTS.md) 都补充了 pnpm 发布年龄门限、
  新增语言与版本号显示说明。
- **测试**：共 70 个——协议 41、面板文案契约 8、通道挂载 6、版本号 6、
  native fetch 6、图片输入 3。

## 安装 / 升级

```sh
# 显式指定版本（不受 24 小时门限影响）
dsh plugin --profile web add dsh-cursor-subscription@0.6.1

# 或者先加上前面的按包名豁免，再用普通命令
dsh plugin --profile web add dsh-cursor-subscription
dsh plugin --profile web update dsh-cursor-subscription

dsh plugin --profile web list dsh-cursor-subscription --depth 0
dsh --profile web --dump-config
```

之后**手动重启 DSH**（`patchReload` 不会重载新增 bundle 与客户端模块），然后确认：

1. **设置 → Cursor** 能打开，标题旁显示 `v0.6.1`；
2. **设置 → 通用 → 语言** 里能看到新增语言，切到阿拉伯语时面板镜像；
3. 模型选择器里出现 `cursor-subscription`，登录、用量与模型卡片照旧可用。

## 兼容性与已知说明

- 账户通道复用 Connection 的信封、信任栅栏与浏览器鉴权。在
  `@deepseek-ai/dsh-client-connection` 0.1.5-rc.1 上，注册选项
  `authority: "loopback"` 已不存在（0.1.0-rc.6 仍支持），因此该通道继承与
  `/api` 相同的防护：仅限 loopback 或声明的受信 Host，且需要已签名的浏览器会话。
- 面板新增语言需要支持语言包的 DSH locale runtime；在其他环境下面板回退中/英文，
  不会报错。
- 阿拉伯语镜像只作用于本面板；对新增语言，DSH 自身的界面文案仍为英文，这正是
  `en` 回退链提供的行为。
- Cursor 的 Agent 协议仍是未公开接口且会变化；聊天链路上的传输错误或
  `CURSOR_ERROR` 通常意味着需要更新插件。
