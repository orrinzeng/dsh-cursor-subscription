# dsh-cursor-subscription v0.6.6

The usage card now shows what Cursor's dashboard shows. The included-usage
table it renders mirrors the dashboard's **Included Usage** table row for row:
one row per included pool, then the models that drew on that pool, with the
pool's token total and percentage.

Before this release the per-model row was simply wrong: the panel divided a
model's spend by the spend of the models it had listed, so a cycle with a
single active model always read **100%** (and its bar filled to the end) while
the dashboard showed 15.6%.

## Root cause

`parseModelAggregations` projected `pct` as `model spend / total spend of the
listed models`. That is a share of the list, not usage of the plan allowance:

- one active model ⇒ `pct = 100`, whatever it actually consumed;
- models missing from the list silently changed every other row's percentage;
- the row had no token count at all, so the panel could not show what the
  dashboard's Tokens column shows.

Cursor's own dashboard bundle computes each row differently — a share of the
pool percentage shown directly above it:

```js
// api rows, ef = Other Models subtotal
(ef.totalCents > 0 ? (e.totalCents / ef.totalCents * en.apiPercentUsed) : 0).toFixed(1)
// auto rows, ex = Cursor Models subtotal
(ex.totalCents > 0 ? (e.totalCents / ex.totalCents * en.autoPercentUsed) : 0).toFixed(1)
```

## Fixed

### The Usage card renders Cursor's included-usage table

- An **Item / Tokens / Usage** table replaces the separate pool bars and the
  loose per-model list.
- Aggregation rows are classified the way Cursor's usage table classifies them:
  `tier` 2 (and `default` rows with no tier) belong to **Cursor Models** (Auto +
  Composer); every other row belongs to **Other Models** (API) — including
  `default` rows at `tier` 1, shown as **auto (overflow)** because they are Auto
  usage billed to the Other Models allowance.
- Each pool row prints the percentage Cursor reports for that pool
  (`autoPercentUsed` / `apiPercentUsed`) and the pool's token total; each model
  row prints its own tokens and its share of the pool percentage, so a single
  Other Models model reads exactly what the dashboard reads.
- Token counts sum input, output, cache-write and cache-read tokens and are
  printed compact in the reader's locale (`2698.7万`, `27.1M`); percentages
  always keep one decimal, matching the dashboard's `0.0%` / `15.6%`.
- Anything Cursor did not report renders as `—` rather than a fabricated
  number, and a failed aggregated read still shows both pool percentages from
  `/api/usage-summary` with the token cells unavailable.
- Each model row keeps its dollar spend as a tooltip, so the Spending detail is
  still one hover away.

### Host projection

- `parseModelUsage(json, { autoPercentUsed, apiPercentUsed })` now returns
  `{ models, pools }`, where a model carries `{ id, pool, spentDollars, tokens?,
  overflow?, pct? }` and each pool carries its token total.
- `parseModelAggregations(json, options)` keeps returning just the model rows,
  and `usagePools(parsed, modelUsage)` builds the pool facts the reader ships.
- The reader emits the new `pools` field; `plan`, `includedRequests`,
  on-demand spend, and billing-cycle fields are unchanged.

### Panel copy

- Added `usageItem`, `usageTokens`, `usagePercent`, and `autoOverflow` to all
  twelve languages.
- Dropped the four templates the old row list needed (`autoPercent`,
  `otherModelsPercent`, `otherModelsUnknown`, `modelSpendPct`); the table
  carries the pool percentage in its own column now.

## Verification

- **Live:** with the account that reported this (enterprise, cycle
  2026-09-20 → 2026-10-20), the Host projects exactly the dashboard's rows:

  | Item | Tokens | Usage |
  | --- | --- | --- |
  | Cursor Models | 0 | 0.0% |
  | Other Models | 26986544 (2698.7万) | 15.6% |
  | claude-opus-5-high | 26986544 (2698.7万) | 15.6% |

  `usage-summary` reported `autoPercentUsed: 0`, `apiPercentUsed: 15.605`; the
  aggregated events reported
  `{ modelIntent: "claude-opus-5-high", tier: 1, totalCents: 3120.763055,
  inputTokens: "196812", outputTokens: "109116", cacheWriteTokens: "1463827",
  cacheReadTokens: "25216789" }`. The model row read 100% before this change.
- **Cross-check:** the percentage formula is the one Cursor's own dashboard
  chunk runs for these rows, so a model row can no longer disagree with the pool
  row above it.
- **Unit:** 84 host-side tests pass (proto 51, client-locales 8,
  client-usage-table 4, inject-contract 6, version 6, native-fetch 6,
  image-input 3). New cases: a single Other Models model carries its pool
  percentage (15.6, not 100), two models of one pool split it by spend
  (11.7 + 3.9), Cursor-model rows scale against the auto pool while Other-model
  rows scale against the API pool, `tier: "2"` still counts as a Cursor-model
  row, an unreported pool percentage omits `pct`, pool token totals and the
  overflow flag come out of the projection, a failed aggregated read keeps the
  pool percentages, and the table groups each pool with its models in
  dashboard order.

## Install or upgrade

```sh
dsh plugin --profile web add dsh-cursor-subscription@0.6.6
dsh plugin --profile web list dsh-cursor-subscription --depth 0
```

Restart DSH manually afterwards and check that **Settings → Cursor** shows
`v0.6.6`.

## Compatibility and known notes

- No new endpoints: the same three dashboard reads are used
  (`/api/usage-summary`, `/api/dashboard/teams`,
  `/api/dashboard/get-aggregated-usage-events`).
- `parseModelAggregations` changed signature (options object rather than a
  positional limit) and its rows gained `pool`, `tokens`, and `overflow`; its
  `pct` is now usage of the pool allowance rather than a share of the model
  list. `parseModelUsage` and `usagePools` are new exports.
- The reader's `models` rows carry token counts now, and the projection gained
  `pools`.
- Cursor's Agent protocol and dashboard endpoints remain undocumented and
  change over time.
