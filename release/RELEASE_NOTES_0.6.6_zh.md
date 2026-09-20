# dsh-cursor-subscription v0.6.6

用量卡片现在和 Cursor 官网一致：面板渲染的「包含用量」表格与官网
**Included Usage** 表逐行对应——每个额度池一行，其下是该池消耗过的模型，并带
上该池的 token 总量与百分比。

修复前那一行模型数据是错的：插件把某个模型的消费除以「已列出模型的消费总和」，
因此一个周期内只有一个活跃模型时永远显示 **100%**（进度条也顶满），而官网显示的
是 15.6%。

## 原因

`parseModelAggregations` 把 `pct` 投影成 `模型消费 / 已列出模型消费总和`。这是
“在列表里的占比”，不是套餐额度的使用率：

- 只有一个活跃模型时必然得到 `pct = 100`，与实际用量无关；
- 列表里少一个模型，其余所有行的百分比都会被悄悄改变；
- 这一行完全没有 token 数，因此面板也无法像官网的 Tokens 列那样显示用量规模。

Cursor 官网自己的前端代码对每一行算的是另一种值——该行占它所属额度池百分比的
份额：

```js
// Other Models（API）行，ef = 该池小计
(ef.totalCents > 0 ? (e.totalCents / ef.totalCents * en.apiPercentUsed) : 0).toFixed(1)
// Cursor Models（auto）行，ex = 该池小计
(ex.totalCents > 0 ? (e.totalCents / ex.totalCents * en.autoPercentUsed) : 0).toFixed(1)
```

## 修复

### 用量卡片改为官网的包含用量表格

- 用一张 **Item / Tokens / Usage** 表格取代原来分开的两个额度池进度条和松散的模型
  列表。
- 聚合行按 Cursor 用量表的同一规则归池：`tier` 为 2（以及没有 `tier` 的
  `default` 行）属于 **Cursor Models**（Auto + Composer）；其余行属于
  **Other Models**（API）——其中包括 `tier` 为 1 的 `default` 行，标注为
  **auto (overflow)**，因为它们是溢出到其他模型额度的 Auto 用量。
- 每个额度池行显示 Cursor 上报的该池百分比（`autoPercentUsed` /
  `apiPercentUsed`）与该池 token 总量；每个模型行显示自己的 token 与
  “占所属池百分比”，因此只有一个 Other Models 模型时，数值与官网完全一致。
- token 数为 input、output、cache write、cache read 之和，并按读者所在区域紧凑
  显示（`2698.7万`、`27.1M`）；百分比固定保留一位小数，与官网的 `0.0%` /
  `15.6%` 一致。
- Cursor 没有上报的值显示为 `—`，不再编造数字；聚合接口读取失败时仍会用
  `/api/usage-summary` 的两个池百分比渲染表格，token 单元格显示为不可用。
- 模型行仍把消费金额保留为鼠标悬停提示，Spending 细节依然触手可及。

### Host 投影

- `parseModelUsage(json, { autoPercentUsed, apiPercentUsed })` 返回
  `{ models, pools }`：模型为 `{ id, pool, spentDollars, tokens?, overflow?,
  pct? }`，每个池带自己的 token 总量。
- `parseModelAggregations(json, options)` 仍只返回模型行；
  `usagePools(parsed, modelUsage)` 负责组装 Reader 下发的额度池数据。
- Reader 新增 `pools` 字段；`plan`、包含请求、按需消费、账单周期字段均未改动。

### 面板文案

- 十二种语言各新增 `usageItem`、`usageTokens`、`usagePercent`、`autoOverflow`。
- 删除旧模型列表专用的四个模板（`autoPercent`、`otherModelsPercent`、
  `otherModelsUnknown`、`modelSpendPct`）；额度池百分比现在有自己的列。

## 验证

- **实测：** 用反馈此问题的账户（enterprise，周期 2026-09-20 → 2026-10-20），
  Host 投影出的行与官网逐行一致：

  | Item | Tokens | Usage |
  | --- | --- | --- |
  | Cursor Models | 0 | 0.0% |
  | Other Models | 26986544（2698.7万） | 15.6% |
  | claude-opus-5-high | 26986544（2698.7万） | 15.6% |

  `usage-summary` 返回 `autoPercentUsed: 0`、`apiPercentUsed: 15.605`；聚合事件
  返回 `{ modelIntent: "claude-opus-5-high", tier: 1, totalCents: 3120.763055,
  inputTokens: "196812", outputTokens: "109116", cacheWriteTokens: "1463827",
  cacheReadTokens: "25216789" }`。修复前该模型行显示 100%。
- **交叉验证：** 百分比公式与 Cursor 官网前端为这些行执行的公式一致，模型行不会
  再和它上方的额度池行对不上。
- **单元测试：** Host 侧 84 个测试全部通过（proto 51、client-locales 8、
  client-usage-table 4、inject-contract 6、version 6、native-fetch 6、
  image-input 3）。新增用例覆盖：单个 Other Models 模型显示其池百分比（15.6 而非
  100）、同一池内两个模型按消费拆分（11.7 + 3.9）、Cursor 模型行按 auto 池缩放而
  Other 模型行按 API 池缩放、`tier: "2"` 仍归入 Cursor 模型行、池百分比缺失时
  `pct` 缺省、池 token 总量与 overflow 标记、聚合读取失败时保留池百分比，以及表格
  按官网顺序把模型归到对应池下。

## 安装或升级

```sh
dsh plugin --profile web add dsh-cursor-subscription@0.6.6
dsh plugin --profile web list dsh-cursor-subscription --depth 0
```

之后手动重启 DSH，确认 **设置 → Cursor** 显示 `v0.6.6`。

## 兼容性与已知事项

- 没有新增接口：仍然只读取同样的三个官网接口
  （`/api/usage-summary`、`/api/dashboard/teams`、
  `/api/dashboard/get-aggregated-usage-events`）。
- `parseModelAggregations` 签名有变化（由位置参数 `limit` 改为选项对象），返回行
  新增 `pool`、`tokens`、`overflow`；`pct` 语义由“占模型列表的比例”改为“占所属
  额度池额度的用量”。新增导出 `parseModelUsage`、`usagePools`。
- Reader 的 `models` 行现在带 token 数，投影新增 `pools`。
- Cursor 的 Agent 协议与官网接口均未公开，且可能随时变化。
